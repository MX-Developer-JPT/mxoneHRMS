// Asset specs, validation and letter content/PDF. Run: node backend/tests/assetLetters.test.mjs
import assert from 'node:assert/strict';
import { categoryOf, resolveSchema, assetProblem, cleanSpecs, cleanCustomFields, specFingerprint, normId } from '../utils/assetSpecs.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ', name); };
const phoneType = { id: 't1', name: 'Mobile Phone', icon: 'smartphone' };
const lapType = { id: 't2', name: 'Laptop', icon: 'laptop' };

await t('categories are detected from the type name / icon', () => {
  assert.equal(categoryOf(phoneType), 'mobile'); assert.equal(categoryOf(lapType), 'laptop');
  assert.equal(categoryOf({ name: 'Tab', icon: 'tablet' }), 'tablet'); assert.equal(categoryOf({ name: 'Dell 24 Monitor', icon: 'other' }), 'monitor');
  assert.equal(categoryOf({ name: 'Visitor Sofa', icon: 'other' }), 'furniture'); assert.equal(categoryOf({ name: 'Gadget', icon: 'other' }), 'other');
  assert.equal(categoryOf({ name: 'Anything', spec_category: 'vehicle' }), 'vehicle');
});
await t('each category has its own fields (mobile has IMEI, laptop has processor, monitor has screen size)', () => {
  const keys = (x) => resolveSchema(x).fields.map(f => f.key);
  assert.ok(keys(phoneType).includes('imei_1') && keys(phoneType).includes('imei_2') && !keys(phoneType).includes('processor'));
  assert.ok(keys(lapType).includes('processor') && !keys(lapType).includes('imei_1'));
  assert.ok(keys({ name: 'Monitor' }).includes('screen_size'));
});
await t('custom fields are added to a type without code changes and sanitised', () => {
  const type = { ...phoneType, custom_fields: [{ label: 'Insurance Policy No', unique: true }, { label: '' }, { label: 'Grade', type: 'select', options: 'A, B ,C' }] };
  const f = resolveSchema(type).fields.filter(x => x.custom);
  assert.equal(f.length, 2); assert.equal(f[0].key, 'x_insurance_policy_no'); assert.equal(f[0].unique, 'x_insurance_policy_no'); assert.deepEqual(f[1].options, ['A', 'B', 'C']);
  assert.deepEqual(cleanCustomFields('nonsense'), []);
});
const a1 = { id: 'a1', asset_id: 'MOB-001', asset_name: 'Motorola edge 60', asset_type_id: 't1', serial_number: 'ZA223L7835', specs: { imei_1: '354845699377594/12', imei_2: '354845699377602' } };
await t('IMEI must be 15 digits; the "/12" suffix used on the company letters is accepted', () => {
  assert.equal(assetProblem({ ...a1, id: 'new', serial_number: 'OTHER', specs: { imei_1: '111111111111111' } }, null, phoneType, []), null);
  assert.equal(assetProblem({ ...a1, id: 'new' }, null, phoneType, []), null);
  assert.match(assetProblem({ id: 'n', specs: { imei_1: '12345' } }, null, phoneType, []), /IMEI Number 1 must be/);
  assert.match(assetProblem({ id: 'n', specs: { imei_1: 'abc' } }, null, phoneType, []), /IMEI/);
});
await t('a duplicate IMEI / serial is refused and names the asset that already has it', () => {
  const dupe = { id: 'new', serial_number: 'za223l7835', specs: { imei_1: '999999999999999' } };
  assert.match(assetProblem(dupe, null, phoneType, [a1]), /Serial Number "za223l7835" is already registered on asset MOB-001/);
  const dupI = { id: 'new', specs: { imei_1: '354845699377602' } };       // equals the other phone's IMEI 2
  assert.match(assetProblem(dupI, null, phoneType, [a1]), /IMEI Number 1 "354845699377602" is already registered on asset MOB-001/);
  assert.match(assetProblem({ id: 'x', specs: { imei_1: '354845699377594', imei_2: '354845699377594/12' } }, null, phoneType, []), /cannot be the same/);
});
await t('editing an old asset that already shares a serial is not blocked unless the value changes', () => {
  const old = { id: 'o1', asset_id: 'L-1', serial_number: 'DUP1' }; const other = { id: 'o2', asset_id: 'L-2', serial_number: 'DUP1' };
  assert.equal(assetProblem({ ...old, notes: 'edited' }, old, lapType, [other]), null);
  assert.match(assetProblem({ ...old, serial_number: 'DUP1', specs: {} }, { ...old, serial_number: 'X' }, lapType, [other]), /already registered/);
  assert.equal(assetProblem({ id: 'z', serial_number: 'N/A' }, null, lapType, [{ id: 'q', serial_number: 'N/A' }]), null, 'placeholder values never collide');
});
await t('only the schema keys survive in specs', () => {
  assert.deepEqual(cleanSpecs({ imei_1: ' 1 ', hack: 'x', processor: 'i5' }, phoneType), { imei_1: '1' });
});
await t('the fingerprint changes when a printed field changes and not otherwise', () => {
  const b = { ...a1, notes: 'unrelated' }; assert.equal(specFingerprint(a1, phoneType), specFingerprint(b, phoneType));
  assert.notEqual(specFingerprint(a1, phoneType), specFingerprint({ ...a1, specs: { ...a1.specs, ram: '12 GB' } }, phoneType));
  assert.equal(normId('imei', '354845699377594/12'), '354845699377594'); assert.equal(normId('mobile', '+91 70422 74965'), '7042274965');
});

