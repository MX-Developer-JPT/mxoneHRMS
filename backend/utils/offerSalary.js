// Salary structure of an offer from an annual CTC (pure). Defaults match the organisation's Salary Structure rules:
// Basic 50% of CTC, HRA 40% of Basic, Conveyance = balance, PF on Basic up to the wage ceiling, ESI when Basic is within
// the ESI ceiling, Bonus 8.33% of Basic up to ₹10L else VPP by slab. HR may fix components; whatever is left goes into one
// balancing component, so that Gross × 12 + Contributions × 12 is always exactly the CTC.
export const ESI_CEILING = 21000;
export const GRATUITY_RATE = 0.0481;   // 15/26 of a month's Basic per year

const given = (v) => v !== undefined && v !== null && v !== '';
const money = (v) => Math.round(Number(v) || 0);
const lines = (list) => (Array.isArray(list) ? list : []).map((x) => ({ name: String(x?.name || '').trim().slice(0, 60), monthly: money(x?.monthly) })).filter((x) => x.name && x.monthly);

export function computeOfferSalary(annualCTC, medicalContribution = 0, overrides = {}, { pfCeiling = 25000 } = {}) {
  const o = overrides || {};
  const ctc = money(annualCTC);
  const monthlyCTC = ctc / 12;
  const problems = [];
  const basicM = Number(o.basic) > 0 ? money(o.basic) : Math.round(monthlyCTC * 0.5);
  const hraM = given(o.hra) && Number(o.hra) >= 0 && o.hra !== 0 ? money(o.hra) : Math.round(basicM * 0.4);
  const allowances = lines(o.allowances), otherDeductions = lines(o.deductions);
  const pfOn = o.pf !== false;
  const pfBase = Math.min(basicM, pfCeiling);
  const pfEmpM = pfOn ? Math.round(pfBase * 0.12) : 0;
  const pfEmployerM = pfOn ? Math.round(pfBase * 0.13) : 0;
  const isESI = basicM <= ESI_CEILING;
  const esiEmpM = isESI ? Math.round(basicM * 0.0075) : 0;
  const esiEmployerM = isESI ? Math.round(basicM * 0.0325) : 0;
  const medicalM = money(medicalContribution);
  let bonusM, bonusType;
  if (ctc <= 1000000) { bonusM = Math.round(basicM * 0.0833); bonusType = 'Bonus (8.33% of Basic)'; }
  else { const vp = ctc <= 1500000 ? 0.05 : ctc <= 2000000 ? 0.08 : ctc <= 2500000 ? 0.12 : 0.15; bonusM = Math.round(ctc * vp / 12); bonusType = `VPP (${Math.round(vp * 100)}% of CTC)`; }
  if (given(o.bonus)) { bonusM = money(o.bonus); bonusType = 'Bonus / VPP'; }
  const gratuityM = o.gratuity ? Math.round(basicM * GRATUITY_RATE) : 0;
  const contribM = pfEmployerM + esiEmployerM + bonusM + medicalM + gratuityM;

  const convFixed = Number(o.conveyance) > 0 || o.conveyance === 0 || o.conveyance === '0';
  const allowM = allowances.reduce((s, a) => s + a.monthly, 0);
  const fixedM = basicM + hraM + (convFixed ? money(o.conveyance) : 0) + allowM;
  // the balance is worked out on the year, so the annual figures reconcile to the rupee even when CTC is not divisible by 12
  let balanceA = ctc - (contribM + fixedM) * 12;
  if (balanceA < 0 && balanceA > -12) balanceA = 0;
  const balanceM = Math.round(balanceA / 12);
  const convM = convFixed ? money(o.conveyance) : Math.max(balanceM, 0);
  const specialM = convFixed ? Math.max(balanceM, 0) : 0;
  const grossM = basicM + hraM + convM + specialM + allowM;
  const grossA = fixedM * 12 + Math.max(balanceA, 0);
  const otherDedM = otherDeductions.reduce((s, a) => s + a.monthly, 0);
  const totalDedM = pfEmpM + esiEmpM + otherDedM;
  const netM = grossM - totalDedM;

  if (!(ctc > 0)) problems.push('Enter the annual CTC.');
  if (balanceA < 0) problems.push(`The fixed components and contributions exceed the CTC by ₹${Math.abs(balanceA).toLocaleString('en-IN')} a year.`);
  if ([basicM, hraM, convM, bonusM, medicalM, ...allowances.map((a) => a.monthly), ...otherDeductions.map((a) => a.monthly)].some((v) => v < 0)) problems.push('Amounts cannot be negative.');
  if (netM < 0) problems.push('Deductions exceed the monthly gross salary.');

  const row = (label, monthly, annual = monthly * 12) => [label, annual, monthly];
  const earnings = [
    row(Number(o.basic) > 0 ? 'Basic Salary' : 'Basic (50% of CTC)', basicM),
    row(given(o.hra) && o.hra !== 0 ? 'House Rent Allowance' : 'HRA (40% of Basic)', hraM),
    row(convFixed ? 'Conveyance Allowance' : 'Conveyance Allowance (Balance)', convM, convFixed ? convM * 12 : Math.max(balanceA, 0)),
    ...(convFixed && (specialM || balanceA > 0) ? [row('Special Allowance (Balance)', specialM, Math.max(balanceA, 0))] : []),
    ...allowances.map((a) => row(a.name, a.monthly)),
  ];
  const deductions = [
    ...(pfOn ? [row(`PF Employee Contribution (12% on Basic, max ₹${pfCeiling.toLocaleString('en-IN')})`, pfEmpM)] : []),
    ...(isESI ? [row('ESI Employee Contribution (0.75% on Basic)', esiEmpM)] : []),
    ...otherDeductions.map((a) => row(a.name, a.monthly)),
  ];
  const contributions = [
    ...(pfOn ? [row('PF Employer Contribution', pfEmployerM)] : []),
    ...(isESI ? [row('ESI Employer Contribution (3.25% on Basic)', esiEmployerM)] : []),
    ...(medicalM > 0 ? [row('Medical Contribution', medicalM)] : []),
    ...(gratuityM > 0 ? [row('Gratuity (4.81% of Basic)', gratuityM)] : []),
    row(bonusType, bonusM),
  ];

  return {
    monthly_ctc: Math.round(monthlyCTC), annual_ctc: ctc,
    basic_monthly: basicM, basic_annual: basicM * 12,
    hra_monthly: hraM, hra_annual: hraM * 12,
    conveyance_monthly: convM, conveyance_annual: convFixed ? convM * 12 : Math.max(balanceA, 0),
    special_monthly: specialM, special_annual: convFixed ? Math.max(balanceA, 0) : 0,
    allowances, other_deductions: otherDeductions,
    gross_monthly: grossM, gross_annual: grossA,
    pf_emp_monthly: pfEmpM, pf_emp_annual: pfEmpM * 12,
    esi_emp_monthly: esiEmpM, esi_emp_annual: esiEmpM * 12,
    pf_employer_monthly: pfEmployerM, pf_employer_annual: pfEmployerM * 12,
    esi_employer_monthly: esiEmployerM, esi_employer_annual: esiEmployerM * 12,
    medical_monthly: medicalM, medical_annual: medicalM * 12,
    gratuity_monthly: gratuityM, gratuity_annual: gratuityM * 12,
    bonus_monthly: bonusM, bonus_annual: bonusM * 12, bonusType,
    deduction_monthly: totalDedM, deduction_annual: totalDedM * 12,
    contribution_monthly: contribM, contribution_annual: contribM * 12,
    net_monthly: netM, net_annual: grossA - totalDedM * 12,
    isESI, rows: { earnings, deductions, contributions }, problems,
    usedOverrides: { basic: Number(o.basic) > 0, hra: given(o.hra) && o.hra !== 0, conveyance: convFixed },
  };
}
