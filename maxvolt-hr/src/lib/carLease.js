// Car lease deduction that applies in a given month (YYYY-MM; default: this month). Mirrors backend carLeaseFor().
export function carLeaseFor(structure, ym) {
  const amt = Math.round(Number(structure?.car_lease_deduction) || 0);
  if (amt <= 0) return 0;
  const now = ym || new Date().toISOString().slice(0, 7);
  const from = String(structure.car_lease_from || '').slice(0, 7);
  const to = String(structure.car_lease_to || '').slice(0, 7);
  if (from && now < from) return 0;
  if (to && now > to) return 0;
  return amt;
}
