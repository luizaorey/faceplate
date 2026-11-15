/* Faceplate — motor de cálculo (sem DOM; roda no navegador e no Node).
 *
 * Cadeia modelada:  instrumento (4–20 mA ou HART) → entrada do SDCD → [cálculo] → faceplate.
 * Tudo é avaliado como função da corrente (mA), por isso qualquer combinação
 * (unidade diferente, raiz quadrada no transmissor ou no SDCD, escalonamento linear)
 * cai no mesmo comparador ponto a ponto.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- unidades (d = grandeza, f = fator para a unidade-base da grandeza) ----------
  // base: qv = m³/h, qn = Nm³/h, qm = kg/h, p = Pa
  const UNITS = {
    'm³/h': { d: 'qv', f: 1 }, 'm³/min': { d: 'qv', f: 60 }, 'm³/s': { d: 'qv', f: 3600 },
    'L/h': { d: 'qv', f: 0.001 }, 'L/min': { d: 'qv', f: 0.06 }, 'L/s': { d: 'qv', f: 3.6 },
    'Nm³/h': { d: 'qn', f: 1 }, 'Nm³/min': { d: 'qn', f: 60 },
    'kg/h': { d: 'qm', f: 1 }, 'kg/min': { d: 'qm', f: 60 }, 'kg/s': { d: 'qm', f: 3600 }, 't/h': { d: 'qm', f: 1000 },
    'Pa': { d: 'p', f: 1 }, 'kPa': { d: 'p', f: 1000 }, 'MPa': { d: 'p', f: 1e6 },
    'mbar': { d: 'p', f: 100 }, 'bar': { d: 'p', f: 1e5 }, 'kgf/cm²': { d: 'p', f: 98066.5 },
    'psi': { d: 'p', f: 6894.757 }, 'atm': { d: 'p', f: 101325 }, 'mmHg': { d: 'p', f: 133.322 },
    'mmH₂O': { d: 'p', f: 9.80665 }, 'inH₂O': { d: 'p', f: 249.082 }, 'mca': { d: 'p', f: 9806.65 },
  };
  const DIMNAME = { qv: 'vazão volumétrica', qn: 'vazão normal (Nm³)', qm: 'vazão mássica', p: 'pressão' };
  const VARS = {
    vazao: { label: 'Vazão', dims: ['qv', 'qn', 'qm'] },
    dp: { label: 'Pressão diferencial (ΔP)', dims: ['p'] },
    pressao: { label: 'Pressão', dims: ['p'] },
  };
  const VARLABEL = { vazao: 'vazão', dp: 'ΔP', pressao: 'pressão' };

  function unitsFor(v) {
    const dims = (VARS[v] || VARS.vazao).dims;
    return Object.keys(UNITS).filter((u) => dims.includes(UNITS[u].d));
  }
  function conv(v, a, b) {
    const A = UNITS[a], B = UNITS[b];
    if (!A || !B || A.d !== B.d || !isFinite(v)) return NaN;
    return (v * A.f) / B.f;
  }
  const sameDim = (a, b) => !!(UNITS[a] && UNITS[b] && UNITS[a].d === UNITS[b].d);

  // "1.500" = 1500, "100.000" = 100000, "0,5" = 0.5, "0.5" = 0.5
  function parseNum(x) {
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (x == null) return null;
    let t = String(x).trim().replace(/\s/g, '');
    if (t === '') return null;
    if (/^-?[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '—';
    if (Math.abs(n) < 1e-9) n = 0;
    if (d != null) return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
    const a = Math.abs(n);
    const dig = a >= 100 ? 1 : a >= 10 ? 2 : 3;
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: dig }).format(n);
  }

  // ---------- motor ----------
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const POINTS = [4, 8, 12, 16, 20];

  function compute(m, opt) {
    opt = opt || {};
    const tolPct = isN(opt.tolPct) ? opt.tolPct : 0.5; // % do span do faceplate
    const fp = m.fp, inst = m.inst, sd = m.sd || {}, ds = m.ds || {};
    const R = {
      status: 'insuf', hyp: false, miss: [], confirm: [], warn: [], points: [],
      equiv: null, rangeCmp: null, ds: null, reading: null, fromFace: null, summary: '', kind: null, tolPct,
    };
    const miss = (id, label) => R.miss.push({ id, label });

    // --- dados mínimos
    if (!fp.unit) miss('fp.unit', 'Faceplate: unidade');
    if (!isN(fp.lo)) miss('fp.lo', 'Faceplate: início da faixa');
    if (!isN(fp.hi)) miss('fp.hi', 'Faceplate: fim da faixa');
    else if (isN(fp.lo) && fp.lo === fp.hi) miss('fp.hi', 'Faceplate: fim da faixa igual ao início');
    if (!inst.unit) miss('in.unit', 'Instrumento: unidade da variável de saída');
    if (!isN(inst.lo)) miss('in.lo', 'Instrumento: valor configurado para 4 mA');
    if (!isN(inst.hi)) miss('in.hi', 'Instrumento: valor configurado para 20 mA');
    else if (isN(inst.lo) && inst.lo === inst.hi) miss('in.hi', 'Instrumento: 20 mA igual a 4 mA');

    // --- compatibilidade faceplate × instrumento
    let kind = null; // 'same' | 'dp2q'
    const isP = (v) => v === 'dp' || v === 'pressao';
    if ((fp.var === 'vazao' && inst.var === 'vazao') || (isP(fp.var) && isP(inst.var))) kind = 'same';
    else if (fp.var === 'vazao' && isP(inst.var)) kind = 'dp2q';
    else miss('in.var', 'Instrumento: a variável de saída (' + (VARLABEL[inst.var] || '?') + ') não se compara com o faceplate (' + (VARLABEL[fp.var] || '?') + ')');
    R.kind = kind;

    if (kind === 'same' && fp.unit && inst.unit && !sameDim(fp.unit, inst.unit)) {
      miss('in.unit', 'Unidades de grandezas diferentes (' + DIMNAME[UNITS[inst.unit].d] + ' × ' + DIMNAME[UNITS[fp.unit].d] + '): converter exige densidade/condições de processo');
    }
    const q = inst.q || {};
    if (kind === 'dp2q') {
      if (inst.mode !== 'linear' && inst.mode !== 'raiz') miss('in.mode', 'Instrumento: onde a raiz quadrada é extraída (no transmissor ou no SDCD)');
      if (!isN(q.hi) || q.hi <= 0) miss('ds.hi', 'Folha de dados: vazão correspondente ao ΔP máximo (20 mA)');
      if (!q.unit) miss('ds.unit', 'Folha de dados: unidade da vazão');
      else if (fp.unit && !sameDim(q.unit, fp.unit)) miss('ds.unit', 'Folha de dados: unidade de vazão de grandeza diferente da do faceplate');
      if (isN(inst.lo) && inst.lo !== 0) R.warn.push('Relação vazão × ΔP assume ΔP zero-based (4 mA = 0). O início da faixa de ΔP não é zero.');
    }

    // --- SDCD
    const src = sd.src || 'desc';
    const srcEff = src === 'hart' ? 'hart' : '420';
    let calc = sd.calc || 'none';
    const hasScale = !!(sd.unit && isN(sd.lo) && isN(sd.hi) && sd.lo !== sd.hi);
    if (src === 'desc') R.confirm.push('Origem do sinal no SDCD (4–20 mA direto ou HART digital) — o cálculo assume 4–20 mA direto');
    if (calc === 'outro') miss('sd.calc', 'SDCD: bloco de cálculo "outro" não pode ser simulado — informe extração de raiz ou ganho/offset');
    if (calc === 'desconhecido') {
      R.confirm.push('Se existe bloco de cálculo entre a entrada e o faceplate — assumido o que deixa a cadeia coerente');
      calc = kind === 'dp2q' && inst.mode === 'linear' ? 'raiz' : 'none';
      R.hyp = true;
    }
    if (calc === 'linear' && !isN(sd.a)) miss('sd.a', 'SDCD: ganho (a) do escalonamento linear  saída = a·entrada + b');
    const b = isN(sd.b) ? sd.b : 0;

    if (sd.var && kind && calc === 'none' && (sd.var === 'vazao') !== (fp.var === 'vazao') && srcEff === '420') {
      miss('sd.calc', 'Entrada do SDCD em ' + VARLABEL[sd.var] + ' e faceplate em ' + VARLABEL[fp.var] + ' sem bloco de cálculo: informe qual cálculo é aplicado');
    }
    if (srcEff === 'hart') {
      if (!sd.hart) miss('sd.hart', 'SDCD: variável HART selecionada (PV, SV, TV ou QV)');
      else if (sd.hart !== 'PV') R.warn.push('O SDCD lê ' + sd.hart + ', não a PV. Confirme que é a mesma variável da saída analógica configurada no Trex.');
      if (kind === 'dp2q' && calc === 'none') miss('sd.calc', 'HART digital lê pressão e o faceplate é vazão: marque "Extrair raiz" na chave do SDCD (ou informe a conversão aplicada)');
      if ((calc === 'raiz' || calc === 'linear') && !hasScale) miss('sd.lo', 'SDCD: faixa (unidade, início, fim) usada na conversão do valor HART');
    } else if (!hasScale && calc === 'linear') {
      miss('sd.lo', 'SDCD: escala da entrada analógica (unidade, início, fim)');
    }
    if (hasScale && srcEff === '420' && calc === 'none' && fp.unit && !sameDim(sd.unit, fp.unit)) {
      miss('sd.unit', 'SDCD: unidade da escala de grandeza diferente da do faceplate sem bloco de cálculo');
    }

    // confirmação
    if (!sd.conf) {
      R.hyp = true;
      if (srcEff === '420') R.confirm.push(hasScale ? 'Escala da entrada analógica na configuração do SDCD (marque "conferido" quando confirmar)' : 'Escala da entrada analógica no SDCD — usada a faixa do faceplate como hipótese');
      else R.confirm.push('Variável HART e conversão até o faceplate na configuração do SDCD');
    } else if (srcEff === '420' && !hasScale && calc !== 'raiz') {
      R.hyp = true;
      R.confirm.push('Escala da entrada analógica não informada — usada a faixa do faceplate como hipótese');
    }
    if (src === 'desc') R.hyp = true;

    if (R.miss.length) { R.status = 'insuf'; R.summary = 'Dados insuficientes'; return R; }

    // --- funções da cadeia (todas em função da corrente)
    const fr = (mA) => (mA - 4) / 16;
    const sq = (x) => (x < 0 ? -(x * x) : x * x);
    const sr = (x) => Math.sqrt(Math.max(x, 0));
    const span = inst.hi - inst.lo;
    const rootTx = kind === 'dp2q' && inst.mode === 'raiz';
    const instVal = (mA) => inst.lo + span * (rootTx ? sq(fr(mA)) : fr(mA)); // na unidade do instrumento
    const qhFp = kind === 'dp2q' ? conv(q.hi, q.unit, fp.unit) : NaN;
    const Ifp = (mA) => // o que o instrumento representa, na variável/unidade do faceplate
      kind === 'dp2q' ? qhFp * (inst.mode === 'raiz' ? Math.max(fr(mA), 0) : sr(fr(mA))) : conv(instVal(mA), inst.unit, fp.unit);

    // escala efetiva da entrada analógica
    let sl, sh, sunit;
    if (hasScale) { sl = sd.lo; sh = sd.hi; sunit = sd.unit; } else { sl = fp.lo; sh = fp.hi; sunit = fp.unit; }

    const dcs = (mA) => {
      let x, xu;
      if (srcEff === '420') { x = sl + fr(mA) * (sh - sl); xu = sunit; }
      else { x = instVal(mA); xu = inst.unit; }
      let D;
      if (calc === 'none') D = conv(x, xu, fp.unit);
      else if (calc === 'raiz') {
        const xs = srcEff === 'hart' ? conv(x, xu, sd.unit) : x;
        const n = srcEff === 'hart' ? (xs - sd.lo) / (sd.hi - sd.lo) : fr(mA);
        D = fp.lo + (fp.hi - fp.lo) * sr(n);
      } else { // linear
        const xs = sd.unit ? conv(x, xu, sd.unit) : x;
        D = sd.a * (isFinite(xs) ? xs : x) + b;
      }
      return { x, xu, D };
    };

    // --- curva ponto a ponto
    const fpSpan = Math.abs(fp.hi - fp.lo);
    POINTS.forEach((mA) => {
      const I = Ifp(mA), d = dcs(mA);
      const diff = d.D - I, pct = (diff / fpSpan) * 100;
      R.points.push({ mA, instVal: instVal(mA), I, x: d.x, xu: d.xu, D: d.D, diff, pct, ok: Math.abs(pct) <= tolPct });
    });

    // --- faixa equivalente que o instrumento teria de usar (4–20 mA direto)
    let eq = null;
    if (srcEff === 'hart') {
      R.warn.push('HART digital: a faixa 4–20 mA não altera a leitura do SDCD. Conferem unidade, variável e conversão; não há "faixa equivalente".');
    } else if (kind === 'same' && calc !== 'raiz') {
      if (inst.mode === 'raiz' && kind === 'same' && inst.var !== 'vazao') R.warn.push('Transmissor com saída em raiz quadrada e faceplate em ΔP: a raiz deveria estar desligada.');
      const lo = conv(dcs(4).D, fp.unit, inst.unit), hi = conv(dcs(20).D, fp.unit, inst.unit);
      eq = { lo, hi, unit: inst.unit, extra: [] };
    } else if (kind === 'same' && calc === 'raiz') {
      R.warn.push('O SDCD extrai raiz de um sinal que já é ' + VARLABEL[inst.var] + ': não existe faixa linear equivalente.');
    } else if (kind === 'dp2q') {
      const lin = (inst.mode === 'raiz' && calc !== 'raiz') || (inst.mode === 'linear' && calc === 'raiz');
      if (lin) {
        const q4 = dcs(4).D, q20 = dcs(20).D;
        const q20q = conv(q20, fp.unit, q.unit);
        const dpHi = inst.lo + span * Math.pow(q20q / q.hi, 2);
        eq = { lo: inst.lo, hi: dpHi, unit: inst.unit, extra: [
          { label: 'Vazão a 20 mA no faceplate', text: fmt(conv(q20, fp.unit, q.unit)) + ' ' + q.unit },
          { label: 'Premissa', text: 'Q = k·√ΔP, com k obtido do par ' + fmt(inst.hi) + ' ' + inst.unit + ' ↔ ' + fmt(q.hi) + ' ' + q.unit },
        ] };
        if (Math.abs(q4) > 1e-9 * Math.max(1, Math.abs(q20))) R.warn.push('Faceplate tem 4 mA ≠ 0 de vazão: relação Q = k·√ΔP assume zero em 4 mA.');
      } else if (inst.mode === 'raiz') {
        R.warn.push('Raiz dupla: o transmissor já extrai raiz e o SDCD também.');
      } else {
        R.warn.push('Transmissor entrega ΔP linear e o SDCD não extrai raiz: o faceplate lê ΔP como se fosse vazão linear.');
      }
    }
    R.equiv = eq;
    if (eq) {
      const tol = (tolPct / 100) * Math.max(Math.abs(span), Math.abs(eq.hi - eq.lo));
      R.rangeCmp = { loOk: Math.abs(inst.lo - eq.lo) <= tol, hiOk: Math.abs(inst.hi - eq.hi) <= tol };
    }

    // --- folha de dados
    if (ds.unit && isN(ds.lo) && isN(ds.hi)) {
      const lo = conv(ds.lo, ds.unit, inst.unit), hi = conv(ds.hi, ds.unit, inst.unit);
      if (!isFinite(lo) || !isFinite(hi)) R.warn.push('Folha de dados: unidade de grandeza diferente da do instrumento — não comparada.');
      else {
        const near = (a, b, c, d2) => {
          const t = (tolPct / 100) * Math.max(Math.abs(c - a), Math.abs(d2 - b), 1e-12);
          return Math.abs(a - c) <= t && Math.abs(b - d2) <= t;
        };
        const mI = near(lo, hi, inst.lo, inst.hi);
        const mE = eq ? near(lo, hi, eq.lo, eq.hi) : null;
        let text;
        if (mI && mE) text = 'A folha de dados bate com a faixa atual do instrumento e com a equivalente ao SDCD.';
        else if (mI) text = 'A folha de dados bate com a faixa atual do instrumento; não bate com a equivalente ao SDCD.';
        else if (mE) text = 'A folha de dados bate com a faixa equivalente ao SDCD; não bate com a atual do instrumento.';
        else text = eq ? 'A folha de dados não bate com a faixa atual nem com a equivalente ao SDCD.' : 'A folha de dados não bate com a faixa atual do instrumento.';
        R.ds = { lo, hi, unit: inst.unit, matchInst: mI, matchEq: mE, text };
      }
    }

    // --- leitura atual do instrumento → corrente e faceplate esperados
    const rd = m.reading || {};
    if (isN(rd.val)) {
      let mA;
      if (rd.kind === 'ma') mA = rd.val;
      else {
        const nrm = (rd.val - inst.lo) / span;
        mA = 4 + 16 * (rootTx ? (nrm < 0 ? -Math.sqrt(-nrm) : Math.sqrt(nrm)) : nrm);
      }
      const d = dcs(mA);
      R.reading = { mA, instVal: instVal(mA), x: d.x, xu: d.xu, D: d.D, I: Ifp(mA), out: mA < 3.8 || mA > 20.5 };
      if (isN(fp.val)) { R.reading.seen = fp.val; R.reading.diff = fp.val - d.D; R.reading.pct = ((fp.val - d.D) / fpSpan) * 100; }
    }

    // --- valor visto no faceplate → corrente e leitura do Trex que seriam esperadas
    if (isN(fp.val)) {
      let lo = 3, hi = 21;
      const g = (mA) => dcs(mA).D;
      const dir = g(hi) >= g(lo) ? 1 : -1;
      const v = fp.val;
      if ((v - g(lo)) * dir >= 0 && (v - g(hi)) * dir <= 0) {
        for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if ((g(mid) - v) * dir < 0) lo = mid; else hi = mid; }
        const mA = (lo + hi) / 2;
        R.fromFace = { mA, instVal: instVal(mA), unit: inst.unit };
        if (R.reading) R.fromFace.dmA = R.reading.mA - mA;
      } else R.fromFace = { out: true };
    }

    // --- resultado
    const bad = R.points.filter((p) => !p.ok);
    if (R.rangeCmp && (!R.rangeCmp.loOk || !R.rangeCmp.hiOk)) {
      const parts = [];
      if (!R.rangeCmp.loOk) parts.push('4 mA');
      if (!R.rangeCmp.hiOk) parts.push('20 mA');
      R.status = 'div';
      R.summary = 'Divergência no valor correspondente a ' + parts.join(' e ');
    } else if (bad.length) {
      R.status = 'div';
      R.summary = 'Divergência em ' + bad.length + ' de ' + R.points.length + ' pontos da curva (' + bad.map((p) => p.mA + ' mA').join(', ') + ')';
    } else {
      R.status = 'ok';
      R.summary = 'Faixas equivalentes';
    }
    return R;
  }

  // ---------- adaptador: campos do formulário (texto) → modelo numérico ----------
  function fromForm(s) {
    const n = (k) => parseNum(s[k]);
    const iu = UNITS[s['in.unit']];
    const instVar = iu && iu.d === 'p' ? 'pressao' : 'vazao';
    const fpVar = s['fp.var'] === 'vazao' ? 'vazao' : 'pressao';
    // instrumento em pressão e SDCD/faceplate em vazão: o usuário diz se o SDCD extrai a raiz (chave sd.raiz)
    const dp2q = fpVar === 'vazao' && instVar === 'pressao';
    return {
      tipo: s.tipo || 'FT',
      fp: { var: fpVar, unit: s['fp.unit'], lo: n('fp.lo'), hi: n('fp.hi'), val: n('fp.val') },
      inst: {
        var: instVar, unit: s['in.unit'], lo: n('in.lo'), hi: n('in.hi'), mode: dp2q ? 'linear' : '',
        q: dp2q ? { unit: s['ds.unit'], hi: n('ds.hi') } : {},
      },
      reading: { kind: s['in.rkind'] || 'valor', val: n('in.read') },
      ds: dp2q ? {} : { unit: s['ds.unit'], lo: n('ds.lo'), hi: n('ds.hi') },
      sd: {
        src: s['sd.src'] || 'desc', var: '', unit: s['sd.unit'], lo: n('sd.lo'), hi: n('sd.hi'),
        calc: dp2q ? (s['sd.raiz'] === 'sim' ? 'raiz' : 'none') : (s['sd.calc'] || 'none'), a: n('sd.a'), b: n('sd.b'), hart: s['sd.hart'] || '',
        conf: s['sd.conf'] === true || s['sd.conf'] === 'true',
      },
    };
  }

  return { UNITS, VARS, VARLABEL, DIMNAME, unitsFor, conv, sameDim, parseNum, fmt, compute, fromForm, POINTS };
});
