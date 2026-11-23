// Renders a stored asset-letter model (see backend/utils/assetLetterDoc.js) as the printable HTML letter. The letter is
// always drawn from the model saved on the letter record, never from the live asset, so a reprint years later is identical.
import { buildLetterheadHtml, fitOnOnePage } from './letterhead';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TD = 'padding:3px 7px;border:1px solid #ccc;vertical-align:top;';
const lines = (rows) => rows.map(([k, v]) => `<div><span style="color:#555">${esc(k)} – </span>${esc(v)}</div>`).join('');

export function assetLetterBody(m, signature = null) {
  const stampUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/company-stamp.png';
  const rows = m.assets.map((a) => `
    <tr>
      <td style="${TD}"><div style="font-weight:bold;margin-bottom:2px;">${esc(a.name)}</div>${lines(a.details)}</td>
      <td style="${TD}text-align:center;">${esc(a.quantity)}</td>
      <td style="${TD}"><div style="font-weight:bold;margin-bottom:2px;">${esc(a.category)}</div>${lines(a.item)}</td>
      <td style="${TD}">${esc(a.accessories) || '—'}</td>
      <td style="${TD}">${lines(a.remarks)}${a.remarks_note ? `<div>${esc(a.remarks_note)}</div>` : ''}${!a.remarks.length && !a.remarks_note ? '—' : ''}</td>
    </tr>`).join('');
  const guide = m.guidelines.map((g) => `
    <li style="font-weight:bold;margin-bottom:3px;break-inside:avoid;">${esc(g.title)}
      <ul style="font-weight:normal;margin:1px 0 4px;padding-left:14px;">${g.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
    </li>`).join('');
  return `
    <h1 style="font-size:20px;font-weight:bold;text-align:center;margin:0 0 6px;">${esc(m.title)}</h1>
    <div style="display:flex;justify-content:space-between;font-size:10.5px;margin:0 0 5px;"><span>Ref. No.: <strong>${esc(m.ref_no)}</strong></span><span>${esc(m.letter_date_label)}</span></div>
    <p style="font-size:10.5px;margin:0 0 1px;"><strong>Dear ${esc(m.salutation)} ${esc(m.employee.name)}</strong></p>
    <p style="font-size:10.5px;font-weight:bold;margin:0 0 5px;">Subject: ${esc(m.subject)}</p>
    ${m.intro.map((t) => `<p style="font-size:10.5px;margin:0 0 5px;line-height:1.42;">${esc(t)}</p>`).join('')}
    <p style="font-size:10.5px;margin:0 0 4px;line-height:1.42;">${esc(m.handover)}</p>
    <p style="font-size:10px;margin:0 0 5px;"><strong>Employee ID:</strong> ${esc(m.employee.code) || '—'} &nbsp;&nbsp; <strong>Date of Issue:</strong> ${esc(m.issue_date_label) || '—'}${m.employee.date_of_joining_label ? ` &nbsp;&nbsp; <strong>Date of Joining:</strong> ${esc(m.employee.date_of_joining_label)}` : ''}</p>
    <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:7px;">
      <thead><tr style="background:#f1f5f9;">${['Serial No.', 'Quantity', 'Item', 'Accessories', 'Remarks'].map((h) => `<th style="${TD}text-align:left;">${h}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:10.5px;margin:0 0 4px;line-height:1.42;">${esc(m.guide_intro)}</p>
    <ol style="font-size:9.5px;margin:0 0 6px;padding-left:16px;line-height:1.35;column-count:2;column-gap:10mm;">${guide}</ol>
    <p style="font-size:10.5px;margin:0 0 5px;line-height:1.42;">${esc(m.closing)}</p>
    <p style="font-size:9.5px;font-style:italic;margin:0 0 8px;line-height:1.4;">${esc(m.acknowledgement)}</p>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;font-size:10.5px;break-inside:avoid;">
      <div>
        <p style="margin:0 0 2px;">Sincerely, &nbsp;&nbsp; Issue by</p>
        <img src="${stampUrl}" style="width:78px;opacity:0.85;display:block;margin:-6px 0 -22px 4px;" onerror="this.style.display='none'" />
        <p style="font-weight:600;margin:0;">${esc(m.signoff.issued_by)}</p>
      </div>
      <div style="min-width:200px;">
        <p style="margin:0 0 ${signature ? '2' : '20'}px;">Received by</p>
        ${signature ? `<img src="${esc(signature.data_url)}" style="height:46px;max-width:170px;object-fit:contain;display:block;margin:0 0 2px;" />` : ''}
        <p style="font-weight:600;margin:0;">${esc(m.signoff.received_by)}</p>
        <p style="font-size:9.5px;margin:3px 0 0;">${signature ? `Digitally signed on ${esc(String(signature.at).slice(0, 10))}` : 'Signature &amp; Date: ____________________'}</p>
      </div>
    </div>`;
}

/** The complete printable page. `withLetterhead` false leaves the artwork out and everything else identical. */
export function assetLetterDocument(model, withLetterhead, { toolbar = false, signature = null } = {}) {
  return buildLetterheadHtml(`${model.title} - ${model.employee.name} - ${model.ref_no}`, fitOnOnePage(assetLetterBody(model, signature)), '', { letterhead: withLetterhead, toolbar });
}
