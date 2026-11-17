// Pure content of the asset handover letter: wording, per-asset specification rows, and the A4 PDF layout.
// No database access here — routes/assetLetters.js stores the model this builds as an immutable snapshot on each letter.
import { CATEGORIES, resolveSchema, valueOf, isBlank, specFingerprint, categoryOf } from './assetSpecs.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : String(ymd || ''); };
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

// ── letter wording (taken from the company's handover letter; extra points only where the asset needs them) ──
const INTRO_1 = 'I hope this letter finds you in good health and high spirits. We are pleased to inform you that, as part of your role with “MAXVOLT ENERGY INDUSTRIES LIMITED”, you are entrusted with company assets, mentioned in this letter, to support you in your responsibilities. It is crucial for both your professional success and the company\'s operational efficiency that these assets are managed responsibly.';
const GUIDE_INTRO = 'The following rules and guidelines are provided to ensure a smooth asset handover process and to outline the responsibilities associated with the care and use of these assets:';
const CLOSING = 'We trust that you will handle these assets with the utmost care and responsibility. Your cooperation in adhering to these guidelines is essential to maintaining a smooth and effective workflow.';
const EXTRA_USE = {
  mobile: 'Do not tamper with the IMEI, remove the SIM lock or install unauthorised applications; keep the device password / screen lock enabled.',
  laptop: 'Do not install unlicensed software, disable antivirus or attempt hardware repairs; get any repair or upgrade done only through the HR / IT Department.',
  desktop: 'Do not install unlicensed software, disable antivirus or attempt hardware repairs; get any repair or upgrade done only through the HR / IT Department.',
  tablet: 'Do not install unauthorised applications; keep the device password / screen lock enabled.',
  vehicle: 'Drive only with a valid licence, follow all traffic rules, and report any accident, challan or breakdown to the Administration Department immediately; fines for violations are the driver\'s responsibility.',
  sim: 'Use the connection for official purposes only; report a lost SIM immediately so that it can be blocked.',
};
function guidelines(categories) {
  const use = ['Use the provided assets exclusively for work-related purposes.', 'Exercise caution to prevent damage or loss.'];
  for (const c of categories) if (EXTRA_USE[c] && !use.includes(EXTRA_USE[c])) use.push(EXTRA_USE[c]);
  use.push('Maintenance and repairs are arranged only through the HR - Department; do not get the assets repaired or modified elsewhere.');
  use.push('Report any loss, damage, or malfunction immediately to the HR - Department');
  return [
    { title: 'Condition and Inspection:', points: ['Upon receiving the assets, please inspect them carefully to ensure they are in proper working condition.', 'Report any discrepancies or issues promptly to the HR Department.'] },
    { title: 'Documentation:', points: ['Sign the Asset Handover Form attached to this letter, acknowledging receipt of the specified assets.', 'Keep a copy of the signed form for your records.'] },
    { title: 'Use and Care:', points: use },
    { title: 'Security and Confidentiality:', points: ['Safeguard assets and information stored on them to maintain the confidentiality and security of company data.'] },
    { title: 'Return of Assets:', points: ['Return the assets promptly upon termination of your employment or upon request by the company.'] },
    { title: 'Penalties for Non-Compliance:', points: ['Failure to adhere to the guidelines may result in disciplinary action, including but not limited to verbal/written warnings, suspension, or termination.', 'Any intentional damage or misuse may result in financial penalties to cover repair or replacement costs.'] },
    { title: 'Contact Person:', points: ['For any questions or concerns regarding the assets, please contact HR – Department/HOD.'] },
  ];
}

