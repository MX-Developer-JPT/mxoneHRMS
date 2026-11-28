// The one authorised-signatory block used by every letter: company line, company stamp, signature (which may overlap the
// lower part of the stamp), then the signatory's name and designation underneath, where nothing covers them.
export const COMPANY_LINE = 'For Maxvolt Energy Industries Limited';
const FALLBACK = { name: '', designation: 'Authorised Signatory', signature: '' };

export const validSignature = (v) => /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(String(v || '')) && String(v).length <= 600000;

/**
 * Who signs: an explicitly chosen configured signatory, else a typed name (matched to a configured one when it is the
 * same person), else the default configured signatory, else an unnamed "Authorised Signatory" line.
 */
export function resolveSigner(list = [], { id, name, designation, role } = {}) {
  const byId = id && list.find((s) => s.id === id);
  if (byId) return byId;
  const typed = String(name || '').trim();
  if (typed) {
    const same = list.find((s) => s.name.trim().toLowerCase() === typed.toLowerCase());
    return same || { name: typed, designation: String(designation || '').trim() || role || FALLBACK.designation, signature: '' };
  }
  return list.find((s) => s.is_default) || (list.length === 1 ? list[0] : null) || { ...FALLBACK, designation: role || FALLBACK.designation };
}

/** pdfmake node. `stamp` is the stamp image data URL ('' when the asset is missing). */
export function signatoryNode(signer = FALLBACK, { stamp = '', company = true, margin = [0, 6, 0, 8] } = {}) {
  const sig = validSignature(signer.signature) ? signer.signature : '';
  const stack = [];
  if (company) stack.push({ text: COMPANY_LINE, bold: true, margin: [0, 0, 0, 2] });
  if (stamp) stack.push({ image: stamp, width: 82, opacity: 0.85, margin: [0, 0, 0, 0] });
  if (sig) stack.push({ image: sig, fit: [130, 38], margin: stamp ? [30, -40, 0, 3] : [0, 4, 0, 3] });
  else if (!stamp) stack.push({ text: ' ', margin: [0, 24, 0, 0] });
  if (signer.name) stack.push({ text: signer.name, bold: true, margin: [0, 1, 0, 0] });
  stack.push({ text: signer.designation || FALLBACK.designation });
  return { stack, margin, unbreakable: true, lineHeight: 1.2 };
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The same block as letter HTML (for the on-screen preview and printing). No nested <div>: the PDF converter relies on it. */
export function signatoryHtml(signer = FALLBACK, { stamp = '', company = true } = {}) {
  const sig = validSignature(signer.signature) ? signer.signature : '';
  return `<div class="mx-signatory" data-sig="${esc(signer.id || '')}" data-company="${company ? '1' : '0'}" style="margin:10px 0 14px;break-inside:avoid;page-break-inside:avoid;line-height:1.35;">`
    + (company ? `<p style="margin:0 0 4px;font-weight:bold;">${COMPANY_LINE}</p>` : '')
    + (stamp ? `<img src="${stamp}" alt="Company stamp" style="display:block;width:96px;opacity:0.85;" />` : '')
    + (sig ? `<img src="${sig}" alt="Signature" style="display:block;height:44px;max-width:170px;object-fit:contain;position:relative;margin:${stamp ? '-46px 0 4px 36px' : '4px 0'};" />` : stamp ? '' : '<p style="height:34px;margin:0;"></p>')
    + (signer.name ? `<p class="mx-signer-name" style="margin:2px 0 0;font-weight:bold;">${esc(signer.name)}</p>` : '')
    + `<p class="mx-signer-title" style="margin:0;">${esc(signer.designation || FALLBACK.designation)}</p>`
    + '</div>';
}

/** Reads a signatory block back out of (possibly hand-edited) letter HTML. */
export function parseSignatoryBlock(attrs, inner, list = []) {
  const text = (cls) => { const m = inner.match(new RegExp(`<p[^>]*class=["']${cls}["'][^>]*>([\\s\\S]*?)</p>`, 'i')); return m ? m[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim() : ''; };
  const id = (attrs.match(/data-sig=["']([^"']*)["']/i) || [])[1] || '';
  const configured = list.find((s) => s.id === id);
  return { signer: { name: text('mx-signer-name'), designation: text('mx-signer-title') || FALLBACK.designation, signature: configured?.signature || '' }, company: !/data-company=["']0["']/i.test(attrs) };
}
