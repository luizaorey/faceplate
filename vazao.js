/* Faceplate — módulo de vazão (linha: válvula → placa de orifício → Trex / Coriolis → SDCD).
 * Motor puro (sem DOM). Depende de calc.js (unidades, conversão, parseNum, fmt).
 *
 * Origem de cada valor: 'historico' | 'calculo' | 'campo' | 'informado' | 'folha'.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.VZ = factory(root.FP);
})(typeof self !== 'undefined' ? self : this, function (FP) {
  'use strict';
  const { conv, parseNum: P, UNITS, fmt } = FP;
  const isN = (v) => typeof v === 'number' && isFinite(v);
  const isDim = (u, d) => !!(UNITS[u] && UNITS[u].d === d);
  const SRC = { historico: 'histórico', calculo: 'cálculo', campo: 'leitura de campo', informado: 'informado', folha: 'folha de dados' };

  // casas decimais digitadas → resolução da indicação (100.000 = milhar)
  function decs(str) {
    str = String(str == null ? '' : str).trim();
    const m = str.match(/([.,])(\d+)$/);
    if (!m) return 0;
    if (m[1] === '.' && m[2].length === 3 && str.indexOf(',') < 0) return 0;
    return m[2].length;
  }

  function evaluate(sim) {
    sim = sim || {};
    const num = (k) => P(sim[k]);
    const un = (k) => sim[k + '.u'] || '';
    const val = (k, dim) => { const v = num(k), u = un(k); return isN(v) && isDim(u, dim) ? { v, u } : null; };
    const R = { rows: [], diag: [], missing: [], Q0: null, valve: { msgs: [] }, pair: null };
    const miss = (t) => { if (R.missing.indexOf(t) < 0) R.missing.push(t); };

    // ---------- placa: par de referência confirmado ----------
    const qm = val('plate.qmax', 'qm'), dpm = val('plate.dpmax', 'p');
    let pair = null;
    if (!qm || qm.v <= 0 || !dpm || dpm.v <= 0) miss('Placa: vazão máxima de cálculo e faixa de pressão diferencial (valor e unidade)');
    else if (!sim['plate.ok']) miss('Placa: confirmar que ' + fmt(qm.v) + ' ' + qm.u + ' e ' + fmt(dpm.v) + ' ' + dpm.u + ' correspondem ao mesmo ponto de cálculo');
    else pair = { Q: qm.v, Qu: qm.u, D: dpm.v, Du: dpm.u };
    R.pair = pair;
    const dpFromQ = (Q, Qu) => pair.D * Math.pow(conv(Q, Qu, pair.Qu) / pair.Q, 2); // em pair.Du
    const qFromDp = (D, Du) => pair.Q * Math.sqrt(Math.max(conv(D, Du, pair.Du), 0) / pair.D); // em pair.Qu

    // ---------- válvula: estimativa pelo histórico ----------
    const cmd = num('field.cmd'), real = num('field.real');
    const pts = (sim.points || []).map((p) => ({ o: P(p.open), k: p.kind === 'cmd' ? 'cmd' : 'real', q: P(p.q), u: p.u || 'kg/h' }))
      .filter((p) => isN(p.o) && isN(p.q) && isDim(p.u, 'qm'));
    let ve = null;
    const cands = [];
    if (isN(real)) cands.push({ x: real, k: 'real' });
    if (isN(cmd)) cands.push({ x: cmd, k: 'cmd' });
    cands.forEach((c) => {
      if (ve) return;
      const kn = c.k === 'real' ? 'posição real' : 'comando';
      const ps = pts.filter((p) => p.k === c.k).sort((a, b) => a.o - b.o);
      if (!ps.length) { R.valve.msgs.push('Sem pontos cadastrados de ' + kn + ' no histórico.'); return; }
      const ex = ps.find((p) => Math.abs(p.o - c.x) < 1e-9);
      if (ex) { ve = { v: ex.q, u: ex.u, how: 'ponto cadastrado de ' + fmt(ex.o) + '% de ' + kn, x: c.x, k: c.k }; return; }
      const lo = ps.filter((p) => p.o < c.x).pop(), hi = ps.find((p) => p.o > c.x);
      if (lo && hi) {
        const q = lo.q + ((c.x - lo.o) / (hi.o - lo.o)) * (conv(hi.q, hi.u, lo.u) - lo.q);
        ve = { v: q, u: lo.u, how: 'estimado entre ' + fmt(lo.o) + '% e ' + fmt(hi.o) + '% de ' + kn, x: c.x, k: c.k, interp: true };
      } else {
        R.valve.msgs.push('Falta referência para a abertura de ' + fmt(c.x) + '% (' + kn + '): pontos cadastrados de ' + fmt(ps[0].o) + '% a ' + fmt(ps[ps.length - 1].o) + '%.');
      }
    });
    R.valve.est = ve;
    R.valve.msgs.forEach(miss);

    // ---------- vazão do cenário ----------
    const informed = val('scen.q', 'qm');
    const qcor = val('field.qcor', 'qm');
    let Q0 = null;
    if (informed) Q0 = { v: informed.v, u: informed.u, src: 'informado' };
    else if (ve) Q0 = { v: ve.v, u: ve.u, src: 'historico', how: ve.how };
    else if (qcor) Q0 = { v: qcor.v, u: qcor.u, src: 'campo' };
    R.Q0 = Q0;

    const dpf = val('field.dp', 'p');
    const pinv = val('field.pin', 'p');
    const poutv = val('field.pout', 'p');

    // comparador: obs convertido para a unidade do esperado
    const mk = (id, label, exp, obs, tolAbs, extra) => {
      const r = Object.assign({ id, label, exp, obs, status: 'na', diff: null, tol: tolAbs, notes: [] }, extra || {});
      if (exp && obs && isN(exp.v) && isN(obs.v)) {
        r.diff = obs.v - exp.v;
        r.status = Math.abs(r.diff) <= tolAbs ? 'ok' : 'bad';
      }
      R.rows.push(r);
      return r;
    };
    const resTol = (key, rel, base) => Math.max(rel * Math.abs(base), 0.5 * Math.pow(10, -decs(sim[key])));

    // 1) válvula
    mk('valve', 'Válvula: comando × posição real',
      isN(cmd) ? { v: cmd, u: '%', src: 'campo', txt: 'comando' } : null,
      isN(real) ? { v: real, u: '%', src: 'campo', txt: 'retorno' } : null, 2);

    // 2) vazão do Coriolis × referência
    const expQ = informed ? { v: informed.v, u: informed.u, src: 'informado' } : ve ? { v: ve.v, u: ve.u, src: 'historico', txt: ve.how } : null;
    const rq = mk('q', 'Vazão (Coriolis)', expQ,
      qcor ? { v: isDim(expQ && expQ.u, 'qm') ? conv(qcor.v, qcor.u, expQ.u) : qcor.v, u: expQ ? expQ.u : qcor.u, src: 'campo' } : null,
      expQ ? resTol('field.qcor', 0.02, expQ.v) : 0);
    if (!expQ && (isN(cmd) || isN(real))) rq.notes.push('Sem referência de vazão para esta abertura.');

    // 3) ΔP da placa
    let expDp = null;
    if (Q0 && pair) {
      const du = dpf ? dpf.u : pair.Du;
      expDp = { v: conv(dpFromQ(Q0.v, Q0.u), pair.Du, du), u: du, src: 'calculo', txt: 'para ' + fmt(Q0.v) + ' ' + Q0.u + ' (' + SRC[Q0.src] + ')' };
    }
    const rd = mk('dp', 'Diferencial da placa (Trex)', expDp, dpf ? { v: dpf.v, u: dpf.u, src: 'campo' } : null,
      expDp ? resTol('field.dp', 0.03, expDp.v) : 0);
    if (!pair && (Q0 || dpf)) rd.notes.push('Falta confirmar o par de referência da placa.');
    if (pair && !Q0) rd.notes.push('Falta a vazão do cenário (abertura com referência, vazão informada ou leitura do Coriolis).');

    // 4) vazão estimada pela placa (do ΔP lido)
    if (pair && dpf) {
      const qd = qFromDp(dpf.v, dpf.u);
      const tu = Q0 ? Q0.u : pair.Qu;
      const obsQ = { v: conv(qd, pair.Qu, tu), u: tu, src: 'calculo', txt: 'pela placa, do ΔP lido' };
      mk('qdp', 'Vazão pela placa (do ΔP lido)', Q0 ? { v: Q0.v, u: Q0.u, src: Q0.src, txt: Q0.how } : null, obsQ, Q0 ? resTol('field.dp', 0.02, Q0.v) : 0);
    }

    // 5) pressões nas tomadas
    if (pinv || sim['plate.pop']) {
      const pop = val('plate.pop', 'p');
      const r = mk('pin', 'Pressão na tomada de entrada',
        pop ? { v: pop.v, u: pop.u, src: 'folha', txt: 'operação (referência)' } : null,
        pinv ? { v: pop ? conv(pinv.v, pinv.u, pop.u) : pinv.v, u: pop ? pop.u : pinv.u, src: 'campo' } : null, Infinity);
      r.status = 'info';
    }
    if (pinv) {
      let dpUse = null, dsrc = '';
      if (dpf) { dpUse = dpf; dsrc = 'ΔP lido no Trex'; }
      else if (expDp) { dpUse = expDp; dsrc = 'ΔP calculado'; }
      const expPout = dpUse ? { v: pinv.v - conv(dpUse.v, dpUse.u, pinv.u), u: pinv.u, src: 'calculo', txt: 'entrada − ' + dsrc } : null;
      const rp = mk('pout', 'Pressão na tomada de saída', expPout,
        poutv ? { v: conv(poutv.v, poutv.u, pinv.u), u: pinv.u, src: 'campo' } : null,
        expPout ? Math.max(0.02 * Math.abs(pinv.v), 0.5 * Math.pow(10, -decs(sim['field.pout']))) : 0);
      if (!dpUse) rp.notes.push('Falta o ΔP (lido no Trex ou calculado) para obter a saída.');
    }

    // ---------- canais no SDCD ----------
    const chan = (pf) => {
      const iu = sim[pf + '.iu'], lo = num(pf + '.lo'), hi = num(pf + '.hi');
      const pu = sim[pf + '.pu'], plo = num(pf + '.plo'), phi = num(pf + '.phi');
      const tr = sim[pf + '.tr'] || (pf === 'pl' ? 'nc' : 'linear');
      const nm = pf === 'pl' ? 'Canal da placa (Trex)' : 'Canal do Coriolis';
      const out = { miss: [], warn: [], exp: null, nm };
      const cfgInst = iu && isN(lo) && isN(hi) && lo !== hi, cfgPan = pu && isN(plo) && isN(phi) && plo !== phi;
      // vazão do Coriolis (campo) ou do cenário
      const Qc = qcor ? { v: qcor.v, u: qcor.u, src: 'campo' } : Q0;
      if (pf === 'co' && !cfgInst && !cfgPan && isDim(pu, 'qm') && Qc) {
        out.exp = { v: conv(Qc.v, Qc.u, pu), u: pu, src: Qc.src === 'campo' ? 'campo' : 'calculo', txt: 'sem faixa cadastrada: assume o mesmo valor do Coriolis' };
        out.warn.push('Canal do Coriolis sem faixa cadastrada: comparação 1:1 (o painel deveria mostrar o mesmo valor do Coriolis).');
        return out;
      }
      if (!cfgInst) out.miss.push(nm + ': unidade e faixa do instrumento');
      if (!cfgPan) out.miss.push(nm + ': unidade e faixa no painel');
      if (out.miss.length) return out;
      let f = null, src = '', basis = '';
      if (pf === 'pl') {
        if (isDim(iu, 'p')) {
          if (dpf) { f = (conv(dpf.v, dpf.u, iu) - lo) / (hi - lo); src = 'campo'; basis = 'ΔP lido no Trex'; }
          else if (pair && Q0) { f = (conv(dpFromQ(Q0.v, Q0.u), pair.Du, iu) - lo) / (hi - lo); src = 'calculo'; basis = 'ΔP calculado'; }
          else out.miss.push(nm + ': falta o ΔP (leitura do Trex ou par da placa confirmado com vazão do cenário)');
        } else if (isDim(iu, 'qm')) {
          let Q = null;
          if (dpf && pair) Q = { v: qFromDp(dpf.v, dpf.u), u: pair.Qu, src: 'campo' };
          else if (Q0) Q = Q0;
          if (Q) { f = (conv(Q.v, Q.u, iu) - lo) / (hi - lo); src = Q.src === 'campo' ? 'campo' : 'calculo'; basis = 'vazão do transmissor'; }
          else out.miss.push(nm + ': falta a vazão do cenário');
        } else out.miss.push(nm + ': unidade do instrumento deve ser pressão (ΔP) ou vazão mássica');
      } else {
        if (!isDim(iu, 'qm')) out.miss.push(nm + ': unidade do instrumento deve ser vazão mássica (kg/h, t/h…)');
        else if (Qc) { f = (conv(Qc.v, Qc.u, iu) - lo) / (hi - lo); src = Qc.src === 'campo' ? 'campo' : 'calculo'; basis = Qc.src === 'campo' ? 'leitura do Coriolis' : 'vazão do cenário'; }
        else out.miss.push(nm + ': falta a leitura do Coriolis ou a vazão do cenário');
      }
      if (f == null || !isFinite(f)) return out;
      const lin = plo + (phi - plo) * f, rt = plo + (phi - plo) * Math.sqrt(Math.max(f, 0));
      const pressIn = pf === 'pl' && isDim(iu, 'p');
      const alts = [{ label: 'Linear', v: lin, coh: !pressIn }, { label: 'Raiz quadrada', v: rt, coh: pressIn }];
      const pick = tr === 'linear' ? alts[0] : tr === 'raiz' ? alts[1] : alts.find((a) => a.coh);
      if (pf === 'pl' && pressIn && tr === 'linear') out.warn.push('Instrumento entrega ΔP e o SDCD está linear: a raiz quadrada não foi aplicada (a indicação seguiria o ΔP, não a vazão).');
      if (pf === 'pl' && !pressIn && tr === 'raiz') out.warn.push('Raiz dupla: o transmissor já extrai a raiz e o SDCD também.');
      if (pf === 'co' && tr === 'raiz') out.warn.push('Coriolis em 4–20 mA linear de vazão mássica: não se aplica raiz quadrada.');
      if (f < -0.0001 || f > 1.0001) out.warn.push('Fora da faixa do instrumento (' + fmt(4 + 16 * f, 1) + ' mA).');
      out.mA = 4 + 16 * f;
      out.exp = { v: pick.v, u: pu, src, txt: basis + ' · ' + fmt(4 + 16 * f, 2) + ' mA', alts: tr === 'nc' ? alts : null, tr, pickLabel: pick.label, allAlts: alts };
      return out;
    };
    const panelRow = (pf, label) => {
      const c = chan(pf);
      const key = pf + '.read', pu = sim[pf + '.pu'];
      const obsv = num(key);
      const obs = isN(obsv) && pu ? { v: obsv, u: pu, src: 'campo' } : null;
      const span = Math.abs(num(pf + '.phi') - num(pf + '.plo')) || 0;
      const tol = c.exp ? Math.max(0.005 * span, 0.5 * Math.pow(10, -decs(sim[key])), 1e-9) : 0;
      const r = mk('pan.' + pf, label, c.exp, obs, tol, { alts: c.exp && c.exp.alts });
      c.miss.forEach((t) => { miss(t); r.notes.push(t); });
      c.warn.forEach((t) => r.notes.push(t));
      if (c.exp && obs && c.exp.alts) {
        // não confirmado: confere se bate com a hipótese coerente, ou com a outra
        const hit = c.exp.alts.filter((a) => Math.abs(obs.v - a.v) <= tol);
        r.hit = hit.map((a) => a.label);
        r.status = hit.some((a) => a.coh) ? 'ok' : 'bad';
      }
      r.chan = c;
      return r;
    };
    const rpl = panelRow('pl', 'Indicação no SDCD — canal da placa (Trex)');
    const rco = panelRow('co', 'Indicação no SDCD — canal do Coriolis');

    // ---------- diagnóstico (ordem de prioridade) ----------
    const D = (sev, text, tags) => R.diag.push({ sev, text, tags: Array.from(new Set(tags || [])) });
    const sgn = (d) => (d < 0 ? 'abaixo' : 'acima');
    const u2 = (r) => (r.exp ? r.exp.u : r.obs.u);
    const rv = R.rows.find((r) => r.id === 'valve');
    if (rv.status === 'bad') {
      D('alta', 'Comando ' + fmt(cmd) + '% e retorno ' + fmt(real) + '%: a válvula está ' + fmt(Math.abs(rv.diff)) + ' pontos ' + sgn(rv.diff) + ' do comando. Confira primeiro a posição da válvula (atuador, posicionador, retorno) antes de comparar as vazões.', ['campo']);
    }
    if (ve && ve.k === 'cmd' && isN(real)) {
      D('info', 'O histórico só tem pontos de comando: a referência de vazão usa o comando (' + fmt(ve.x) + '%), não a posição real.', ['historico']);
    }
    if ((isN(cmd) || isN(real)) && !ve && !informed) {
      D('info', R.valve.msgs.length ? R.valve.msgs.join(' ') : 'Sem referência histórica para esta abertura.', ['historico']);
    }
    if (rq.status === 'bad') {
      D('alta', 'Coriolis em ' + fmt(rq.obs.v) + ' ' + rq.obs.u + ' contra ' + fmt(rq.exp.v) + ' ' + rq.exp.u + ' de referência (' + SRC[rq.exp.src] + '): ' + fmt(Math.abs(rq.diff)) + ' ' + rq.obs.u + ' ' + sgn(rq.diff) + '. Condição de processo diferente da do histórico, ou o medidor/escala precisa ser conferido.', ['campo', rq.exp.src]);
    }
    const panelDiag = (r, nm, outro) => {
      if (r.status !== 'bad' || !r.obs || !r.exp) return;
      let t = nm + ' mostra ' + fmt(r.obs.v) + ' ' + r.obs.u + '; o esperado é ' + fmt(r.exp.v) + ' ' + r.exp.u + ' (' + r.exp.txt.split(' · ')[0] + '): ' + fmt(Math.abs(r.diff)) + ' ' + r.obs.u + ' ' + sgn(r.diff) + '.';
      if (r.hit && r.hit.length) t += ' O valor coincide com o cálculo ' + r.hit.join(' / ').toLowerCase() + ': confira o tratamento do sinal (raiz quadrada uma vez só).';
      else t += ' ' + outro;
      D('alta', t, ['campo', r.exp.src]);
    };
    panelDiag(rco, 'O SDCD (canal do Coriolis)', 'Confira o sinal, a configuração da entrada e a escala entre o Coriolis e o SDCD.');
    panelDiag(rpl, 'O SDCD (canal da placa)', 'Confira o sinal do Trex, a configuração da entrada, a escala e o tratamento (raiz quadrada) no SDCD.');
    const rdp = R.rows.find((r) => r.id === 'dp');
    if (rdp.status === 'bad') D('media', 'ΔP lido no Trex: ' + fmt(rdp.obs.v) + ' ' + rdp.obs.u + '; esperado ' + fmt(rdp.exp.v) + ' ' + rdp.exp.u + ' para essa vazão (' + fmt(Math.abs(rdp.diff)) + ' ' + rdp.obs.u + ' ' + sgn(rdp.diff) + '). Confira o zero e a faixa do Trex, as tomadas e o par de referência da placa.', ['campo', 'calculo']);
    const rqd = R.rows.find((r) => r.id === 'qdp');
    if (rqd && rqd.status === 'bad') D('media', 'Vazão pela placa (do ΔP lido) é ' + fmt(rqd.obs.v) + ' ' + rqd.obs.u + ' contra ' + fmt(rqd.exp.v) + ' ' + rqd.exp.u + ' (' + SRC[rqd.exp.src] + ').', ['calculo', rqd.exp.src]);
    const rpo = R.rows.find((r) => r.id === 'pout');
    if (rpo && rpo.status === 'bad') D('media', 'Pressão de saída lida: ' + fmt(rpo.obs.v) + ' ' + rpo.obs.u + '; entrada − ΔP dá ' + fmt(rpo.exp.v) + ' ' + rpo.exp.u + ' (' + fmt(Math.abs(rpo.diff)) + ' ' + sgn(rpo.diff) + '). Confira os manômetros das tomadas e o ΔP.', ['campo', 'calculo']);
    if (!R.diag.some((d) => d.sev === 'alta' || d.sev === 'media')) {
      const compared = R.rows.filter((r) => r.status === 'ok').length;
      if (compared) D('ok', 'Nada fora do esperado nas ' + compared + ' comparações possíveis com os dados informados.', []);
      else D('info', 'Ainda não há duas informações para comparar. Preencha leituras de campo ou a referência da válvula.', []);
    }
    return R;
  }

  return { evaluate, decs, SRC };
});
