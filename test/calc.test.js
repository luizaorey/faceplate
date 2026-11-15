const test = require('node:test');
const assert = require('node:assert');
const { compute, parseNum, conv, fromForm } = require('../calc.js');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);

const base = () => ({
  fp: { var: 'vazao', unit: 'L/h', lo: 0, hi: 100000, val: null },
  inst: { var: 'vazao', unit: 'm³/h', lo: 0, hi: 150, mode: '', q: {} },
  reading: {}, ds: {},
  sd: { src: '420', var: 'vazao', unit: 'L/h', lo: 0, hi: 100000, calc: 'none', conf: true },
});

test('parseNum pt-BR', () => {
  assert.strictEqual(parseNum('100.000'), 100000);
  assert.strictEqual(parseNum('0,5'), 0.5);
  assert.strictEqual(parseNum('0.5'), 0.5);
  assert.strictEqual(parseNum('1.234,5'), 1234.5);
  assert.strictEqual(parseNum('abc'), null);
  assert.strictEqual(parseNum(''), null);
});

test('unidades', () => {
  near(conv(100, 'm³/h', 'L/h'), 100000);
  near(conv(1, 'bar', 'kPa'), 100);
  near(conv(1, 'kgf/cm²', 'kPa'), 98.0665);
  assert.ok(isNaN(conv(1, 'bar', 'L/h')));
});

test('exemplo do PDS: FT 0–150 m³/h × faceplate 0–100.000 L/h', () => {
  const m = base();
  m.reading = { kind: 'valor', val: 75 };
  m.fp.val = 50000;
  const r = compute(m);
  assert.strictEqual(r.status, 'div');
  assert.strictEqual(r.hyp, false);
  near(r.equiv.lo, 0); near(r.equiv.hi, 100);
  assert.strictEqual(r.rangeCmp.loOk, true);
  assert.strictEqual(r.rangeCmp.hiOk, false);
  assert.match(r.summary, /20 mA/);
  const p12 = r.points.find((p) => p.mA === 12);
  near(p12.instVal, 75); near(p12.I, 75000); near(p12.D, 50000);
  near(r.reading.mA, 12); near(r.reading.D, 50000);
  near(r.fromFace.mA, 12); near(r.fromFace.instVal, 75);
});

test('mesma variável, só unidade: equivalente', () => {
  const m = base(); m.inst.hi = 100;
  const r = compute(m);
  assert.strictEqual(r.status, 'ok');
});

test('sem escala do SDCD: hipótese = faixa do faceplate', () => {
  const m = base(); m.sd = { src: 'desc', calc: 'none' };
  const r = compute(m);
  assert.strictEqual(r.hyp, true);
  assert.strictEqual(r.status, 'div');
  near(r.equiv.hi, 100);
  assert.ok(r.confirm.length >= 2);
});

test('folha de dados indica qual faixa confere', () => {
  const m = base(); m.ds = { unit: 'm³/h', lo: 0, hi: 100 };
  let r = compute(m);
  assert.strictEqual(r.ds.matchEq, true); assert.strictEqual(r.ds.matchInst, false);
  m.ds.hi = 150; r = compute(m);
  assert.strictEqual(r.ds.matchInst, true); assert.strictEqual(r.ds.matchEq, false);
});

test('ΔP linear + raiz no SDCD = ok', () => {
  const m = base();
  m.fp = { var: 'vazao', unit: 'm³/h', lo: 0, hi: 150 };
  m.inst = { var: 'dp', unit: 'mmH₂O', lo: 0, hi: 2500, mode: 'linear', q: { unit: 'm³/h', hi: 150 } };
  m.sd = { src: '420', calc: 'raiz', conf: true };
  const r = compute(m);
  assert.strictEqual(r.status, 'ok');
  near(r.equiv.hi, 2500);
});

test('ΔP linear sem raiz no SDCD = divergência na curva', () => {
  const m = base();
  m.fp = { var: 'vazao', unit: 'm³/h', lo: 0, hi: 150 };
  m.inst = { var: 'dp', unit: 'mmH₂O', lo: 0, hi: 2500, mode: 'linear', q: { unit: 'm³/h', hi: 150 } };
  m.sd = { src: '420', calc: 'none', conf: true };
  const r = compute(m);
  assert.strictEqual(r.status, 'div');
  assert.strictEqual(r.equiv, null);
  assert.ok(r.warn.some((w) => /não extrai raiz/.test(w)));
});

