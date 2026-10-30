// CTC typed by candidates. People write "6" or "6.5" meaning lakhs per annum; others type the full rupee amount.
// Anything under 1,000 is read as lakhs (no one earns ₹6 a year), anything above as rupees. Always stored as annual rupees.
export const LAKH = 100000;
export function ctcToRupees(input) {
  const n = parseFloat(String(input ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n < 1000 ? n * LAKH : n);
}
export const formatInr = (rupees) => (rupees ? `₹${Number(rupees).toLocaleString('en-IN')}` : '');
// What the candidate typed, spelled out back to them: "₹6,50,000 per annum (6.5 LPA)".
export function ctcPreview(input) {
  const r = ctcToRupees(input);
  if (!r) return '';
  return `${formatInr(r)} per annum (${Math.round((r / LAKH) * 100) / 100} LPA)`;
}
// Sanity limit so a stray extra zero is caught: more than ₹5 crore a year is almost certainly a typo.
export const ctcTooHigh = (input) => ctcToRupees(input) > 50000000;