// letter content + PDF
import { buildModel, buildPdf } from '../utils/assetLetterDoc.js';
import { renderPdf } from '../utils/pdfRender.js';
import { readFileSync } from 'fs';
const chrome = { renderPdf, margins: { top: 140, bottom: 105 },
  letterheadBg: 'data:image/jpeg;base64,' + readFileSync(new URL('../assets/letterhead.jpg', import.meta.url)).toString('base64'),
  stamp: 'data:image/png;base64,' + readFileSync(new URL('../assets/company-stamp.png', import.meta.url)).toString('base64') };
const types = { t1: phoneType, t2: lapType };
const emp = { display_name: 'Vikram Kumar', employee_code: 'MVE0123', designation: 'Executive', department: 'Admin', gender: 'male', date_of_joining: '2025-04-01' };
const phone = { ...a1, accessories: 'Charger', condition: 'new', specs: { ...a1.specs, brand: 'Motorola', model_name: 'edge 60 Fusion', ram: '12 GB', storage: '256 GB', colour: 'Blue', os: 'Android 15' }, model_number: 'XT2503-2', asset_name: 'Motorola edge 60 Fusion 12GB/256GB', purchase_date: '2026-01-05' };
const laptop = { id: 'a2', asset_id: 'LAP-009', asset_name: 'Dell Latitude 5430', asset_type_id: 't2', serial_number: 'G9R9KN3', model_number: 'Latitude 5430', accessories: 'Charger, Bag', condition: 'good', specs: { brand: 'Dell', processor: 'Intel Core i5-1235U', ram: '16 GB', storage: '512 GB', storage_type: 'SSD', os: 'Windows 11' } };
const mk = (assets) => buildModel({ emp, userName: '', assets, types, letterDate: '2026-11-17', issueDate: '2026-10-28', ref: 'MVE/HR/AL/2026-27/0001', issuedBy: 'HR' });
await t('the letter shows only fields that apply and are filled in', () => {
  const m = mk([phone, laptop]);
  const [p, l] = m.assets;
  const labels = (b) => b.details.map(r => r[0]);
  assert.ok(labels(p).includes('IMEI Number 1') && labels(p).includes('RAM') && labels(p).includes('Colour') && !labels(p).includes('Processor'));
  assert.ok(!labels(p).includes('Manufacturer / Brand') && !labels(p).includes('Model Name'), 'brand/model already in the item name');
  assert.ok(labels(l).includes('Processor') && labels(l).includes('Storage Type') && !labels(l).some(x => /IMEI/.test(x)));
  assert.ok(!JSON.stringify(m).includes('Purchase'), 'purchase date is not printed');
  assert.equal(m.letter_date_label, '17-Nov-2026'); assert.equal(m.issue_date_label, '28-Oct-2026'); assert.match(m.handover, /have been handed-over to Mr. Vikram Kumar “Executive” -Admin-/);
  assert.deepEqual(p.remarks, [['Condition', 'New']]);
  assert.ok(m.guidelines.find(g => g.title.startsWith('Use')).points.some(x => /IMEI/.test(x)), 'mobile-specific care point');
});
await t('with and without letterhead produce valid A4 PDFs that differ only by the artwork', async () => {
  const m = mk([phone, laptop]);
  const a = await buildPdf(m, true, chrome); const b = await buildPdf(m, false, chrome);
  assert.equal(a.subarray(0, 5).toString(), '%PDF-'); assert.equal(b.subarray(0, 5).toString(), '%PDF-');
  assert.ok(a.length > b.length);
  const { PDFDocument } = await import('pdf-lib'); const one = await buildPdf(mk([phone]), true, chrome); assert.equal((await PDFDocument.load(one)).getPageCount(), 1, 'a single asset fits one A4 page');
  if (process.env.OUT_DIR) { const fs = await import('fs'); fs.writeFileSync(process.env.OUT_DIR + '/with.pdf', a); fs.writeFileSync(process.env.OUT_DIR + '/without.pdf', b); }
});
console.log(`\n${n} tests passed`); process.exit(0);