test('raiz no transmissor + SDCD linear em vazão; equivalente em ΔP', () => {
  const m = base();
  m.fp = { var: 'vazao', unit: 'm³/h', lo: 0, hi: 100 };
  m.inst = { var: 'dp', unit: 'mmH₂O', lo: 0, hi: 2500, mode: 'raiz', q: { unit: 'm³/h', hi: 150 } };
  m.sd = { src: '420', calc: 'none', unit: 'm³/h', lo: 0, hi: 100, conf: true };
  const r = compute(m);
  assert.strictEqual(r.status, 'div');
  near(r.equiv.hi, 2500 * Math.pow(100 / 150, 2), 1e-6);
  assert.strictEqual(r.rangeCmp.hiOk, false);
});

test('raiz dupla é avisada', () => {
  const m = base();
  m.fp = { var: 'vazao', unit: 'm³/h', lo: 0, hi: 150 };
  m.inst = { var: 'dp', unit: 'mmH₂O', lo: 0, hi: 2500, mode: 'raiz', q: { unit: 'm³/h', hi: 150 } };
  m.sd = { src: '420', calc: 'raiz', conf: true };
  const r = compute(m);
  assert.strictEqual(r.status, 'div');
  assert.ok(r.warn.some((w) => /Raiz dupla/.test(w)));
});

test('dados insuficientes: ΔP sem local da raiz e sem vazão correspondente', () => {
  const m = base();
  m.fp = { var: 'vazao', unit: 'm³/h', lo: 0, hi: 150 };
  m.inst = { var: 'dp', unit: 'mmH₂O', lo: 0, hi: 2500, mode: '', q: {} };
  const r = compute(m);
  assert.strictEqual(r.status, 'insuf');
  const ids = r.miss.map((x) => x.id);
  assert.ok(ids.includes('in.mode') && ids.includes('ds.hi'));
});

test('dados insuficientes: faixa do faceplate vazia', () => {
  const m = base(); m.fp.hi = null;
  const r = compute(m);
  assert.strictEqual(r.status, 'insuf');
  assert.deepStrictEqual(r.miss.map((x) => x.id), ['fp.hi']);
});

test('HART digital exige variável e conversão; sem faixa equivalente', () => {
  const m = base(); m.sd = { src: 'hart', calc: 'none', conf: true };
  let r = compute(m);
  assert.strictEqual(r.status, 'insuf');
  assert.ok(r.miss.some((x) => x.id === 'sd.hart'));
  m.sd.hart = 'PV';
  r = compute(m);
  assert.strictEqual(r.equiv, null);
  assert.strictEqual(r.status, 'ok'); // valor digital convertido: 75 m³/h = 75.000 L/h, faceplate 0–100.000 só muda o span
});

test('PT: bar × kPa', () => {
  const m = {
    fp: { var: 'pressao', unit: 'kPa', lo: 0, hi: 1000 },
    inst: { var: 'pressao', unit: 'bar', lo: 0, hi: 10, mode: '', q: {} }, reading: { kind: 'valor', val: 5 }, ds: {},
    sd: { src: '420', calc: 'none', unit: 'kPa', lo: 0, hi: 1000, conf: true },
  };
  const r = compute(m);
  assert.strictEqual(r.status, 'ok');
  near(r.reading.mA, 12); near(r.reading.D, 500);
});

test('leitura em mA', () => {
  const m = base(); m.reading = { kind: 'ma', val: 8 };
  const r = compute(m);
  near(r.reading.instVal, 37.5); near(r.reading.D, 25000);
});

test('fromForm', () => {
  const m = fromForm({ 'fp.var': 'vazao', 'fp.unit': 'L/h', 'fp.lo': '0', 'fp.hi': '100.000', 'in.var': 'vazao', 'in.unit': 'm³/h', 'in.lo': '0', 'in.hi': '150', 'sd.conf': true });
  assert.strictEqual(m.fp.hi, 100000);
  assert.strictEqual(compute(m).status, 'div');
});

