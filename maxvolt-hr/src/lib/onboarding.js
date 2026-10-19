import { base44 } from '@/api/base44Client';

/** Calls an onboarding (ob_*) back-end function; throws with the server's message when it refuses. */
export async function ob(name, params = {}) {
  const res = await base44.functions.invoke(name, params);
  const d = res?.data || res;
  if (d && d.success === false) { const e = new Error(d.error || 'Request failed'); e.errors = d.errors; throw e; }
  return d;
}

export const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full time' },
  { value: 'part_time', label: 'Part time' },
  { value: 'contract', label: 'Contractual' },
  { value: 'intern', label: 'Intern' },
  { value: 'trainee', label: 'Trainee' },
];
export const employmentLabel = (v) => EMPLOYMENT_TYPES.find(t => t.value === v)?.label || v || '—';

export const DESIGNATION_TIERS = [
  { value: 'executive', label: 'Executive' },
  { value: 'senior_executive', label: 'Senior Executive' },
  { value: 'territory_manager', label: 'Territory Manager / Assistant Manager' },
  { value: 'manager', label: 'Senior Manager / Manager / Regional Manager' },
  { value: 'general_manager', label: 'General Manager / Deputy GM / Assistant GM' },
  { value: 'director', label: 'Director / Senior VP / Ex Director / Vice President' },
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const RELATIONS = ['Father', 'Mother', 'Spouse', 'Brother', 'Sister', 'Son', 'Daughter', 'Friend', 'Other'];

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
