// App Walkthrough — step content for the interactive guided tour (see
// components/tour/AppTour.jsx for the engine that drives these). Distinct
// from EmployeeTraining/"My Training" (the formal Learning & Development
// module) — this is purely "how to use Maxvolt One itself".
//
// Each step either targets a nav item (via `page`, matched against the
// `data-tour-page="<page>"` attribute NavItem already carries in Layout.jsx
// for every menu entry — so any page in ANY role's menu is automatically
// highlightable with zero extra markup) or a specific chrome element (via
// `target`, matched against a `data-tour="<target>"` attribute placed by
// hand on the couple of non-nav elements worth calling out: the
// notification bell and the theme toggle). A step with neither is a
// plain centered card (used for the welcome/closing steps, and as the
// graceful fallback AppTour.jsx uses when a targeted element genuinely
// isn't in the DOM right now — e.g. a mobile viewport where that nav item
// is tucked inside the collapsed "More" sheet).
const step = (id, title, description, extra = {}) => ({ id, title, description, ...extra });

const WELCOME_STEP = step(
  'welcome', 'Welcome to Maxvolt One! 👋',
  "Let's take a quick tour of the app so you know where everything is. Click Next to get started, or Skip if you'd rather explore on your own — you can always restart this tour later from App Settings."
);

const CLOSING_STEP = step(
  'closing', "You're all set!",
  "That's the essentials. You can revisit anything you saw today, and if you ever get stuck, look for the Helpdesk option in the menu. Enjoy using Maxvolt One!"
);

const NOTIF_STEP = step('notif-bell', 'Notifications', 'Approvals, announcements, and reminders all show up here — click the bell any time to check what needs your attention.', { target: 'notif-bell' });
const THEME_STEP = step('theme-toggle', 'Light / Dark Mode', "Prefer a darker look? Toggle it here any time — your choice is remembered for next time.", { target: 'theme-toggle' });

// The standard employee self-service core — shared by every role that has
// this menu (employee, manager, management, hr, admin, recruiter all keep
// their own copy of these same pages, per Layout.jsx's menu groups).
const EMPLOYEE_CORE_STEPS = [
  step('dashboard', 'Your Dashboard', 'This is your home screen — a quick summary of your attendance, leave balance, and the latest announcements.', { page: 'Dashboard' }),
  step('mark-attendance', 'Mark Attendance', 'Check in when you start work and check out when you leave — this is also where automatic geofence/biometric attendance shows up if it applies to you.', { page: 'MarkAttendance' }),
  step('attendance-history', 'Attendance History', 'See your full attendance calendar here, and request a correction if a day looks wrong.', { page: 'AttendanceHistory' }),
  step('leave', 'Apply for Leave', 'Apply for leave, check your remaining balance, and track the approval status of past requests.', { page: 'Leave' }),
  step('payslips', 'My Payslips', 'Your monthly payslips are available here as soon as they\'re processed.', { page: 'Payslips' }),
  step('documents', 'My Documents', 'Upload and access your personal documents — ID proofs, certificates, and anything HR needs from you.', { page: 'Documents' }),
  step('profile', 'My Profile', 'Review and update your personal details, bank information, and emergency contacts here.', { page: 'Profile' }),
];

// Gate Admin's whole menu is different from every other role (no personal
// attendance/leave self-service pages at all) — its own self-contained
// "core" rather than an add-on to EMPLOYEE_CORE_STEPS.
const GATE_ADMIN_CORE_STEPS = [
  step('gate-dashboard', 'Gate Admin Dashboard', 'Manage employee gate passes here — approve departures, log returns, and see who\'s currently out.', { page: 'GateAdminDashboard' }),
  step('visitor-management', 'Visitor Management', 'Approve visitor requests, register walk-ins, scan QR passes, and check visitors in and out — all scoped to whichever office location(s) you\'re assigned to.', { page: 'VisitorManagement' }),
  step('gate-profile', 'My Profile', 'Your own profile and account details live here.', { page: 'GateAdminProfile' }),
];

// A short, role-specific tail appended after the core steps — the "one
// core tour + role add-on" design. Only the extra things THAT role can do
// beyond the standard self-service menu.
const ROLE_ADDON_STEPS = {
  manager: [
    step('team', 'My Team', 'See your direct and indirect reports, their attendance, and their profiles here.', { page: 'Employees' }),
    step('leave-approvals', 'Leave Approvals', "Approve or reject your team's leave requests here.", { page: 'LeaveManagement' }),
    step('team-attendance', 'Team Attendance', "Review your team's attendance and regularisation requests here.", { page: 'AllAttendance' }),
  ],
  management: [
    step('org-team', 'Your Team', 'See your organisation or team hierarchy, attendance, and profiles here.', { page: 'Employees' }),
    step('mgmt-approvals', 'Approvals', 'Leave, expense, and gate pass approvals for your team all come through here.', { page: 'LeaveManagement' }),
    step('mis', 'MIS Analytics', 'High-level workforce analytics and trends for your organisation.', { page: 'MISDashboard' }),
  ],
  hr: [
    step('employees', 'Employees', "Your organisation's full employee directory — add, edit, and manage records here.", { page: 'Employees' }),
    step('hr-leave', 'Leave Management', 'Review and approve leave requests company-wide.', { page: 'LeaveManagement' }),
    step('payroll', 'Payroll', 'Process monthly payroll, manage salary structures, and generate payslips here.', { page: 'PayrollManagement' }),
  ],
  admin: [
    step('employees', 'Employees', "Your organisation's full employee directory — add, edit, and manage records here.", { page: 'Employees' }),
    step('payroll', 'Payroll', 'Process monthly payroll, manage salary structures, and generate payslips here.', { page: 'PayrollManagement' }),
    step('admin-panel', 'Admin Panel', 'User accounts, system data, and app-wide settings are all managed here.', { page: 'AdminPanel' }),
  ],
  recruiter: [
    step('requisitions', 'Job Requisitions', 'Raise and track open positions here.', { page: 'JobRequisitions' }),
    step('candidates', 'Candidates', 'Manage your candidate pipeline, from application through offer.', { page: 'Recruitment' }),
  ],
};

export function getTourStepsForRole(role) {
  if (role === 'gate_admin') {
    return [WELCOME_STEP, ...GATE_ADMIN_CORE_STEPS, NOTIF_STEP, THEME_STEP, CLOSING_STEP];
  }
  const addons = ROLE_ADDON_STEPS[role] || [];
  return [WELCOME_STEP, ...EMPLOYEE_CORE_STEPS, ...addons, NOTIF_STEP, THEME_STEP, CLOSING_STEP];
}

// Resolves a step to the CSS selector AppTour.jsx should look for, or null
// for a plain centered card (welcome/closing, or any step with neither
// `page` nor `target` set).
export function selectorForStep(stepDef) {
  if (stepDef.target) return `[data-tour="${stepDef.target}"]`;
  if (stepDef.page) return `[data-tour-page="${stepDef.page}"]`;
  return null;
}
