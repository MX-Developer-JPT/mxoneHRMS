// Derived "Overall Clearance/Exit Status" — a presentation-layer mapping over
// fields the Exit record already carries (exit.status, clearance_checklist,
// no_dues_generated, declaration_signed_at, fnf_data). Nothing here is stored;
// it's recomputed on every read so it can never drift from the underlying data.

const FNF_STATUSES = ['fnf_prepared', 'fnf_verified', 'fnf_hr_approved', 'fnf_finance_processed', 'fnf_employee_accepted', 'fnf_pending'];

export function isChecklistFullyCleared(checklist) {
  const entries = Object.values(checklist || {});
  if (!entries.length) return false;
  return entries.every(v => v.mandatory === false || ['cleared', 'not_applicable'].includes(v.status));
}

export function deriveOverallExitStatus(exit) {
  if (!exit) return 'Not Started';
  const { status } = exit;

  if (status === 'completed') return 'Exit Closed';
  if (['withdrawn', 'cancelled', 'manager_rejected', 'hr_rejected'].includes(status)) return 'Exit Closed';
  if (FNF_STATUSES.includes(status)) return 'F&F Pending';

  const checklist = exit.clearance_checklist || {};
  const entries = Object.values(checklist);

  if (!entries.length) return 'Not Started';

  const fullyCleared = isChecklistFullyCleared(checklist);
  if (fullyCleared) {
    if (exit.no_dues_generated) return 'Clearance Completed';
    if (exit.declaration_signed_at) return 'HR Review Pending';
    return 'All Department Clearances Completed';
  }

  const anyActioned = entries.some(v => ['cleared', 'not_applicable', 'not_cleared'].includes(v.status));
  return anyActioned ? 'Partially Cleared' : 'Pending Clearances';
}

export const OVERALL_STATUS_COLORS = {
  'Not Started': 'bg-gray-100 text-gray-600',
  'Pending Clearances': 'bg-yellow-100 text-yellow-800',
  'Partially Cleared': 'bg-orange-100 text-orange-800',
  'All Department Clearances Completed': 'bg-blue-100 text-blue-800',
  'HR Review Pending': 'bg-purple-100 text-purple-800',
  'Clearance Completed': 'bg-teal-100 text-teal-800',
  'F&F Pending': 'bg-indigo-100 text-indigo-800',
  'Exit Closed': 'bg-green-100 text-green-800',
};