test('PT em campo (pressão) × vazão no SDCD/faceplate', () => {
  const m = {
    fp: { var: 'vazao', unit: 'm³/h', lo: 0, hi: 150 },
    inst: { var: 'pressao', unit: 'kPa', lo: 0, hi: 25, mode: 'linear', q: { unit: 'm³/h', hi: 150 } },
    reading: {}, ds: {}, sd: { src: '420', var: 'dp', calc: 'raiz', conf: true },
  };
  assert.strictEqual(compute(m).status, 'ok');
  m.sd.calc = 'none';
  assert.strictEqual(compute(m).status, 'insuf'); // entrada em pressão, faceplate em vazão, sem cálculo
});

test('FT em campo mas faceplate em pressão = não compara', () => {
  const m = base(); m.fp = { var: 'pressao', unit: 'kPa', lo: 0, hi: 100 };
  assert.strictEqual(compute(m).status, 'insuf');
});

test('formulário: instrumento em pressão + SDCD em vazão = chave de raiz no SDCD', () => {
  const f = { 'fp.var': 'vazao', 'fp.unit': 'm³/h', 'fp.lo': '0', 'fp.hi': '150', 'in.unit': 'mmH₂O', 'in.lo': '0', 'in.hi': '2500',
    'ds.unit': 'm³/h', 'ds.hi': '150', 'sd.src': '420', 'sd.conf': true, 'sd.raiz': 'sim' };
  let r = compute(fromForm(f));
  assert.strictEqual(r.status, 'ok');
  f['fp.hi'] = '100'; r = compute(fromForm(f));
  assert.strictEqual(r.status, 'div');
  near(r.equiv.hi, 2500 * Math.pow(100 / 150, 2), 1e-6);
  delete f['ds.hi']; r = compute(fromForm(f));
  assert.strictEqual(r.status, 'insuf');
  assert.deepStrictEqual(r.miss.map((x) => x.id), ['ds.hi']);
});

test('chave de raiz: Não extrair dá divergência, Extrair confere', () => {
  const f = { 'fp.var': 'vazao', 'fp.unit': 'm³/h', 'fp.lo': '0', 'fp.hi': '200', 'fp.val': '141,4', 'in.unit': 'kPa', 'in.lo': '0', 'in.hi': '50',
    'ds.unit': 'm³/h', 'ds.hi': '200', 'in.rkind': 'valor', 'in.read': '25', 'sd.src': '420', 'sd.conf': true, 'sd.raiz': 'nao' };
  assert.strictEqual(compute(fromForm(f)).status, 'div');
  f['sd.raiz'] = 'sim';
  const r = compute(fromForm(f));
  assert.strictEqual(r.status, 'ok');
  near(r.reading.D, 141.42, 0.01);
});

test('raiz no SDCD usa a faixa de vazão informada no SDCD (não a do faceplate)', () => {
  const f = { 'fp.var': 'vazao', 'fp.unit': 'm³/h', 'fp.lo': '0', 'fp.hi': '200', 'in.unit': 'kPa', 'in.lo': '0', 'in.hi': '50',
    'ds.unit': 'm³/h', 'ds.hi': '200', 'sd.src': '420', 'sd.conf': true, 'sd.raiz': 'sim',
    'sd.unit': 'L/h', 'sd.lo': '0', 'sd.hi': '150.000' };
  const r = compute(fromForm(f));
  assert.strictEqual(r.status, 'div');
  near(r.points[4].D, 150, 1e-6);
  near(r.equiv.hi, 50 * Math.pow(150 / 200, 2), 1e-6);
  f['sd.hi'] = '200.000';
  assert.strictEqual(compute(fromForm(f)).status, 'ok');
});

test('HART + raiz no SDCD', () => {
  const f = { 'fp.var': 'vazao', 'fp.unit': 'm³/h', 'fp.lo': '0', 'fp.hi': '200', 'in.unit': 'kPa', 'in.lo': '0', 'in.hi': '50',
    'ds.unit': 'm³/h', 'ds.hi': '200', 'sd.src': 'hart', 'sd.hart': 'PV', 'sd.conf': true, 'sd.raiz': 'sim', 'sd.unit': 'm³/h', 'sd.lo': '0', 'sd.hi': '200' };
  assert.strictEqual(compute(fromForm(f)).status, 'ok');
});
