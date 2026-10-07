// Default L&D content — built from the approved "New Employee Induction & Training Program"
// and the L&D Module Scope. Everything here is a STARTING POINT that L&D / HR can edit in the
// app (a template edit creates a new version; people already enrolled stay on their version).

export const DEFAULT_CONFIG = {
  induction_pass_score: 80,
  max_attempts: 3,
  // Escalation ladder, in days overdue: Employee -> Reporting Manager -> HOD -> HR -> L&D
  escalation_days: { employee: 1, manager: 3, hod: 5, hr: 7, ld: 10 },
  due_soon_days: 2,
  expiring_cert_days: 30,
  ld_admin_user_ids: [],
  auto_start_induction: true,
};

const t = (id, title, o = {}) => ({ id, title, actor: 'employee', required: true, type: 'task', ...o });

// completion: 'auto' | 'owner_signoff' | 'assessment' | 'form'
export const DEFAULT_TEMPLATE = {
  name: 'New Employee Induction',
  version: 1,
  status: 'active',
  description: 'Mandatory gated induction for every new joiner — from pre-joining readiness to the 90-day review.',
  gates: [
    {
      gate_id: 'G00', seq: 0, name: 'Pre-Joining Readiness', owner_roles: ['hr'], required: true, depends_on: [],
      due_offset_days: 0, available_from_offset_days: -14, completion: 'auto',
      description: 'HR confirms everything is ready before the employee arrives.',
      tasks: [
        t('G00-1', 'Joining date, role, department and Reporting Manager confirmed', { actor: 'owner' }),
        t('G00-2', 'HOD and HR SPOC confirmed', { actor: 'owner' }),
        t('G00-3', 'Buddy assigned (a peer — not the Reporting Manager)', { actor: 'owner', auto_check: 'buddy_assigned' }),
        t('G00-4', 'Joining documentation completed and approved', { actor: 'owner', auto_check: 'onboarding_approved' }),
        t('G00-5', 'Maxvolt One registration support ready', { actor: 'owner' }),
        t('G00-6', 'Induction schedule and department-training plan prepared', { actor: 'owner' }),
        t('G00-7', 'Access, workstation and role-specific tools confirmed with the relevant teams', { actor: 'owner' }),
      ],
    },
    {
      gate_id: 'G01', seq: 1, name: 'Corporate Induction', owner_roles: ['hr', 'trainer'], required: true, depends_on: ['G00'],
      due_offset_days: 1, completion: 'owner_signoff',
      description: 'Understand who Maxvolt is, what it builds, its values, business model and growth. (Day 1, 2.5–3 hrs)',
      content: [{ title: 'New Employee Induction — presentation', file: 'induction-deck' }, { title: 'Induction Training Guide', file: 'induction-guide' }],
      tasks: [
        t('G01-1', 'Welcome & company overview — who we are, mission, vision, six core values', { type: 'content' }),
        t('G01-2', 'Business, products & growth — EV, ESS, INV, OEM; growth journey 2019–2026', { type: 'content' }),
        t('G01-3', 'How Maxvolt operates — Source, Design, Make, Distribute, Service, Return', { type: 'content' }),
        t('G01-4', 'Maxvolt ReEarth — circular battery lifecycle (Collect, Assess, Recover, Refine, Reintegrate)', { type: 'content' }),
        t('G01-5', 'Research & publications — awareness of the five research milestones', { type: 'content' }),
        t('G01-6', 'Production, quality & safety — ISO 9001:2015, AIS 156, PPE', { type: 'content' }),
        t('G01-7', 'Activity: "Explain Maxvolt in 60 seconds" completed with the trainer', { actor: 'owner', type: 'practical' }),
      ],
    },
    {
      gate_id: 'G02', seq: 2, name: 'HR / Policy / Safety', owner_roles: ['hr', 'trainer'], required: true, depends_on: ['G01'],
      due_offset_days: 1, completion: 'owner_signoff',
      description: 'Culture, code of conduct, working hours, attendance, leave, benefits, safety and employee support. (Day 1, 1.5–2 hrs)',
      tasks: [
        t('G02-1', 'I have read and understood the Code of Conduct (zero-tolerance areas, no retaliation for good-faith reporting)', { type: 'ack' }),
        t('G02-2', 'I understand working hours, attendance, grace period, missed-punch and overtime rules', { type: 'ack' }),
        t('G02-3', 'I understand leave types (Casual, Earned, Sick), paid holidays and key benefits', { type: 'ack' }),
        t('G02-4', 'I understand Safety First — STOP → ASK → UNDERSTAND → PROCEED — and PPE requirements', { type: 'ack' }),
        t('G02-5', 'I know the support & escalation matrix (Manager, Buddy, HR, Finance, IT, Admin, AskMax)', { type: 'ack' }),
        t('G02-6', 'Scenario discussion "What would you do?" completed with the trainer', { actor: 'owner', type: 'practical' }),
      ],
    },
    {
      gate_id: 'G03', seq: 3, name: 'Maxvolt One Practical', owner_roles: ['hr', 'trainer'], required: true, depends_on: ['G02'],
      due_offset_days: 2, completion: 'owner_signoff',
      description: 'Do it for real: log in, mark attendance, find payslips, apply leave, raise a ticket. (Day 1–2, 1–1.5 hrs)',
      tasks: [
        t('G03-1', 'First login and profile / documents completed', { auto_check: 'onboarding_approved' }),
        t('G03-2', 'Marked attendance in Maxvolt One (selfie + GPS)', { auto_check: 'attendance_marked' }),
        t('G03-3', 'Found where to apply for leave and view the balance', { type: 'ack' }),
        t('G03-4', 'Found My Payslips and understood the breakup', { type: 'ack' }),
        t('G03-5', 'Know how to submit an expense / reimbursement claim (within 30 days)', { type: 'ack' }),
        t('G03-6', 'Raised (or practised raising) a Helpdesk ticket', { auto_check: 'helpdesk_ticket' }),
        t('G03-7', 'Tried AskMax for a policy question', { type: 'ack' }),
        t('G03-8', 'Know My Training, Gate Pass, My Insurance and Company Policies', { type: 'ack' }),
        t('G03-9', 'System trainer confirms the employee can perform the essential actions', { actor: 'owner', type: 'practical' }),
      ],
    },
    {
      gate_id: 'G04', seq: 4, name: 'Business & Cross-Functional Understanding', owner_roles: ['hr', 'trainer'], required: true, depends_on: ['G03'],
      due_offset_days: 2, completion: 'owner_signoff',
      description: 'The six-stage operating model, cross-functional dependencies and the "Follow the Product" exercise.',
      tasks: [
        t('G04-1', 'Understand how departments depend on one another (requirement → customer)', { type: 'content' }),
        t('G04-2', 'Exercise "Follow the Product": map the functions a customer requirement passes through (write it below)', { type: 'text', evidence_required: true }),
        t('G04-3', 'Exercise "Internal Customer": who receives my work and what do they expect? (write it below)', { type: 'text', evidence_required: true }),
        t('G04-4', 'Trainer reviewed both exercises', { actor: 'owner', type: 'practical' }),
      ],
    },
    {
      gate_id: 'G05', seq: 5, name: 'Mandatory Knowledge Assessment', owner_roles: ['ld', 'trainer'], required: true, depends_on: ['G01', 'G02', 'G03', 'G04'],
      due_offset_days: 5, completion: 'assessment', assessment_key: 'induction-knowledge-check', pass_score: 80, max_attempts: 3,
      description: 'Company, business, safety, HR and Maxvolt One. Pass mark 80%. (Day 5, 30–60 min)',
      tasks: [],
    },
    {
      gate_id: 'G06', seq: 6, name: 'Department Induction', owner_roles: ['hod'], required: true, depends_on: ['G04'],
      due_offset_days: 3, completion: 'form',
      description: 'Controlled by the department: purpose, structure, SOPs, systems, KPIs, interfaces and escalation. (Day 2–3, 2–4 hrs)',
      form: [
        { key: 'purpose', label: 'Department purpose' }, { key: 'structure', label: 'Structure — who does what, who reports to whom' },
        { key: 'role', label: 'Role title & core responsibilities' }, { key: 'sops', label: 'Key SOPs' },
        { key: 'systems', label: 'Systems / tools & access' }, { key: 'reports', label: 'Reports / records' },
        { key: 'kpis', label: 'KPIs / targets' }, { key: 'interfaces', label: 'Cross-functional interfaces' },
        { key: 'safety', label: 'Safety / compliance requirements' }, { key: 'escalation', label: 'Escalation — what to escalate immediately' },
      ],
      tasks: [
        t('G06-1', 'Department purpose, structure and outputs explained', { actor: 'owner' }),
        t('G06-2', 'Reporting line, Reporting Manager and department SPOCs introduced', { actor: 'owner' }),
        t('G06-3', 'Key SOPs, systems and access handed over', { actor: 'owner' }),
        t('G06-4', 'KPIs, interfaces and escalation path explained', { actor: 'owner' }),
        t('G06-5', 'Employee confirms they understood the department induction', { type: 'ack' }),
      ],
    },
    {
      gate_id: 'G07', seq: 7, name: 'Role Training', owner_roles: ['manager', 'trainer'], required: true, depends_on: ['G06'],
      due_offset_days: 5, completion: 'form',
      description: 'Role-specific SOPs, systems, processes, technical knowledge and KPIs — assigned by Department + Designation + Grade. (Day 3–5)',
      form: [
        { key: 'what', label: 'WHAT — what exactly am I responsible for?' }, { key: 'why', label: 'WHY — why does my work matter?' },
        { key: 'how', label: 'HOW — which process / SOP do I follow?' }, { key: 'who', label: 'WHO — who do I coordinate with?' },
        { key: 'when', label: 'WHEN — which deadlines and expectations apply?' }, { key: 'howwell', label: 'HOW WELL — how will my performance be evaluated?' },
      ],
      tasks: [
        t('G07-1', 'Role SOPs and work instructions provided and explained', { actor: 'owner' }),
        t('G07-2', 'Role systems demonstrated and access confirmed', { actor: 'owner' }),
        t('G07-3', 'Shadowing / observation sessions completed', { actor: 'owner' }),
        t('G07-4', 'Role clarity — the six questions answered with the manager (form below)', { actor: 'owner' }),
        t('G07-5', 'Initial KPIs and first-30-day expectations explained', { actor: 'owner' }),
      ],
    },
    {
      gate_id: 'G08', seq: 8, name: 'Practical Capability Sign-off', owner_roles: ['trainer', 'manager'], required: true, depends_on: ['G07'],
      due_offset_days: 10, completion: 'competency',
      description: 'LEARN → OBSERVE → PRACTISE → PERFORM → IMPROVE. Only the trainer / manager can sign capability off — never the employee.',
      competencies: [
        { id: 'C1', name: 'Core process execution (key workflows done correctly)' },
        { id: 'C2', name: 'System usage (role tools and records)' },
        { id: 'C3', name: 'SOP understanding and adherence' },
        { id: 'C4', name: 'Quality and safety practice' },
      ],
      tasks: [],
    },
    {
      gate_id: 'G09', seq: 9, name: 'First-Week Closure', owner_roles: ['manager', 'hr'], required: true, depends_on: ['G05', 'G06', 'G07'],
      due_offset_days: 7, completion: 'owner_signoff', required_signoffs: ['manager', 'hr'],
      description: 'Documentation, systems, introductions, role clarity, KPIs and SOPs confirmed. (Day 5)',
      tasks: [
        t('G09-1', 'Joining documentation complete', { actor: 'owner' }),
        t('G09-2', 'Maxvolt One active and attendance marked', { auto_check: 'attendance_marked' }),
        t('G09-3', 'Attendance and leave processes understood', { type: 'ack' }),
        t('G09-4', 'Met Reporting Manager, Buddy and relevant SPOCs', { type: 'ack' }),
        t('G09-5', 'Role responsibilities, KPIs, SOPs and role training understood', { type: 'ack' }),
        t('G09-6', 'First-week feedback given and 30-day expectations confirmed', { actor: 'owner' }),
      ],
    },
    {
      gate_id: 'G10', seq: 10, name: '30-Day Development Review — Learn & Adapt', owner_roles: ['manager'], required: true, depends_on: ['G09'],
      due_offset_days: 30, available_from_offset_days: 25, completion: 'form',
      description: 'Training completed, processes and systems understood, strengths, challenges, support and gaps.',
      form: [
        { key: 'training', label: 'Training completed' }, { key: 'processes', label: 'Processes understood' },
        { key: 'systems', label: 'Systems understood' }, { key: 'strengths', label: 'Strengths' },
        { key: 'challenges', label: 'Challenges' }, { key: 'support', label: 'Support required' },
        { key: 'gaps', label: 'Training gaps' }, { key: 'kpi', label: 'Initial KPI understanding' },
        { key: 'comments', label: 'Manager comments' },
      ],
      tasks: [],
    },
    {
      gate_id: 'G11', seq: 11, name: '60-Day Development Review — Perform & Improve', owner_roles: ['manager'], required: true, depends_on: ['G10'],
      due_offset_days: 60, available_from_offset_days: 55, completion: 'form',
      description: 'Independence, quality, timeliness, coordination, improvement and feedback.',
      form: [
        { key: 'independent', label: 'Responsibilities handled independently' }, { key: 'quality', label: 'Quality of work' },
        { key: 'timeliness', label: 'Timeliness' }, { key: 'coordination', label: 'Cross-functional coordination' },
        { key: 'issues', label: 'Recurring issues identified' }, { key: 'improvement', label: 'Improvement actions' },
        { key: 'feedback', label: 'Feedback discussed' }, { key: 'training', label: 'Further training required' },
        { key: 'comments', label: 'Manager comments' },
      ],
      tasks: [],
    },
    {
      gate_id: 'G12', seq: 12, name: '90-Day Development Review — Own & Contribute', owner_roles: ['manager', 'hr'], required: true, depends_on: ['G11'],
      due_offset_days: 90, available_from_offset_days: 85, completion: 'form', required_signoffs: ['manager', 'hr'],
      description: 'Ownership, performance, development gaps, contribution and the next-stage development plan.',
      form: [
        { key: 'owned', label: 'Responsibilities owned independently' }, { key: 'performance', label: 'Performance against expectations' },
        { key: 'strengths', label: 'Strengths' }, { key: 'gaps', label: 'Development gaps' },
        { key: 'contribution', label: 'Process-improvement contribution' }, { key: 'crossfn', label: 'Cross-functional effectiveness' },
        { key: 'next', label: 'Next-stage responsibilities' }, { key: 'plan', label: 'Development plan' },
        { key: 'comments', label: 'Manager comments' },
      ],
      tasks: [],
    },
  ],
};

