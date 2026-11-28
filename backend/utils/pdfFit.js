// Shrinking a pdfmake letter until it fits one page (pure).

/** Number of pages in a PDF produced by pdfkit. */
export const pageCount = (buffer) => (Buffer.from(buffer).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;

const num = (v, s) => Math.round(v * s * 100) / 100;
// vertical spacing shrinks with the text; the left and right margins stay, so the column does not move
const margin = (m, s) => (Array.isArray(m) ? (m.length === 4 ? [m[0], num(m[1], s), m[2], num(m[3], s)] : m.length === 2 ? [m[0], num(m[1], s)] : m) : m);

/** A copy-free, in-place scaling of font sizes, vertical spacing and pictures of freshly built content. */
export function scaleContent(node, s) {
  if (Array.isArray(node)) { for (const n of node) scaleContent(n, s); return node; }
  if (!node || typeof node !== 'object') return node;
  if (typeof node.fontSize === 'number') node.fontSize = num(node.fontSize, s);
  if (node.margin !== undefined) node.margin = margin(node.margin, s);
  if (node.image) {
    if (typeof node.width === 'number') node.width = num(node.width, s);
    if (Array.isArray(node.fit)) node.fit = node.fit.map((v) => num(v, s));
  }
  for (const k of ['stack', 'columns', 'ul', 'ol', 'text']) if (node[k] && typeof node[k] === 'object') scaleContent(node[k], s);
  if (node.table?.body) scaleContent(node.table.body, s);
  return node;
}

export const FIT_SCALES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55];

/** Renders `build(scale)` at the largest scale that gives one page; the smallest scale is the last resort. */
export async function renderOnOnePage(build, render) {
  let out;
  for (const s of FIT_SCALES) {
    out = await render(build(s));
    if (pageCount(out) <= 1) break;
  }
  return out;
}
