// Manpower Requisition Form (MRF) — pure rules: master defaults, form sanitising / validation, the hiring-timeline hint,
// JD text helpers, status workflow, and a deterministic JD / keyword fallback so the flow never depends on the AI being up.
// Everything stateful (database, notifications, permissions) lives in routes/mrf.js.
// The configurable validation / anomaly rules, the experience check and the hiring-target window live in utils/mrfRules.js.
//
// Ownership rule enforced by the routes, in one line: the Hiring Manager owns and approves the Job Description, HR owns
// publication, AI only drafts text and never decides anything.

export const WORKFLOW = {
  draft: { label: 'Draft', step: 1 },
  pending_hm_approval: { label: 'Pending Hiring Manager approval', step: 2 },
  changes_requested: { label: 'Changes requested', step: 2 },
  pending_hr_publication: { label: 'Approved — pending HR publication', step: 4 },
  published: { label: 'Published', step: 5 },
  on_hold: { label: 'On hold', step: 6 },
  closed: { label: 'Closed', step: 6 },          // closed_reason 'filled' | 'closed'
  cancelled: { label: 'Cancelled', step: 6 },
  rejected: { label: 'Rejected by Hiring Manager', step: 6 },
};
import { experienceProblem, experienceText, targetDateProblem } from './mrfRules.js';
export const OPEN_STATUSES = ['draft', 'pending_hm_approval', 'changes_requested', 'pending_hr_publication', 'published', 'on_hold'];