// ── the letter content ──
const cleanLabel = (l) => String(l).replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
function assetBlock(asset, type) {
  const cat = categoryOf(type);
  const schema = resolveSchema(type).fields;
  const name = String(asset.asset_name || '').trim();
  const lname = name.toLowerCase();
  const details = []; const item = []; const remarks = [];
  for (const f of schema) {
    if (f.show === false || ['accessories', 'condition', 'letter_remarks'].includes(f.key)) continue;
    let v = valueOf(asset, f);
    if (isBlank(v)) continue;
    if (['brand', 'model_name', 'make', 'vehicle_model'].includes(f.key) && lname.includes(v.toLowerCase())) continue;   // already in the item name
    if (f.type === 'date') v = fmtDate(v);
    const row = [cleanLabel(f.label), v];
    if (f.col === 'item') item.push(row); else details.push(row);
  }
  if (!isBlank(asset.specification)) details.push(['Specification', String(asset.specification).trim()]);   // free-text entry made before category fields existed
  const cond = valueOf(asset, schema.find(f => f.key === 'condition') || { key: 'condition', core: true });
  if (cond) remarks.push(['Condition', titleCase(cond)]);
  const rem = String(asset.specs?.letter_remarks || '').trim();
  const accessories = valueOf(asset, { key: 'accessories', core: true });
  return {
    entity_id: asset.id, asset_id: asset.asset_id || '', name: name || CATEGORIES[cat].label, category: type?.name || CATEGORIES[cat].label, category_key: cat,
    quantity: 1, details, item: [['Asset ID', asset.asset_id || '—'], ...item], accessories: isBlank(accessories) ? '' : accessories,
    remarks, remarks_note: rem, fingerprint: specFingerprint(asset, type),
  };
}

export function buildModel({ emp, userName, assets, types, letterDate, issueDate, ref, issuedBy }) {
  const salutation = /^f/i.test(String(emp?.gender || '')) ? 'Ms.' : 'Mr.';
  const name = emp?.display_name || userName || '—';
  const blocks = assets.map(a => assetBlock(a, types[a.asset_type_id]));
  const plural = blocks.length > 1;
  const cats = [...new Set(blocks.map(b => b.category_key))];
  return {
    version: 1, title: 'Assets Handover', ref_no: ref, letter_date: letterDate, letter_date_label: fmtDate(letterDate), issue_date: issueDate, issue_date_label: fmtDate(issueDate),
    salutation, subject: 'Assets Handover Letter',
    employee: { name, code: emp?.employee_code || '', designation: emp?.designation || '', department: emp?.department || '', date_of_joining: emp?.date_of_joining || '', date_of_joining_label: fmtDate(emp?.date_of_joining || '') },
    intro: [INTRO_1],
    handover: `Following asset${plural ? 's have' : ' has'} been handed-over to ${salutation} ${name}${emp?.designation ? ` “${emp.designation}”` : ''}${emp?.department ? ` -${emp.department}-` : ''} for official use purpose only. The sole ownership will remain with “Maxvolt Energy Industries Limited”`,
    assets: blocks,
    guide_intro: GUIDE_INTRO, guidelines: guidelines(cats), closing: CLOSING,
    acknowledgement: `I, ${salutation} ${name}${emp?.employee_code ? ` (Employee ID: ${emp.employee_code})` : ''}, acknowledge that I have received the above asset${plural ? 's' : ''} on ${fmtDate(issueDate)} in the condition stated, and I agree to follow the guidelines given in this letter. I understand that the asset${plural ? 's remain' : ' remains'} the property of the Company and will be returned on request or on leaving the Company.`,
    signoff: { issued_by: 'HR Manager', issued_by_name: issuedBy || '', received_by: `${salutation} ${name}` },
  };
}

