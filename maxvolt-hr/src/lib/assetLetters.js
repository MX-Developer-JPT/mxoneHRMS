import { base44 } from '@/api/base44Client';
import { openPdfBlob } from '@/utils/letterhead';

/** Calls an asset-letter (al_*) back-end function; throws with the server's message when it refuses. */
export async function al(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) throw new Error(d.error || 'Request failed');
  return d;
}

export async function downloadLetterPdf(letter, withLetterhead) {
  const d = await al('al_pdf', { id: letter.id, letterhead: withLetterhead });
  openPdfBlob(d.base64, d.filename, { download: true });
}

export const LETTER_STATUS = {
  issued: { label: 'Issued', cls: 'bg-blue-100 text-blue-800' },
  acknowledged: { label: 'Acknowledged', cls: 'bg-green-100 text-green-800' },
  superseded: { label: 'Superseded', cls: 'bg-gray-200 text-gray-700' },
};
/** What to show for a letter row: acknowledged beats issued; superseded always wins. */
export const letterState = (l) => (l.status === 'superseded' ? 'superseded' : l.acknowledged_at ? 'acknowledged' : 'issued');