// ── master data defaults (seeded once into the MrfMaster entity; HR can add / edit / deactivate / reorder afterwards) ──
const L = (arr) => arr.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1], meta: v[2] } : { value: String(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), label: v }));
export const DEFAULT_MASTERS = {
  budget_status: L(['Annual Budget', 'Budgeted', 'Non-Budgeted', 'Budget Replacement']),
  position_tier: L(['Executive', 'Senior Executive', 'Deputy Manager', 'Assistant Manager', 'Manager', 'Senior Manager', 'Territory Manager', 'Team Leader', 'Area Manager', 'Regional Manager', 'General Manager', 'Assistant General Manager', 'Deputy General Manager', 'Vice President', 'Senior Vice President', 'Director', 'Managing Director', 'Chief Executive Officer', 'Chief Financial Officer', 'Chief Operating Officer', 'Other / Custom']),
  experience_range: L([['fresher', 'Fresher', { min: 0, max: 0 }], ['0_1', '0–1 Years', { min: 0, max: 1 }], ['1_2', '1–2 Years', { min: 1, max: 2 }], ['3_5', '3–5 Years', { min: 3, max: 5 }], ['5_7', '5–7 Years', { min: 5, max: 7 }], ['8_10', '8–10 Years', { min: 8, max: 10 }], ['10_12', '10–12 Years', { min: 10, max: 12 }], ['12_15', '12–15 Years', { min: 12, max: 15 }], ['15_20', '15–20 Years', { min: 15, max: 20 }], ['above_20', 'Above 20 Years', { min: 20, max: 99 }]]),
  requisition_type: L([['new_position', 'New Position'], ['replacement', 'Replacement'], ['additional_manpower', 'Additional Manpower'], ['backfill_expansion', 'Backfill / Expansion']]),
  employment_type: L([['full_time', 'Full-time'], ['part_time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship']]),
  priority: L([['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]),
  hiring_reason: L(['Business growth', 'Attrition / resignation', 'New project', 'Restructuring', 'Backfill for long leave', 'Seasonal demand', 'Skill gap', 'Other']),
  work_location_type: L([['office', 'Office / Plant'], ['warehouse', 'Warehouse'], ['dealer_location', 'Dealer location'], ['project_site', 'Project site'], ['regional_office', 'Regional office'], ['remote', 'Remote'], ['other', 'Other']]),
  work_arrangement: L([['on_site', 'On-site'], ['hybrid', 'Hybrid'], ['remote', 'Remote']]),
  remote_region: L([['pan_india', 'Remote – Pan India'], ['north_india', 'Remote – North India'], ['specific_state', 'Remote – Specific State'], ['specific_city', 'Remote – Specific City'], ['international', 'Remote – International'], ['custom', 'Custom Location']]),
  ctc_frequency: L([['annual', 'Annual'], ['monthly', 'Monthly']]),
  qualification: L(['B.Tech / B.E.', 'M.Tech / M.E.', 'Diploma (Engineering)', 'ITI', 'B.Sc', 'M.Sc', 'B.Com', 'M.Com', 'BBA', 'MBA', 'BCA', 'MCA', 'CA', 'Any Graduate', '12th Pass']),
  designation: L([
    // Executive & leadership
    'Chairman', 'Managing Director', 'Chief Executive Officer', 'Chief Operating Officer', 'Chief Financial Officer', 'Chief Technology Officer', 'Chief Human Resources Officer', 'Chief Marketing Officer', 'Chief Information Officer', 'Chief Business Officer',
    'Executive Director', 'Whole-time Director', 'President', 'Senior Vice President', 'Vice President', 'Assistant Vice President', 'Associate Vice President', 'General Manager', 'Deputy General Manager', 'Assistant General Manager',
    'Head of Department', 'Business Head', 'Plant Head', 'Unit Head', 'Country Head', 'Vertical Head', 'Zonal Head', 'Regional Head', 'Cluster Head', 'Chief of Staff', 'Executive Assistant to Director', 'Personal Assistant', 'Company Secretary',
    // Management ladder
    'Senior Manager', 'Manager', 'Deputy Manager', 'Assistant Manager', 'Team Leader', 'Team Lead', 'Supervisor', 'Senior Supervisor', 'Shift In-charge', 'Line Leader', 'Senior Executive', 'Executive', 'Junior Executive', 'Trainee Executive', 'Management Trainee', 'Graduate Engineer Trainee', 'Diploma Engineer Trainee', 'Apprentice', 'Intern', 'Associate', 'Senior Associate', 'Consultant', 'Senior Consultant', 'Advisor',
    // Sales & marketing
    'Sales Head', 'National Sales Manager', 'Regional Sales Manager', 'Area Sales Manager', 'Territory Manager', 'Territory Sales Executive', 'Zonal Sales Manager', 'Sales Manager', 'Senior Sales Executive', 'Sales Executive', 'Field Sales Executive', 'Inside Sales Executive', 'Business Development Manager', 'Business Development Executive', 'Key Account Manager', 'Key Account Executive', 'Channel Sales Manager', 'Dealer Development Manager', 'Dealer Relationship Executive', 'Distributor Manager', 'Export Sales Manager', 'International Business Manager', 'Tender Executive', 'Bid Manager', 'Pre-Sales Engineer', 'Sales Coordinator', 'Sales Support Executive', 'Sales Operations Executive', 'CRM Executive', 'Lead Generation Executive', 'Telecaller', 'Tele Sales Executive',
    'Marketing Manager', 'Marketing Executive', 'Digital Marketing Manager', 'Digital Marketing Executive', 'Performance Marketing Executive', 'SEO Executive', 'Social Media Executive', 'Content Writer', 'Content Strategist', 'Brand Manager', 'Product Marketing Manager', 'Graphic Designer', 'Video Editor', 'Creative Designer', 'Public Relations Executive', 'Event Executive', 'Market Research Analyst',
    // Production & manufacturing
    'Production Head', 'Production Manager', 'Assistant Production Manager', 'Production Engineer', 'Production Supervisor', 'Production Executive', 'Production Planner', 'Assembly Line Operator', 'Machine Operator', 'CNC Operator', 'Welding Operator', 'Welder', 'Fitter', 'Technician', 'Senior Technician', 'Electrician', 'Wireman', 'Operator', 'Helper', 'Packing Operator', 'Packaging Executive', 'Battery Pack Assembler', 'Cell Sorting Operator', 'Pack Testing Technician', 'Soldering Technician', 'Spot Welding Operator', 'Process Engineer', 'Manufacturing Engineer', 'Industrial Engineer', 'Lean Manufacturing Engineer', 'Continuous Improvement Executive', 'Tooling Engineer', 'Tool Room Technician', 'Plant Engineer',
    // Quality
    'Quality Head', 'Quality Manager', 'Quality Assurance Manager', 'Quality Control Manager', 'Quality Engineer', 'Quality Assurance Executive', 'Quality Control Executive', 'Quality Inspector', 'Incoming Quality Inspector', 'In-process Quality Inspector', 'Final Inspection Executive', 'Supplier Quality Engineer', 'Customer Quality Engineer', 'Quality Auditor', 'Calibration Technician', 'Document Controller', 'Management Representative (QMS)',
    // Engineering, R&D, design
    'Head of R&D', 'R&D Manager', 'R&D Engineer', 'Senior R&D Engineer', 'Research Scientist', 'Battery Design Engineer', 'Battery Management System Engineer', 'BMS Firmware Engineer', 'Embedded Systems Engineer', 'Firmware Engineer', 'Hardware Design Engineer', 'PCB Design Engineer', 'Power Electronics Engineer', 'Electrical Engineer', 'Electronics Engineer', 'Mechanical Design Engineer', 'CAD Engineer', 'Design Engineer', 'Thermal Engineer', 'Simulation Engineer', 'Test Engineer', 'Validation Engineer', 'Reliability Engineer', 'Application Engineer', 'Product Engineer', 'Product Manager', 'Product Owner', 'Systems Engineer', 'Project Engineer', 'Solar Design Engineer', 'Energy Storage Systems Engineer', 'Electrical Design Engineer', 'Instrumentation Engineer', 'Automation Engineer', 'PLC Programmer', 'Robotics Engineer', 'Technical Specialist', 'Technical Lead', 'Solution Architect',
    // IT & software
    'IT Head', 'IT Manager', 'IT Executive', 'IT Support Engineer', 'System Administrator', 'Network Administrator', 'Network Engineer', 'Database Administrator', 'DevOps Engineer', 'Cloud Engineer', 'Cyber Security Analyst', 'Software Developer', 'Senior Software Developer', 'Software Engineer', 'Senior Software Engineer', 'Associate Software Engineer', 'Full Stack Developer', 'Frontend Developer', 'Backend Developer', 'Mobile App Developer', 'Android Developer', 'iOS Developer', 'React Developer', 'Node.js Developer', 'Python Developer', 'Java Developer', '.NET Developer', 'PHP Developer', 'Web Developer', 'UI/UX Designer', 'QA Engineer (Software)', 'Automation Test Engineer', 'Software Architect', 'Engineering Manager', 'Scrum Master', 'Business Analyst', 'Data Analyst', 'Data Engineer', 'Data Scientist', 'MIS Executive', 'MIS Analyst', 'ERP Consultant', 'ERP Executive', 'SAP Consultant', 'IoT Engineer', 'AI / ML Engineer', 'Technical Support Executive',
    // Supply chain, purchase, stores, logistics
    'Supply Chain Head', 'Supply Chain Manager', 'Supply Chain Executive', 'Supply Chain Planner', 'Demand Planner', 'Procurement Manager', 'Purchase Manager', 'Purchase Executive', 'Senior Purchase Executive', 'Buyer', 'Sourcing Manager', 'Sourcing Engineer', 'Vendor Development Engineer', 'Vendor Development Executive', 'Import Executive', 'Export Executive', 'Import-Export Manager', 'Customs Executive', 'EXIM Documentation Executive', 'Stores Manager', 'Stores Executive', 'Store Keeper', 'Store Assistant', 'Inventory Controller', 'Inventory Executive', 'Warehouse Manager', 'Warehouse Executive', 'Warehouse Supervisor', 'Warehouse Associate', 'Forklift Operator', 'Material Handler', 'Dispatch Executive', 'Dispatch Supervisor', 'Logistics Manager', 'Logistics Executive', 'Transport Coordinator', 'Fleet Manager', 'Driver', 'Delivery Executive', 'Production Planning & Control Executive',
    // Finance & accounts
    'Finance Head', 'Finance Manager', 'Senior Finance Manager', 'Financial Controller', 'Chief Accountant', 'Accounts Manager', 'Assistant Accounts Manager', 'Senior Accountant', 'Accountant', 'Accounts Executive', 'Accounts Assistant', 'Accounts Payable Executive', 'Accounts Receivable Executive', 'Billing Executive', 'Invoicing Executive', 'Cost Accountant', 'Costing Executive', 'Treasury Manager', 'Treasury Executive', 'Banking Executive', 'Credit Control Executive', 'Collections Executive', 'GST Executive', 'Taxation Manager', 'Taxation Executive', 'Statutory Compliance Executive', 'Internal Auditor', 'Audit Manager', 'FP&A Manager', 'Financial Analyst', 'Budget Analyst', 'Payroll Executive', 'Payroll Manager', 'Fixed Asset Accountant', 'Investor Relations Manager', 'Credit Analyst',
    // HR & admin
    'HR Head', 'HR Manager', 'Senior HR Manager', 'HR Business Partner', 'HR Generalist', 'HR Executive', 'HR Assistant', 'Talent Acquisition Manager', 'Talent Acquisition Executive', 'Recruiter', 'Senior Recruiter', 'Technical Recruiter', 'Recruitment Coordinator', 'Learning & Development Manager', 'Learning & Development Executive', 'Trainer', 'Training Coordinator', 'Compensation & Benefits Manager', 'HR Operations Executive', 'HRIS Executive', 'Employee Relations Executive', 'Employee Engagement Executive', 'Onboarding Executive', 'Industrial Relations Manager', 'Labour Welfare Officer', 'Welfare Officer',
    'Admin Head', 'Admin Manager', 'Admin Executive', 'Administrative Assistant', 'Office Administrator', 'Office Assistant', 'Office Boy', 'Peon', 'Receptionist', 'Front Desk Executive', 'Front Office Executive', 'Facility Manager', 'Facility Executive', 'Housekeeping Supervisor', 'Housekeeping Staff', 'Security Officer', 'Security Supervisor', 'Security Guard', 'Gate Keeper', 'Canteen Supervisor', 'Travel Desk Executive', 'Data Entry Operator', 'Computer Operator',
    // Customer service, after-sales, projects
    'Customer Service Manager', 'Customer Service Executive', 'Customer Support Executive', 'Customer Care Executive', 'Call Centre Executive', 'Helpdesk Executive', 'After-Sales Service Manager', 'After-Sales Service Engineer', 'Service Engineer', 'Senior Service Engineer', 'Field Service Engineer', 'Service Technician', 'Warranty Executive', 'Warranty Analyst', 'Installation Engineer', 'Commissioning Engineer', 'Site Engineer', 'Site Supervisor', 'Technical Service Executive', 'Customer Success Manager', 'Complaint Handling Executive',
    'Project Head', 'Project Director', 'Project Manager', 'Assistant Project Manager', 'Project Coordinator', 'Project Planner', 'Project Executive', 'Program Manager', 'PMO Manager', 'Site Manager', 'Civil Engineer', 'Civil Supervisor', 'Estimation Engineer', 'Billing Engineer', 'Contracts Manager', 'Quantity Surveyor', 'Liaison Officer',
    // Maintenance, EHS, legal, compliance
    'Maintenance Head', 'Maintenance Manager', 'Maintenance Engineer', 'Maintenance Supervisor', 'Maintenance Technician', 'Mechanical Technician', 'Utility Engineer', 'Utility Operator', 'HVAC Technician', 'EHS Manager', 'EHS Officer', 'Safety Officer', 'Safety Engineer', 'Fire Safety Officer', 'Environment Officer', 'Occupational Health Officer', 'Nurse', 'First Aid Attendant',
    'Legal Head', 'Legal Manager', 'Legal Counsel', 'Legal Executive', 'Compliance Manager', 'Compliance Officer', 'Compliance Executive', 'Regulatory Affairs Executive', 'Certification Executive (BIS / AIS / UL)', 'Contracts Executive', 'Risk Manager',
    // Strategy, other
    'Strategy Manager', 'Corporate Planning Manager', 'Business Excellence Manager', 'Corporate Communications Manager', 'CSR Manager', 'Sustainability Manager', 'Government Relations Manager', 'Technical Writer', 'Translator', 'Librarian', 'Photographer', 'Videographer', 'Other / Custom',
  ]),
  skill: L(['Communication', 'Negotiation', 'MS Excel', 'ERP / SAP', 'CRM', 'Lead Generation', 'Project Management', 'Team Leadership', 'Quality Assurance', 'Supply Chain', 'Data Analysis', 'Customer Service']),
};
export const MASTER_LABELS = {
  budget_status: 'Budget Status', position_tier: 'Position Tiers', experience_range: 'Experience Ranges', requisition_type: 'Requisition Types', employment_type: 'Employment Types', priority: 'Priorities',
  hiring_reason: 'Hiring Reasons', designation: 'Designations', work_location_type: 'Work Location Types', work_arrangement: 'Work Arrangements', remote_region: 'Remote Regions', ctc_frequency: 'CTC Frequencies',
  qualification: 'Educational Qualifications', skill: 'Skills & Competencies',
};

// ── form fields ──
const S = (max = 200) => ({ t: 's', max }); const A = (max = 40) => ({ t: 'a', max }); const N = { t: 'n' }; const B = { t: 'b' }; const D = { t: 'd' };
export const FIELDS = {
  budget_status: S(40), requisition_type: S(40), department: S(100), designation: S(120), position_tier: S(80), position_tier_custom: S(80), number_of_positions: N, hiring_manager_id: S(60), reports_to_user_id: S(60),
  employment_type: S(30), priority: S(20), hiring_reason: S(80),
  replaced_employee_user_id: S(60), replaced_employee_name: S(120), replaced_employee_code: S(40), replacement_reason: S(300), expected_relieving_date: D,
  exp_mode: S(10), exp_min_years: N, exp_max_years: N, exp_min: S(20), exp_max: S(20), qualification: A(15), specialisation: A(15), required_skills: A(40), technical_skills: A(40), industry_experience: A(15), certifications: A(15),
  gender_preference: S(30), age_criteria: S(60),
  ctc_min: N, ctc_max: N, ctc_frequency: S(20), budget_approved: B, budget_reference: S(120), compensation_remarks: S(500), disclose_ctc: B,
  work_location_type: S(30), work_location: S(160), work_state: S(80), work_city: S(80), work_country: S(80), is_remote: B, work_arrangement: S(20), remote_region: S(30), remote_region_detail: S(120),
  target_hire_date: D, expected_joining_timeline: S(80), timeline_justification: S(500),
  position_overview: S(4000), purpose_of_hiring: S(2000), key_responsibilities: A(40), key_deliverables: A(30), preferred_skills: A(40), experience_expectations: S(1000), department_requirements: S(2000), additional_notes: S(3000),
};
const clean1 = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
export function cleanForm(input) {
  const out = {};
  for (const [k, spec] of Object.entries(FIELDS)) {
    if (!(k in (input || {}))) continue;
    const v = input[k];
    if (spec.t === 's') out[k] = clean1(v, spec.max);
    else if (spec.t === 'a') {
      const seen = new Set(); out[k] = [];
      for (const x of Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/)) { const c = clean1(x, spec.max === 40 ? 160 : 200); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out[k].push(c); } if (out[k].length >= 60) break; }
    }
    else if (spec.t === 'n') { const n = Number(v); out[k] = v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : Math.max(0, n); }
    else if (spec.t === 'b') out[k] = v === true || v === 'true' || v === 1;
    else if (spec.t === 'd') out[k] = /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
  }
  return out;
}

export const expRangeIndex = (masters, value) => (masters?.experience_range || []).findIndex((m) => m.value === value);

/**
 * Problems that stop a submission (empty = OK). `masters` = { kind: [{value,label,order,is_active}] } from the database.
 * `submissionDate` (YYYY-MM-DD) also checks the hiring target date against the 15–45 day window from that day.
 */
export function submitProblems(f, masters = {}, { submissionDate } = {}) {
  const e = [];
  const need = (v, label) => { if (v === undefined || v === null || String(v).trim() === '' || (Array.isArray(v) && !v.length)) e.push(`${label} is required`); };
  const listed = (kind, v, label) => { const list = (masters[kind] || []).filter((m) => m.is_active !== false); if (v && list.length && !list.some((m) => m.value === v)) e.push(`${label}: choose one of ${list.map((m) => m.label).join(', ')}`); };
  need(f.budget_status, 'Budget status'); listed('budget_status', f.budget_status, 'Budget status');
  listed('requisition_type', f.requisition_type, 'Requisition type');
  need(f.requisition_type, 'Requisition type'); need(f.department, 'Department'); need(f.designation, 'Designation'); need(f.position_tier, 'Position tier');
  if (!(Number(f.number_of_positions) >= 1)) e.push('Number of vacancies must be at least 1');
  need(f.hiring_manager_id, 'Hiring manager'); need(f.employment_type, 'Employment type'); need(f.priority, 'Priority');
  if (f.position_tier === 'other_custom') need(f.position_tier_custom, 'Custom position tier');
  if (f.requisition_type === 'replacement') { need(f.replaced_employee_user_id, 'Replacement Of (the employee being replaced)'); need(f.replacement_reason, 'Reason for replacement'); }
  const expBad = experienceProblem(f, masters); if (expBad) e.push(expBad);
  if (f.ctc_min != null && f.ctc_max != null && Number(f.ctc_max) < Number(f.ctc_min)) e.push('Maximum CTC cannot be lower than the minimum CTC');
  need(f.work_arrangement, 'Work arrangement');
  if (!String(f.work_location || '').trim() && !String(f.work_city || '').trim() && !(f.is_remote && (f.remote_region || f.remote_region_detail))) e.push('Work location (or city / remote region) is required');
  if (!String(f.position_overview || '').trim() && !(f.key_responsibilities || []).length) e.push('Add a position overview or at least one key responsibility');
  if (submissionDate) { const t = targetDateProblem(submissionDate, f.target_hire_date); if (t) e.push(t); }
  return e;
}

// ── JD text ──
export const normalizeJd = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A change counts as material when the words differ — formatting-only edits (spacing, bullets, punctuation, case) do not. */
export const isMaterialJdChange = (a, b) => normalizeJd(a) !== normalizeJd(b);

export const ABOUT_COMPANY = 'MaxVolt Energy Industries Limited (NSE SME: MAXVOLT) is an Indian lithium-ion battery pack and energy storage manufacturer based in Ghaziabad, building energy solutions for mobility and stationary storage. We value ownership, quality and a culture where people grow with the company.';
const bullets = (arr) => (arr || []).map((x) => `• ${x}`).join('\n');
const expLabel = (f, masters) => {
  if (Number.isFinite(f.exp_min_years) || Number.isFinite(f.exp_max_years)) return experienceText(f, masters) || 'As per role';
  const find = (v) => (masters?.experience_range || []).find((m) => m.value === v);
  const lab = (v) => find(v)?.label || v || '';
  if (f.exp_mode === 'single' || !f.exp_max || f.exp_max === f.exp_min) return lab(f.exp_min) || lab(f.exp_max) || 'As per role';
  const lo = find(f.exp_min)?.meta, hi = find(f.exp_max)?.meta;
  if (lo && hi && Number.isFinite(lo.min) && Number.isFinite(hi.max)) return hi.max >= 99 ? `${lo.min}+ years` : `${lo.min}–${hi.max} years`;   // "3–7 years" reads better than "3–5 Years to 5–7 Years"
  return `${lab(f.exp_min)} to ${lab(f.exp_max)}`;
};
export const locationLabel = (f) => [f.work_location, f.work_city, f.work_state, f.work_country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ')
  || (f.is_remote ? [f.remote_region ? String(f.remote_region).replace(/_/g, ' ') : '', f.remote_region_detail].filter(Boolean).join(' — ') || 'Remote' : '');
export const ctcLabel = (f) => {
  if (f.ctc_min == null && f.ctc_max == null) return '';
  const fmt = (n) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);
  return `${fmt(f.ctc_min)}${f.ctc_max != null ? ` – ${fmt(f.ctc_max)}` : ''} ${f.ctc_frequency === 'monthly' ? 'per month' : 'per annum'}`;
};

const COMPETENCIES = {
  junior: ['Ownership and reliability', 'Clear written and verbal communication', 'Eagerness to learn and take feedback', 'Attention to detail', 'Teamwork and a positive attitude'],
  mid: ['Ownership and accountability', 'Problem solving and sound judgement', 'Planning and time management', 'Collaboration across teams', 'Clear communication with stakeholders'],
  lead: ['Leading and mentoring a team', 'Planning, prioritising and delivering results', 'Decision-making under pressure', 'Stakeholder management', 'Driving process and quality improvements'],
  senior: ['Strategic thinking and business acumen', 'Leadership and people development', 'Budget and resource ownership', 'Cross-functional influence', 'Driving measurable business outcomes'],
};
const tierBand = (tierLabel) => {
  const t = String(tierLabel || '').toLowerCase();
  if (/chief|director|president|managing|general manager|^gm|head/.test(t)) return 'senior';
  if (/manager|team lead|leader|supervisor|territory|area|regional/.test(t)) return 'lead';
  if (/senior executive|deputy|assistant manager/.test(t)) return 'mid';
  return 'junior';
};
const sentence = (x) => { const t = String(x || '').trim().replace(/[.;]+$/, ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
const listOf = (arr) => { const a = (arr || []).filter(Boolean); return a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`; };
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

/**
 * Reads like a real job posting: a written role summary, responsibilities (topped up with proven ones for the department when
 * the requester gave few), qualifications with the experience line, skills, competencies for the level, reporting line and
 * the company. This is also the fallback when the AI is unavailable, so a requisition never gets a thin JD.
 */
export function templateJd(f, ctx = {}) {
  const masters = ctx.masters || {};
  const tier = f.position_tier === 'other_custom' ? f.position_tier_custom : ((masters.position_tier || []).find((m) => m.value === f.position_tier)?.label || f.position_tier);
  const etype = (masters.employment_type || []).find((m) => m.value === f.employment_type)?.label || f.employment_type || 'Full-time';
  const kw = fallbackKeywords(f);
  const loc = locationLabel(f);
  const n = Number(f.number_of_positions) || 1;
  const title = f.designation || 'Professional';
  const reports = ctx.reportsToDesignation || '';   // a designation, never a person's name

  const resp = [...(f.key_responsibilities || [])];
  for (const r of kw.responsibilities || []) { if (resp.length >= 7) break; if (!resp.some((x) => x.toLowerCase() === r.toLowerCase())) resp.push(r); }
  const skills = [...(f.required_skills || []), ...(f.technical_skills || [])].filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  const quals = [...(f.qualification || [])];
  if (!quals.length) for (const q of kw.qualifications || []) quals.push(q);
  const exp = expLabel(f, masters);
  const qualLines = [...quals, ...(f.specialisation || []).map((x) => `Specialisation / stream: ${x}`), ...(f.certifications || []).map((x) => `Certification: ${x}`),
    /^fresher/i.test(exp) ? 'Freshers are welcome to apply' : exp && exp !== 'As per role' ? `${/year/i.test(exp) ? exp : exp + ' years'} of relevant experience${(f.industry_experience || []).length ? ` in ${listOf(f.industry_experience)}` : ''}` : ((f.industry_experience || []).length ? `Experience in ${listOf(f.industry_experience)}` : '')].filter(Boolean);

  const about = f.position_overview
    ? String(f.position_overview).trim()
    : [`MaxVolt Energy is looking for ${n > 1 ? `${n} ` : `${article(title)} `}${title}${n > 1 ? 's' : ''} to join our ${f.department || ''} team${loc ? ` at ${loc}` : ''}.`,
      f.purpose_of_hiring ? sentence(f.purpose_of_hiring) + '.' : `This is ${article(etype)} ${etype.toLowerCase()} ${f.requisition_type === 'replacement' ? 'replacement ' : ''}position${tier ? ` at the ${tier} level` : ''} that supports our growing operations.`,
      resp.length ? `In this role you will ${resp.slice(0, 2).map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(' and ')}, working closely with colleagues across the organisation.` : '',
      reports ? `You will report to the ${reports}.` : ''].filter(Boolean).join(' ');

  const out = [];
  out.push(`JOB TITLE\n${title}`);
  out.push(`DEPARTMENT\n${f.department || ''}`);
  if (tier) out.push(`POSITION TIER\n${tier}`);
  out.push(`JOB LOCATION\n${loc || 'As per company requirement'}${f.work_arrangement ? ` (${String(f.work_arrangement).replace(/_/g, '-')})` : ''}`);
  out.push(`EMPLOYMENT TYPE\n${etype}`);
  out.push(`EXPERIENCE REQUIRED\n${exp}`);
  if (f.disclose_ctc && ctcLabel(f)) out.push(`COMPENSATION RANGE\n${ctcLabel(f)}`);
  out.push(`ABOUT THE ROLE\n${about}`);
  if (resp.length) out.push(`KEY RESPONSIBILITIES\n${bullets(resp.map(sentence))}`);
  if ((f.key_deliverables || []).length) out.push(`KEY DELIVERABLES\n${bullets(f.key_deliverables.map(sentence))}`);
  if (qualLines.length) out.push(`REQUIRED QUALIFICATIONS\n${bullets(qualLines.map(sentence))}`);
  if (skills.length) out.push(`TECHNICAL / FUNCTIONAL SKILLS\n${bullets(skills)}`);
  if ((f.preferred_skills || []).length) out.push(`PREFERRED SKILLS\n${bullets(f.preferred_skills)}`);
  out.push(`KEY COMPETENCIES\n${bullets([...(f.experience_expectations ? [sentence(f.experience_expectations)] : []), ...COMPETENCIES[tierBand(tier || title)]])}`);
  out.push(`REPORTING STRUCTURE\n${reports ? `Reports to the ${reports}${f.department ? `, ${f.department}` : ''}.` : `Reports within the ${f.department || 'department'} as directed by the Hiring Manager.`}`);
  if (f.department_requirements || f.additional_notes) out.push(`ADDITIONAL REQUIREMENTS\n${bullets([f.department_requirements, f.additional_notes].filter(Boolean).map(sentence))}`);
  out.push(`ABOUT MAXVOLT ENERGY\n${ABOUT_COMPANY}`);
  return out.join('\n\n');
}

/** Turns whatever the AI returned (markdown, "-"/"*" bullets, "##" headings, bold) into the plain, consistent JD format. */
export function normalizeJdText(text) {
  let t = String(text || '').replace(/\r/g, '').replace(/^```[a-z]*\n?|```$/gim, '');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
  const lines = t.split('\n').map((raw) => {
    let l = raw.trimEnd();
    const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l);
    if (h) return `\n${h[1].replace(/[:：]\s*$/, '').toUpperCase()}`;
    const b = /^\s*[-*•–]\s+(.*)$/.exec(l);
    if (b) return `• ${b[1]}`;
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(l);
    if (num) return `• ${num[1]}`;
    // "Key Responsibilities:" on its own line -> heading
    const colon = /^\s*([A-Za-z][A-Za-z /&'’()-]{2,48}):\s*$/.exec(l);
    if (colon) return `\n${colon[1].toUpperCase()}`;
    return l;
  });
  t = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // a heading line directly followed by text keeps one blank line before the heading, none after
  return t.split(/\n{2,}/).map((blk) => blk.trim()).filter(Boolean).join('\n\n');
}
export const JD_REQUIRED_HEADINGS = ['ABOUT THE ROLE', 'KEY RESPONSIBILITIES', 'REQUIRED QUALIFICATIONS'];
/** True when generated text looks like a complete JD (has the core sections and real content). */
export function jdLooksComplete(text) {
  const t = String(text || ''); if (t.length < 500) return false;
  return JD_REQUIRED_HEADINGS.every((h) => new RegExp(`^${h.replace(/[/()]/g, '\\$&')}\\s*$`, 'mi').test(t));
}

// ── keyword suggestions: department-aware fallback (used when the AI is unavailable and to top up its answer) ──
const KW = [
  { re: /software|developer|engineer.*(it|software)|it\b|tech|programm|full.?stack|front.?end|back.?end/i, skills: ['React.js', 'Node.js', 'REST APIs', 'JavaScript', 'Git', 'Database Management', 'Debugging', 'Software Development Lifecycle', 'API Integration'], resp: ['Design, develop and maintain software modules', 'Write clean, tested and documented code', 'Debug and resolve production issues', 'Participate in code reviews and sprint planning'], qual: ['B.Tech / B.E. in Computer Science or IT', 'MCA / BCA'] },
  { re: /sales|business development|bd\b|marketing|dealer|territory|channel/i, skills: ['Lead Generation', 'Client Acquisition', 'B2B Sales', 'Negotiation', 'CRM', 'Market Research', 'Revenue Growth', 'Dealer Management'], resp: ['Identify and develop new business opportunities', 'Manage dealer / channel relationships and targets', 'Prepare quotations and close deals', 'Track pipeline and report sales performance'], qual: ['Graduate (MBA preferred)'] },
  { re: /account|finance|audit|tax|treasury|payroll/i, skills: ['Tally / ERP', 'GST & TDS', 'Financial Reporting', 'MS Excel', 'Reconciliation', 'Budgeting', 'Statutory Compliance'], resp: ['Maintain books of accounts and reconciliations', 'Handle statutory filings and compliance', 'Prepare MIS and financial reports'], qual: ['B.Com / M.Com / CA / MBA Finance'] },
  { re: /hr|human resource|talent|recruit|people/i, skills: ['Recruitment', 'Onboarding', 'Payroll Coordination', 'Employee Engagement', 'HRMS', 'Labour Laws', 'Performance Management'], resp: ['Manage end-to-end recruitment and onboarding', 'Maintain employee records and HR policies', 'Coordinate payroll inputs and compliance'], qual: ['MBA / PGDM in HR'] },
  { re: /production|manufactur|plant|assembly|operations|quality|qa|qc|process/i, skills: ['Lean Manufacturing', '5S', 'Quality Control', 'SOP Compliance', 'Production Planning', 'Root Cause Analysis', 'Safety Compliance'], resp: ['Plan and monitor daily production targets', 'Ensure adherence to SOPs and quality standards', 'Reduce rework and downtime'], qual: ['Diploma / B.Tech in Mechanical, Electrical or Electronics'] },
  { re: /battery|bms|r&d|research|design|electrical|electronics|embedded|firmware/i, skills: ['Li-ion Battery Pack Design', 'BMS', 'CAD', 'Embedded Systems', 'Testing & Validation', 'Circuit Design', 'Thermal Management'], resp: ['Design and validate battery pack / BMS solutions', 'Run test plans and analyse results', 'Support prototype-to-production transfer'], qual: ['B.Tech / M.Tech in Electrical, Electronics or Mechanical'] },
  { re: /supply|purchase|procure|logistic|warehouse|store|inventory/i, skills: ['Vendor Development', 'Negotiation', 'Inventory Management', 'ERP / SAP', 'Logistics Planning', 'Cost Reduction', 'Import / Export'], resp: ['Source and negotiate with vendors', 'Maintain optimal inventory levels', 'Coordinate inbound and outbound logistics'], qual: ['Graduate / B.Tech; MBA (SCM) preferred'] },
  { re: /admin|office|front desk|reception|facility|security/i, skills: ['MS Office', 'Vendor Coordination', 'Facility Management', 'Records Management', 'Communication'], resp: ['Manage office administration and facilities', 'Coordinate with vendors and service providers'], qual: ['Graduate'] },
  { re: /customer|service|support|after.?sales|warranty|technician/i, skills: ['Customer Service', 'Ticket Management', 'Troubleshooting', 'CRM', 'Communication', 'Warranty Handling'], resp: ['Resolve customer queries within SLA', 'Coordinate service visits and warranty claims'], qual: ['Diploma / Graduate'] },
];
export function fallbackKeywords(f) {
  const hay = `${f.department || ''} ${f.designation || ''}`;
  const hit = KW.find((k) => k.re.test(hay));
  return hit ? { skills: hit.skills, technical: hit.skills.slice(0, 5), responsibilities: hit.resp, qualifications: hit.qual, source: 'rules' } : { skills: ['Communication', 'Problem Solving', 'MS Office', 'Teamwork', 'Time Management'], technical: [], responsibilities: [], qualifications: [], source: 'rules' };
}

// ── workflow guards (routes call these; the frontend only mirrors them for button visibility) ──
export const JD_EDITABLE_BY_CREATOR = ['draft', 'changes_requested'];
export const canTransition = (from, to) => ({
  draft: ['pending_hm_approval', 'cancelled'],
  changes_requested: ['pending_hm_approval', 'cancelled'],
  pending_hm_approval: ['pending_hr_publication', 'changes_requested', 'rejected', 'cancelled'],
  pending_hr_publication: ['published', 'changes_requested', 'pending_hm_approval', 'on_hold', 'cancelled'],
  published: ['on_hold', 'closed', 'cancelled', 'pending_hm_approval', 'pending_hr_publication'],
  on_hold: ['published', 'pending_hr_publication', 'closed', 'cancelled'],
  closed: ['pending_hr_publication', 'changes_requested'],        // reopened
  cancelled: ['pending_hr_publication', 'changes_requested'],
  rejected: ['changes_requested'],
}[from] || []).includes(to);

/** Field-by-field changes between two versions of the form (for the audit trail). */
export function diffForm(before, after) {
  const out = [];
  for (const k of Object.keys(FIELDS)) {
    if (!(k in after)) continue;
    const a = JSON.stringify(before?.[k] ?? (Array.isArray(after[k]) ? [] : '')), b = JSON.stringify(after[k]);
    if (a !== b) out.push({ field: k, from: before?.[k] ?? null, to: after[k] });
  }
  return out;
}

export const nextReqId = (existingIds, year) => {
  const prefix = `MRF-${year}-`; let max = 0;
  for (const id of existingIds) if (String(id || '').startsWith(prefix)) max = Math.max(max, parseInt(String(id).slice(prefix.length), 10) || 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
};

const PRIORITY_LEGACY = { critical: 'urgent', high: 'high', medium: 'medium', low: 'low' };
/** The fields the older Job Requisition / Recruitment / careers-page code reads, kept in step with the new form. */
export function legacyMirror(rec, masters = {}) {
  const annual = (n) => (n == null ? 0 : (rec.ctc_frequency === 'monthly' ? Number(n) * 12 : Number(n)));
  const show = rec.disclose_ctc || false;
  return {
    position_title: rec.designation || '', department: rec.department || '', employment_type: rec.employment_type || 'full_time',
    number_of_positions: rec.number_of_positions || 1, experience_required: expLabel(rec, masters), location: locationLabel(rec),
    salary_range_min: show ? annual(rec.ctc_min) : 0, salary_range_max: show ? annual(rec.ctc_max) : 0, show_salary_publicly: !!show,   // an undisclosed CTC is never mirrored onto the publicly served record
    target_hire_date: rec.target_hire_date || '', priority: PRIORITY_LEGACY[rec.priority] || 'medium',
    required_skills: [...(rec.required_skills || []), ...(rec.technical_skills || [])].filter((x, i, a) => a.indexOf(x) === i),
    job_description: rec.position_overview || '', hiring_manager_id: rec.hiring_manager_id || '',
  };
}
