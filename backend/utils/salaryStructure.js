// A salary structure from an annual CTC, by the Salary Structure page's rules (pure): Basic 50% of CTC, HRA 40% of Basic,
// Conveyance = balance of the gross, PF 12% / 13% on Basic up to the wage ceiling, ESI 0.75% / 3.25% when Basic is within
// the ESI ceiling, Bonus 8.33% of Basic up to ₹10L else VPP by slab. With manual override HR types any component; a blank
// one keeps its automatic value.
export function bonusFor(annualCTC) {
  const basicAnnual = annualCTC * 0.5;
  if (annualCTC <= 1000000) return { amount: Math.round(basicAnnual * 0.0833 / 12), type: 'Bonus (8.33% of Basic)' };
  const pct = annualCTC <= 1500000 ? 0.05 : annualCTC <= 2000000 ? 0.08 : annualCTC <= 2500000 ? 0.12 : 0.15;
  const slab = annualCTC <= 1500000 ? '10-15L' : annualCTC <= 2000000 ? '15-20L' : annualCTC <= 2500000 ? '20-25L' : '25L+';
  return { amount: Math.round(annualCTC * pct / 12), type: `VPP (${Math.round(pct * 100)}% of CTC – ${slab} slab)` };
}

const blank = (v) => v === undefined || v === null || v === '';
const MONTH = /^\d{4}-\d{2}$/;

export function buildSalaryStructure(input = {}, { pfCeiling = 25000, esiCeiling = 21000, pfApplicable = true } = {}) {
  const errors = [];
  const ctc = Number(input.ctc);
  if (!Number.isFinite(ctc) || ctc <= 0) return { errors: ['Annual CTC must be more than zero'], values: null };
  const medical = Math.max(0, Number(input.medical_contribution) || 0);
  const o = input.manual ? input.overrides || {} : {};
  const pick = (key, auto, label) => {
    if (blank(o[key])) return auto;
    const n = Number(o[key]);
    if (!Number.isFinite(n) || n < 0) { errors.push(`${label} cannot be negative`); return auto; }
    return n;
  };

  const basic = pick('basic_salary', ctc * 0.5 / 12, 'Basic salary');
  const hra = pick('hra', basic * 0.4, 'HRA');
  const bonus = bonusFor(ctc);
  const bonusM = pick('performance_bonus', bonus.amount, 'Bonus / VPP');
  const pfBase = Math.min(basic, pfCeiling);
  const esiOn = basic <= esiCeiling;
  const pf = pfApplicable ? pick('pf_contribution', Math.round(pfBase * 0.12), 'PF') : 0;
  const employerPF = pfApplicable ? pick('employer_pf_contribution', Math.round(pfBase * 0.13), 'Employer PF') : 0;
  const esi = pick('esi_contribution', esiOn ? Math.round(basic * 0.0075) : 0, 'ESI');
  const employerESI = pick('employer_esi_contribution', esiOn ? Math.round(basic * 0.0325) : 0, 'Employer ESI');
  const contributions = employerPF + employerESI + bonusM + medical;
  const balance = ctc / 12 - contributions - basic - hra;
  const conveyance = pick('conveyance', Math.max(balance, 0), 'Conveyance');
  if (blank(o.conveyance) && balance < -0.5) errors.push(`Basic, HRA and employer contributions exceed the monthly CTC by ₹${Math.round(-balance).toLocaleString('en-IN')}`);

  const lease = input.car_lease || {};
  const carLease = Math.max(0, Number(lease.amount) || 0);
  const from = MONTH.test(lease.from || '') ? lease.from : '', to = MONTH.test(lease.to || '') ? lease.to : '';
  if (from && to && to < from) errors.push('The car lease end month is before its start month');
  const gross = basic + hra + conveyance;
  const deductions = pf + esi + carLease;
  if (gross - deductions < 0) errors.push('Deductions exceed the gross salary');

  return {
    errors,
    values: {
      ctc, is_manual_override: !!input.manual,
      basic_salary: basic, hra, conveyance, lta: 0, special_allowance: 0, performance_bonus: bonusM,
      pf_contribution: pf, employer_pf_contribution: employerPF, esi_contribution: esi, employer_esi_contribution: employerESI,
      medical_contribution: medical,
      car_lease_deduction: carLease, car_lease_from: carLease ? from : '', car_lease_to: carLease ? to : '', car_lease_note: carLease ? String(lease.note || '').trim().slice(0, 80) : '',
    },
    summary: {
      bonus_type: bonus.type, esi_applies: esiOn, gross_monthly: gross, deductions_monthly: deductions, net_monthly: gross - deductions,
      employer_monthly: contributions, ctc_from_components: Math.round((gross + contributions) * 12),
    },
  };
}
