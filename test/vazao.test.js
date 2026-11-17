const test = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('../vazao.js');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);

const base = () => ({
  'plate.qmax': '4.000', 'plate.qmax.u': 'kg/h', 'plate.dpmax': '2.000', 'plate.dpmax.u': 'mmH₂O',
  'plate.pop': '3,5', 'plate.pop.u': 'kgf/cm²', 'plate.ok': true, 'field.qcor.u': 'kg/h', 'scen.q.u': 'kg/h',
  points: [{ open: '50', kind: 'real', q: '900', u: 'kg/h' }],
  'co.iu': 'kg/h', 'co.lo': '0', 'co.hi': '2000', 'co.pu': 'kg/h', 'co.plo': '0', 'co.phi': '2000', 'co.tr': 'linear',
  'pl.iu': 'mmH₂O', 'pl.lo': '0', 'pl.hi': '2000', 'pl.pu': 'kg/h', 'pl.plo': '0', 'pl.phi': '4000', 'pl.tr': 'nc',
});
const row = (R, id) => R.rows.find((r) => r.id === id);

test('50% real → 900 kg/h histórico; ΔP esperado pela placa', () => {
  const s = base(); s['field.real'] = '50';
  const R = evaluate(s);
  assert.strictEqual(R.Q0.src, 'historico'); near(R.Q0.v, 900);
  near(row(R, 'dp').exp.v, 2000 * Math.pow(900 / 4000, 2), 1e-9);
});

test('Coriolis 900 confere, SDCD 1.200 → destaca diferença e sugere sinal/escala', () => {
  const s = base(); Object.assign(s, { 'field.real': '50', 'field.qcor': '900', 'co.read': '1.200', 'co.read.u': '' });
  const R = evaluate(s);
  assert.strictEqual(row(R, 'q').status, 'ok');
  const rc = row(R, 'pan.co'); assert.strictEqual(rc.status, 'bad'); near(rc.diff, 300); near(rc.exp.v, 900);
  assert.ok(R.diag.some((d) => /escala entre o Coriolis e o SDCD/.test(d.text)));
});

test('só a leitura do Coriolis já confere o painel', () => {
  const s = base(); s.points = []; Object.assign(s, { 'field.qcor': '900', 'co.read': '900' });
  const R = evaluate(s);
  assert.strictEqual(R.Q0.src, 'campo');
  assert.strictEqual(row(R, 'pan.co').status, 'ok');
});

test('comando 50 e retorno 35: diferença de posição vem primeiro', () => {
  const s = base(); Object.assign(s, { 'field.cmd': '50', 'field.real': '35' });
  const R = evaluate(s);
  assert.strictEqual(R.diag[0].sev, 'alta'); assert.ok(/15 pontos abaixo/.test(R.diag[0].text));
});

test('interpolação entre pontos; fora dos pontos falta referência', () => {
  const s = base(); s.points = [{ open: '25', kind: 'real', q: '450', u: 'kg/h' }, { open: '75', kind: 'real', q: '1350', u: 'kg/h' }];
  s['field.real'] = '50'; near(evaluate(s).Q0.v, 900);
  s['field.real'] = '90'; const R = evaluate(s);
  assert.strictEqual(R.Q0, null); assert.ok(R.missing.some((m) => /Falta referência para a abertura de 90%/.test(m)));
});

test('histórico só de comando: 50% de comando', () => {
  const s = base(); s.points = [{ open: '50', kind: 'cmd', q: '900', u: 'kg/h' }]; s['field.cmd'] = '50';
  const R = evaluate(s); near(R.Q0.v, 900); assert.ok(/comando/.test(R.Q0.how));
});

test('par da placa só vale confirmado', () => {
  const s = base(); s['plate.ok'] = false; s['field.real'] = '50';
  const R = evaluate(s);
  assert.strictEqual(R.pair, null); assert.strictEqual(row(R, 'dp').exp, null);
  assert.ok(R.missing.some((m) => /confirmar que/.test(m)));
});

test('placa: ΔP lido → vazão (Q = Qref·√(ΔP/ΔPref)) e pressão de saída com conversão', () => {
  const s = base(); Object.assign(s, { 'field.dp': '500', 'field.dp.u': 'mmH₂O', 'field.pin': '3,5', 'field.pin.u': 'kgf/cm²', 'field.pout': '3,45', 'field.pout.u': 'kgf/cm²' });
  const R = evaluate(s);
  near(R.rows.find((r) => r.id === 'qdp').obs.v, 4000 * Math.sqrt(500 / 2000), 1e-6); // 2000 kg/h
  near(row(R, 'pout').exp.v, 3.5 - 0.05, 1e-9);
  assert.strictEqual(row(R, 'pout').status, 'ok');
});

test('canal da placa não confirmado: mostra Linear e Raiz; SDCD com raiz bate', () => {
  const s = base(); Object.assign(s, { 'field.dp': '500', 'field.dp.u': 'mmH₂O', 'pl.read': '2.000' });
  const R = evaluate(s); const r = row(R, 'pan.pl');
  assert.strictEqual(r.alts.length, 2);
  near(r.alts.find((a) => a.label === 'Raiz quadrada').v, 2000, 1e-6);
  near(r.alts.find((a) => a.label === 'Linear').v, 1000, 1e-6);
  assert.strictEqual(r.status, 'ok');
  s['pl.read'] = '1.000'; const R2 = evaluate(s);
  assert.strictEqual(row(R2, 'pan.pl').status, 'bad'); assert.ok(R2.diag.some((d) => /raiz quadrada uma vez só/.test(d.text)));
});

test('raiz dupla: transmissor em vazão + SDCD raiz é avisado', () => {
  const s = base(); Object.assign(s, { 'pl.iu': 'kg/h', 'pl.lo': '0', 'pl.hi': '4000', 'pl.tr': 'raiz', 'field.real': '50' });
  const r = row(evaluate(s), 'pan.pl'); assert.ok(r.notes.some((n) => /Raiz dupla/.test(n)));
});

test('canal incompleto: lista o que falta e mantém as outras comparações', () => {
  const s = base(); s['co.hi'] = ''; Object.assign(s, { 'field.qcor': '900', 'field.real': '50' });
  const R = evaluate(s);
  assert.ok(R.missing.some((m) => /Canal do Coriolis/.test(m)));
  assert.strictEqual(row(R, 'q').status, 'ok');
});