const q = (id, type, text, options, correct, extra = {}) => ({ id, type, text, options, correct, points: 1, ...extra });

export const DEFAULT_ASSESSMENT = {
  key: 'induction-knowledge-check',
  title: 'New Employee Induction — Knowledge Check',
  description: 'Company, business, safety, HR and Maxvolt One. Pass mark 80%.',
  pass_score: 80,
  max_attempts: 3,
  time_limit_min: 30,
  randomize: true,
  version: 1,
  status: 'active',
  questions: [
    q('Q1', 'mcq', 'When was Maxvolt Energy established?', ['2015', '2017', '2019', '2022'], [2]),
    q('Q2', 'multi', 'Which are Maxvolt\'s major product areas?', ['EV battery packs', 'Energy Storage Systems (ESS)', 'Inverter batteries (INV)', 'OEM custom batteries', 'Diesel generators'], [0, 1, 2, 3]),
    q('Q3', 'multi', 'Which of these are Maxvolt\'s core values?', ['Innovation', 'Integrity', 'Customer Commitment', 'Safety First', 'Teamwork, Ownership & Accountability', 'Sustainability', 'Profit above everything'], [0, 1, 2, 3, 4, 5]),
    q('Q4', 'mcq', 'What is the correct order of the six-stage operating model?', ['Design → Source → Make → Service → Distribute → Return', 'Source → Design → Make → Distribute → Service → Return', 'Make → Source → Design → Distribute → Return → Service', 'Source → Make → Design → Service → Distribute → Return'], [1]),
    q('Q5', 'mcq', 'What is Maxvolt ReEarth?', ['A solar-panel installer', 'The circular-economy subsidiary for battery reuse, recycling and material recovery', 'A dealer network', 'The HR portal'], [1]),
    q('Q6', 'mcq', 'What are the five circular battery lifecycle stages, in order?', ['Collect → Assess → Recover → Refine → Reintegrate', 'Assess → Collect → Refine → Recover → Reintegrate', 'Collect → Refine → Assess → Reintegrate → Recover', 'Recover → Collect → Assess → Refine → Reintegrate'], [0]),
    q('Q7', 'multi', 'Which are Maxvolt\'s quality and safety anchors?', ['ISO 9001:2015 certified facility', 'AIS 156 certification', 'PPE is mandatory for employees on the floor', 'Safety rules are optional when in a hurry'], [0, 1, 2]),
    q('Q8', 'mcq', 'What does the Safety First rule say you should do when unsure?', ['PROCEED → ASK → STOP', 'STOP → ASK → UNDERSTAND → PROCEED', 'ASK later → PROCEED', 'Skip the step and tell your manager afterwards'], [1]),
    q('Q9', 'mcq', 'How is attendance marked?', ['On paper at the gate', 'Through Maxvolt One (selfie + GPS where biometric is unavailable)', 'By emailing HR', 'It is automatic — nothing to do'], [1]),
    q('Q10', 'mcq', 'You missed an attendance punch. What should you do?', ['Ignore it', 'Raise a regularisation request — manager approval is needed within 12 working hours, otherwise the day is marked absent', 'Ask a colleague to punch for you', 'Wait for HR to notice'], [1], { scenario: true }),
    q('Q11', 'mcq', 'Where do employees apply for leave?', ['By phone to HR', 'In Maxvolt One (Leave)', 'On a paper form', 'Through the Reporting Manager\'s email only'], [1]),
    q('Q12', 'truefalse', 'Casual Leave can be taken for a maximum of 3 days at a stretch.', ['True', 'False'], [0]),
    q('Q13', 'truefalse', 'Earned Leave can be used before probation confirmation.', ['True', 'False'], [1]),
    q('Q14', 'mcq', 'The 4th late arrival in a month onwards results in…', ['Nothing', 'A half-day deduction', 'A written warning only', 'Termination'], [1]),
    q('Q15', 'mcq', 'What is AskMax used for?', ['Booking meeting rooms', 'A 24/7 AI chatbot for policy answers', 'Payroll processing', 'Gate passes'], [1]),
    q('Q16', 'mcq', 'Who is the first point of contact for role priorities?', ['The Buddy', 'The Reporting Manager', 'IT', 'Finance'], [1]),
    q('Q17', 'mcq', 'What is the purpose of the Buddy?', ['To approve leave', 'A peer who helps you settle in and is a friendly first point of contact — not a replacement for the manager or HR', 'To evaluate your performance', 'To assign your KPIs'], [1]),
    q('Q18', 'mcq', 'You identify a safety concern. What should you do?', ['Carry on and mention it next week', 'Stop, and report it through the appropriate channel', 'Fix it yourself without telling anyone', 'Only tell a colleague'], [1], { scenario: true }),
    q('Q19', 'mcq', 'You do not understand an SOP. What should you do?', ['Guess and proceed', 'Ask your Reporting Manager or department SPOC before proceeding', 'Skip the task', 'Copy another team\'s method'], [1], { scenario: true }),
    q('Q20', 'mcq', 'What is the focus of Days 1–30, 31–60 and 61–90?', ['Own → Learn → Perform', 'Learn & Adapt → Perform & Improve → Own & Contribute', 'Perform → Own → Learn', 'Observe → Wait → Report'], [1]),
    q('Q21', 'short', 'Name one first-line support channel for an HR, Finance, IT or Admin query.', [], [], { accepted: ['helpdesk', 'help desk', 'ticket', 'maxvolt one helpdesk'] }),
  ],
};

export const DEFAULT_COURSES = [
  { title: 'New Employee Induction — Presentation', category: 'Corporate', type: 'presentation', mandatory: true, duration_min: 150, file: 'induction-deck', description: 'The official induction deck: company, business, products, growth, operating model, ReEarth, research, quality & safety.' },
  { title: 'New Employee Induction & Training Program — Guide', category: 'HR', type: 'document', mandatory: true, duration_min: 60, file: 'induction-guide', description: 'Complete training guide: schedule, modules, first-week programme, 30/60/90-day plan and checklists.' },
  { title: 'Code of Conduct & Workplace Expectations', category: 'Compliance', type: 'policy_acknowledgement', mandatory: true, duration_min: 30, description: 'Respect, integrity, safety, zero-tolerance areas and professional communication.' },
  { title: 'Safety First & PPE', category: 'Safety', type: 'document', mandatory: true, duration_min: 45, description: 'STOP → ASK → UNDERSTAND → PROCEED; PPE; restricted areas; incident reporting.' },
  { title: 'Using Maxvolt One', category: 'Digital', type: 'practical_task', mandatory: true, duration_min: 90, description: 'Login, attendance, leave, payslips, expenses, Helpdesk, AskMax, My Training.' },
];
