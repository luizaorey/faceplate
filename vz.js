/* Faceplate — tela do módulo de vazão (usa vazao.js). */
(function () {
  'use strict';
  var KEY = 'faceplate.vz.v1';
  var root = document.getElementById('viewVz');
  if (!root || !window.VZ || !window.FP) return;
  var fmt = FP.fmt, SRC = VZ.SRC;
  var store = { cur: '', sims: {} };
  try { var t = JSON.parse(localStorage.getItem(KEY)); if (t && t.sims) store = t; } catch (e) {}
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var UL = {
    qm: Object.keys(FP.UNITS).filter(function (u) { return FP.UNITS[u].d === 'qm'; }),
    p: FP.unitsFor('pressao'),
    flow: FP.unitsFor('vazao'),
    plin: Object.keys(FP.UNITS).filter(function (u) { return FP.UNITS[u].d === 'p' || FP.UNITS[u].d === 'qm'; })
  };
  function opts(list) { return list.map(function (u) { return '<option>' + u + '</option>'; }).join(''); }

  function newSim() {
    return {
      points: [],
      'plate.qmax.u': 'kg/h', 'plate.dpmax.u': 'mmH₂O', 'plate.pop.u': 'kgf/cm²', 'plate.ok': false,
      'scen.q.u': 'kg/h', 'field.qcor.u': 'kg/h', 'field.dp.u': 'mmH₂O', 'field.pin.u': 'kgf/cm²', 'field.pout.u': 'kgf/cm²',
      'pl.src': '420', 'pl.iu': 'mmH₂O', 'pl.pu': 'kg/h', 'pl.tr': 'nc',
      'co.src': '420', 'co.iu': 'kg/h', 'co.pu': 'kg/h', 'co.tr': 'linear'
    };
  }
  function cur() { return store.sims[store.cur] || null; }

  function qty(label, key, list, ph, hint) {
    return '<div class="fld"><label>' + label + '</label><div class="qty"><input type="text" inputmode="decimal" data-vk="' + key + '" placeholder="' + (ph || '') + '" autocomplete="off">' +
      '<select data-vk="' + key + '.u">' + opts(UL[list]) + '</select></div>' + (hint ? '<div class="hint" style="margin:3px 0 0">' + hint + '</div>' : '') + '</div>';
  }
  function chanBlock(pf, title, instList, hint) {
    return '<details class="det" open><summary>' + title + '</summary><div class="db">' +
      '<div class="hint" style="margin:0 0 8px">' + hint + '</div>' +
      '<div class="fld"><label>Origem do sinal</label><select data-vk="' + pf + '.src"><option value="420">4–20 mA</option><option value="hart">HART digital</option><option value="desc">Não sei</option></select></div>' +
      '<div class="sub">Instrumento</div>' +
      '<div class="row"><div class="fld"><label>Início da faixa</label><input type="text" inputmode="decimal" data-vk="' + pf + '.lo" autocomplete="off"></div>' +
      '<div class="fld"><label>Fim da faixa</label><input type="text" inputmode="decimal" data-vk="' + pf + '.hi" autocomplete="off"></div></div>' +
      '<div class="fld"><label>Unidade do instrumento</label><select data-vk="' + pf + '.iu">' + opts(UL[instList]) + '</select></div>' +
      '<div class="sub">Painel (SDCD)</div>' +
      '<div class="row"><div class="fld"><label>Início da faixa</label><input type="text" inputmode="decimal" data-vk="' + pf + '.plo" autocomplete="off"></div>' +
      '<div class="fld"><label>Fim da faixa</label><input type="text" inputmode="decimal" data-vk="' + pf + '.phi" autocomplete="off"></div></div>' +
      '<div class="fld"><label>Unidade no painel</label><select data-vk="' + pf + '.pu">' + opts(UL.flow) + '</select></div>' +
      '<div class="fld"><label>Tratamento do sinal no SDCD</label><select data-vk="' + pf + '.tr"><option value="linear">Linear</option><option value="raiz">Raiz quadrada</option><option value="nc">Não confirmado</option></select></div>' +
      '<div class="fld"><label>Indicação no painel agora <small>(opcional)</small></label><input type="text" inputmode="decimal" data-vk="' + pf + '.read" placeholder="o que o SDCD mostra" autocomplete="off"></div>' +
      '</div></details>';
  }

  root.innerHTML =
    '<div class="panel" style="margin-top:13px"><div class="ph">Cadastro do FT <small>identifica a simulação</small></div><div class="pb">' +
    '<div class="row" style="align-items:flex-end"><div class="fld" style="max-width:110px"><label>Tipo</label><div class="seg"><button class="on" type="button">FT</button></div></div>' +
    '<div class="fld"><label>Número do instrumento</label><div class="qty"><span class="pre">FT-</span><input type="text" id="vzNum" autocomplete="off" autocapitalize="characters" placeholder="ex.: 1234"></div></div>' +
    '</div><button class="btn primary" id="vzOpen" type="button" style="margin-bottom:12px">Abrir / criar</button>' +
    '<div id="vzList"></div></div></div>' +
    '<div id="vzBody" class="hide">' +
    '<div class="grid">' +
    '<section class="panel"><div class="ph">① Placa de orifício <small>folha de dados</small></div><div class="pb">' +
    qty('Vazão máxima de cálculo <small>(linha 29)</small>', 'plate.qmax', 'qm', '4.000') +
    qty('Faixa de pressão diferencial <small>(linha 32)</small>', 'plate.dpmax', 'p', '2.000') +
    qty('Pressão de operação <small>(linha 20, manométrica)</small>', 'plate.pop', 'p', '3,5', 'Só referência de operação; não entra na conversão.') +
    '<label class="chk"><input type="checkbox" data-vk="plate.ok"><span>Confirmo que a vazão máxima e o diferencial acima correspondem ao <b>mesmo ponto de cálculo</b><br><small style="color:#7d95a6">Só então viram o par de referência: Q = Qref·√(ΔP/ΔPref) e ΔP = ΔPref·(Q/Qref)².</small></span></label>' +
    '</div></section>' +
    '<section class="panel"><div class="ph">② Referência da válvula <small>histórico do SDCD</small></div><div class="pb">' +
    '<p class="hint" style="margin:0 0 8px">Abertura e vazão do Coriolis no mesmo horário, processo estável. Se o histórico guarda só o comando, registre como comando.</p>' +
    '<div id="vzPts"></div><button class="btn" id="vzAddPt" type="button">+ Adicionar ponto</button></div></section>' +
    '</div>' +
    '<div class="grid">' +
    '<section class="panel"><div class="ph">③ Cenário e leituras de campo <small>o que estiver disponível</small></div><div class="pb">' +
    '<div class="row"><div class="fld"><label>Comando da válvula (%)</label><input type="text" inputmode="decimal" data-vk="field.cmd" autocomplete="off"></div>' +
    '<div class="fld"><label>Posição real (%)</label><input type="text" inputmode="decimal" data-vk="field.real" autocomplete="off"></div></div>' +
    qty('Vazão informada <small>(opcional)</small>', 'scen.q', 'qm', 'se já souber a vazão') +
    qty('Vazão no Coriolis', 'field.qcor', 'qm', '900') +
    qty('ΔP lido no Trex', 'field.dp', 'p', '') +
    qty('Pressão na tomada de entrada', 'field.pin', 'p', '') +
    qty('Pressão na tomada de saída', 'field.pout', 'p', '') +
    '<p class="hint">Entrada e saída na mesma base (as duas manométricas ou as duas absolutas).</p>' +
    '</div></section>' +
    '<section class="panel"><div class="ph">④ Sinais que chegam ao SDCD</div><div class="pb">' +
    chanBlock('pl', 'Canal da placa (Trex)', 'plin', 'Raiz quadrada uma vez só: se o instrumento entrega ΔP, a raiz fica no SDCD; se já entrega vazão, o SDCD fica linear.') +
    chanBlock('co', 'Canal do Coriolis', 'qm', '4–20 mA linear em vazão mássica: use a escala correspondente em kg/h.') +
    '</div></section>' +
    '</div>' +
    '<div id="vzRes" style="margin-top:14px"></div>' +
    '</div>';

  function bindValues() {
    var s = cur();
    Array.prototype.forEach.call(root.querySelectorAll('[data-vk]'), function (el) {
      var k = el.getAttribute('data-vk'), v = s ? s[k] : '';
      if (el.type === 'checkbox') el.checked = !!v;
      else if (document.activeElement !== el || el.tagName === 'SELECT') el.value = v == null ? '' : v;
    });
  }

  function renderList() {
    var names = Object.keys(store.sims), h = '';
    if (names.length) {
      h = '<div class="hint" style="margin:0 0 6px">Simulações salvas neste aparelho:</div><div class="chips">' +
        names.map(function (n) { return '<span class="chipb' + (n === store.cur ? ' on' : '') + '" data-open="' + esc(n) + '">' + esc(n) + '<span class="x" data-del="' + esc(n) + '">×</span></span>'; }).join('') + '</div>';
    }
    root.querySelector('#vzList').innerHTML = h;
    root.querySelector('#vzBody').classList.toggle('hide', !cur());
    var num = root.querySelector('#vzNum');
    if (document.activeElement !== num) num.value = store.cur ? store.cur.replace(/^FT-/, '') : '';
  }

  function renderPts() {
    var s = cur(); if (!s) return;
    var h = '';
    (s.points || []).forEach(function (p, i) {
      h += '<div class="ptrow"><div class="row"><div class="fld"><label>Abertura (%)</label><input type="text" inputmode="decimal" data-pi="' + i + '" data-pf="open" value="' + esc(p.open || '') + '"></div>' +
        '<div class="fld"><label>É</label><select data-pi="' + i + '" data-pf="kind"><option value="real"' + (p.kind !== 'cmd' ? ' selected' : '') + '>posição real</option><option value="cmd"' + (p.kind === 'cmd' ? ' selected' : '') + '>comando</option></select></div></div>' +
        '<div class="row"><div class="fld"><label>Vazão do Coriolis</label><div class="qty"><input type="text" inputmode="decimal" data-pi="' + i + '" data-pf="q" value="' + esc(p.q || '') + '"><select data-pi="' + i + '" data-pf="u">' +
        UL.qm.map(function (u) { return '<option' + (u === (p.u || 'kg/h') ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="fld"><label>Observação</label><input type="text" data-pi="' + i + '" data-pf="note" placeholder="data/hora" value="' + esc(p.note || '') + '"></div></div>' +
        '<button class="btn" type="button" data-rm="' + i + '">Remover ponto</button></div>';
    });
    if (!h) h = '<p class="hint" style="margin:0 0 8px">Nenhum ponto cadastrado ainda.</p>';
    root.querySelector('#vzPts').innerHTML = h;
  }

  // ---------- resultado ----------
  function cell(x) {
    if (!x) return '<span class="dimv">—</span>';
    var h = '<span class="mono bigv">' + fmt(x.v) + '</span> <small>' + esc(x.u) + '</small> <span class="tag t-' + x.src + '">' + SRC[x.src] + '</span>';
    if (x.txt) h += '<div class="sm">' + esc(x.txt) + '</div>';
    return h;
  }
  function renderRes() {
    var s = cur(), el = root.querySelector('#vzRes'); if (!s) { el.innerHTML = ''; return; }
    var R = VZ.evaluate(s), h = '';
    h += '<div class="box"><h3>Esperado × observado <small style="text-transform:none;letter-spacing:0;color:#7892a3">— ' + esc(store.cur) + '</small></h3><div class="tw"><table class="vzt"><thead><tr><th>Grandeza</th><th>Esperado</th><th>Observado</th><th>Diferença</th></tr></thead><tbody>';
    R.rows.forEach(function (r) {
      var exp = cell(r.exp);
      if (r.alts && r.exp) {
        exp += '<div class="sm">Hipóteses: ' + r.alts.map(function (a) { return a.label + ' ' + fmt(a.v) + (a.coh ? ' (coerente)' : ''); }).join(' · ') + '</div>';
      }
      var d;
      if (r.status === 'ok') d = '<span class="good">✓ confere</span>';
      else if (r.status === 'bad') d = r.diff != null && !r.alts ? '<span class="bad">' + (r.diff > 0 ? '+' : '−') + fmt(Math.abs(r.diff)) + ' ' + esc(r.obs.u) + '<small> ' + (r.diff > 0 ? 'acima' : 'abaixo') + '</small></span>' : '<span class="bad">não confere</span>';
      else if (r.status === 'info' && r.diff != null) d = '<span class="dimv">' + (r.diff > 0 ? '+' : '−') + fmt(Math.abs(r.diff)) + ' ' + esc(r.obs.u) + '</span>';
      else d = '<span class="dimv">—</span>';
      var notes = r.notes.length ? '<div class="sm warnv">' + r.notes.map(esc).join('<br>') + '</div>' : '';
      h += '<tr class="' + (r.status === 'bad' ? 'bad' : r.status === 'ok' ? 'ok' : '') + '"><td><b>' + esc(r.label) + '</b>' + notes + '</td><td>' + exp + '</td><td>' + cell(r.obs) + '</td><td>' + d + '</td></tr>';
    });
    h += '</tbody></table></div><p class="hint" style="margin:8px 0 0">Origem de cada valor: <span class="tag t-historico">histórico</span> <span class="tag t-calculo">cálculo</span> <span class="tag t-campo">leitura de campo</span> <span class="tag t-informado">informado</span> <span class="tag t-folha">folha de dados</span></p></div>';
    h += '<div class="box note"><h3>Diagnóstico</h3>' + R.diag.map(function (d) {
      return '<div class="dg ' + d.sev + '">' + esc(d.text) + (d.tags.length ? ' ' + d.tags.map(function (t) { return '<span class="tag t-' + t + '">' + SRC[t] + '</span>'; }).join(' ') : '') + '</div>';
    }).join('') + '</div>';
    if (R.missing.length) h += '<div class="box note"><h3>Falta informar</h3><ul class="l">' + R.missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul><p class="hint" style="margin:8px 0 0">As comparações que já têm dados continuam disponíveis acima.</p></div>';
    el.innerHTML = h;
  }

  // ---------- eventos ----------
  function open(tag) {
    store.cur = tag; if (!store.sims[tag]) store.sims[tag] = newSim();
    persist(); renderList(); renderPts(); bindValues(); renderRes();
  }
  root.addEventListener('input', function (e) {
    var t = e.target, s = cur(); if (!s) return;
    var k = t.getAttribute('data-vk');
    if (k) { s[k] = t.type === 'checkbox' ? t.checked : t.value; persist(); renderRes(); return; }
    var pi = t.getAttribute('data-pi');
    if (pi != null) { s.points[+pi][t.getAttribute('data-pf')] = t.value; persist(); renderRes(); }
  });
  root.addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'vzOpen') { openFromInput(); return; }
    if (t.id === 'vzAddPt') { var s = cur(); if (s) { s.points.push({ open: '', kind: 'real', q: '', u: 'kg/h', note: '' }); persist(); renderPts(); } return; }
    var rm = t.getAttribute && t.getAttribute('data-rm');
    if (rm != null && rm !== '') { var s2 = cur(); s2.points.splice(+rm, 1); persist(); renderPts(); renderRes(); return; }
    var del = t.getAttribute && t.getAttribute('data-del');
    if (del) { if (confirm('Excluir a simulação ' + del + '?')) { delete store.sims[del]; if (store.cur === del) store.cur = ''; persist(); renderList(); renderRes(); } return; }
    var op = t.closest && t.closest('[data-open]');
    if (op) open(op.getAttribute('data-open'));
  });
  function openFromInput() {
    var v = root.querySelector('#vzNum').value.trim().toUpperCase().replace(/^FT-?/, '');
    if (!v) { root.querySelector('#vzNum').focus(); return; }
    open('FT-' + v);
  }
  root.querySelector('#vzNum').addEventListener('keydown', function (e) { if (e.key === 'Enter') openFromInput(); });

  renderList(); renderPts(); bindValues(); renderRes();
})();