// ── PDF (pdfmake) rendered from the stored letter content ──
// `chrome` = { renderPdf, letterheadBg, stamp, margins } supplied by the caller (functions.js owns the artwork and the PDF engine).
export async function buildPdf(model, withLetterhead, chrome) {
  const { renderPdf, margins: LETTERHEAD_MARGINS } = chrome;
  const stamp = chrome.stamp;
  const bg = withLetterhead ? chrome.letterheadBg : null;
  const fs = 8;
  const lines = (arr) => arr.map(([k, v]) => ({ text: [{ text: `${k} – `, color: '#555555' }, { text: String(v) }], margin: [0, 0, 0, 1] }));
  const hdr = (t) => ({ text: t, bold: true, fillColor: '#f1f5f9', fontSize: fs, margin: [0, 1, 0, 1] });
  const body = [[hdr('Serial No.'), hdr('Quantity'), hdr('Item'), hdr('Accessories'), hdr('Remarks')]];
  for (const a of model.assets) {
    body.push([
      { stack: [{ text: a.name, bold: true, margin: [0, 0, 0, 2] }, ...lines(a.details)] },
      { text: String(a.quantity), alignment: 'center' },
      { stack: [{ text: a.category, bold: true, margin: [0, 0, 0, 2] }, ...lines(a.item)] },
      { text: a.accessories || '—' },
      { stack: [...lines(a.remarks), ...(a.remarks_note ? [{ text: a.remarks_note }] : []), ...(!a.remarks.length && !a.remarks_note ? [{ text: '—' }] : [])] },
    ]);
  }
  const half = Math.ceil(model.guidelines.length / 2);
  const gl = (g, i) => ({ stack: [{ text: `${i + 1}. ${g.title}`, bold: true, margin: [0, 2, 0, 0.5] }, { ul: g.points, margin: [8, 0, 0, 1] }] });
  const stampNode = stamp ? [{ image: 'stamp', width: 50, opacity: 0.85, margin: [0, -6, 0, -8] }] : [];
  const content = [
    { text: model.title, fontSize: 15, bold: true, alignment: 'center', margin: [0, 0, 0, 3] },
    { columns: [{ text: `Ref. No.: ${model.ref_no}`, width: '*' }, { text: model.letter_date_label, alignment: 'right', width: 'auto' }], margin: [0, 0, 0, 4] },
    { text: `Dear ${model.salutation} ${model.employee.name}`, bold: true },
    { text: `Subject: ${model.subject}`, bold: true, margin: [0, 0, 0, 4] },
    ...model.intro.map(t => ({ text: t, margin: [0, 0, 0, 4] })),
    { text: model.handover, margin: [0, 0, 0, 3] },
    { text: [{ text: 'Employee ID: ', bold: true }, model.employee.code || '—', { text: '    Date of Issue: ', bold: true }, model.issue_date_label || '—', ...(model.employee.date_of_joining_label ? [{ text: '    Date of Joining: ', bold: true }, model.employee.date_of_joining_label] : [])], fontSize: fs, margin: [0, 0, 0, 4] },
    { table: { headerRows: 1, widths: [165, 36, 100, 75, '*'], body }, layout: { hLineColor: () => '#cccccc', vLineColor: () => '#cccccc', hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 2, paddingBottom: () => 2 }, fontSize: fs, margin: [0, 0, 0, 4] },
    { text: model.guide_intro, margin: [0, 0, 0, 2] },
    { columns: [{ width: '*', stack: model.guidelines.slice(0, half).map((g, i) => gl(g, i)) }, { width: '*', columnGap: 14, stack: model.guidelines.slice(half).map((g, i) => gl(g, i + half)) }], columnGap: 16, fontSize: 7.2, margin: [0, 0, 0, 2] },
    { text: model.closing, margin: [0, 1, 0, 2] },
    { text: model.acknowledgement, italics: true, fontSize: fs - 0.6, margin: [0, 0, 0, 3] },
    { columns: [
      { width: '*', stack: [{ text: 'Sincerely,    Issue by' }, ...stampNode, { text: model.signoff.issued_by, bold: true }] },
      { width: 190, stack: [{ text: 'Received by' }, { text: ' ', margin: [0, 8, 0, 0] }, { text: model.signoff.received_by, bold: true }, { text: 'Signature & Date: ____________________', fontSize: fs - 0.6, margin: [0, 3, 0, 0] }], alignment: 'left' },
    ], unbreakable: true },
  ];
  const docDef = {
    pageSize: 'A4', pageMargins: [42, LETTERHEAD_MARGINS.top, 42, LETTERHEAD_MARGINS.bottom],
    defaultStyle: { font: 'Roboto', fontSize: fs, lineHeight: 1.1 },
    content, images: stamp ? { stamp } : {},
    background: bg ? (cp, ps) => ({ image: bg, absolutePosition: { x: 0, y: 0 }, width: ps.width, height: ps.height }) : undefined,
    info: { title: `${model.title} - ${model.employee.name} - ${model.ref_no}`, author: 'Maxvolt Energy Industries Limited' },
  };
  return renderPdf(docDef);
}

