// Gate pass rules shared by the generic entity API, the gate pass functions and the automation. Pure — no database.
//
// Inter-office travel ("Travelling to Another Office" with a destination) moves:
//   pending_approval -> approved -> departed (Gate-Out; shown as "In Transit") -> completed (Gate-In at the destination)
// and can be cancelled before arrival by an authorised person. Gate-Out and Gate-In happen only through the gp_* functions.
export const TRAVEL = 'travelling_to_another_office';
export const isTravel = (p) => p?.outing_type === TRAVEL && !!p?.destination_location;
export const ACTIVE_TRAVEL = ['pending_approval', 'approved', 'departed'];

export const istNow = (ms = Date.now()) => new Date(ms + 5.5 * 3600 * 1000).toISOString();   // India wall-clock, the app's storage format

export const passNo = (p) => p?.pass_no || `GP-${String(p?.request_date || '').replace(/-/g, '').slice(2) || '000000'}-${String(p?.id || '').replace(/-/g, '').slice(0, 5).toUpperCase()}`;

// One line of the append-only history kept on the pass.
export const historyEntry = ({ action, from, to, actor, office, remarks, at }) => ({
  at: at || istNow(), action, from_status: from ?? null, to_status: to ?? null,
  by_id: actor?.id || null, by_name: actor?.name || 'System', by_code: actor?.code || '', by_role: actor?.role || '',
  ...(office ? { office } : {}), ...(remarks ? { remarks: String(remarks).slice(0, 500) } : {}),
});
export const withHistory = (pass, ...entries) => ({ ...pass, history: [...(Array.isArray(pass.history) ? pass.history : []), ...entries] });

// Written only by the server, on any pass.
export const SYSTEM_FIELDS = ['history', 'pass_no', 'departed_by_id', 'departed_by_code', 'arrival_time', 'arrived_by_id', 'arrived_by_name', 'arrived_by_code', 'arrival_remarks', 'travel_outcome', 'closed_at', 'closed_by_name', 'close_reason', 'overdue_notified_at', 'destination_changes'];
// Fixed once the request is raised.
export const FIXED_FIELDS = ['outing_type', 'employee_user_id', 'user_id', 'current_location', 'destination_location', 'request_date', 'requested_at'];
const GATE_FIELDS = ['departure_time', 'return_time', 'departed_by_name', 'returned_by_name', 'auto_closed', 'auto_closed_reason'];

// Applied to a PATCH from the generic entity API. Removes fields the client may not write (mutates `patch`) and returns an
// error message when the requested status change is not allowed there.
export function guardPatch(current, patch) {
  for (const f of [...SYSTEM_FIELDS, ...FIXED_FIELDS]) delete patch[f];
  const to = patch.status;
  if (to === current.status) delete patch.status;
  const changing = patch.status && patch.status !== current.status;
  if (changing && patch.status === 'completed') return 'A gate pass is completed only when the destination Gate Admin confirms arrival.';
  if (isTravel(current)) {
    for (const f of GATE_FIELDS) delete patch[f];
    if (changing && !(current.status === 'pending_approval' && ['approved', 'rejected', 'cancelled'].includes(patch.status))) {
      return 'Inter-office travel is updated from the gate screen (Gate-Out / Gate-In) or by changing or cancelling the trip.';
    }
  }
  return null;
}

// Gate-Out / Gate-In times always come from the server clock, whatever the client sent.
export function stampTimes(patch, current, now = istNow()) {
  if (patch.status === 'departed' && current.status !== 'departed') patch.departure_time = now; else delete patch.departure_time;
  if (patch.status === 'returned' && current.status !== 'returned') patch.return_time = now; else delete patch.return_time;
}

// assigned: null = never configured (may operate every office), else the office names.
export const worksAt = (assigned, office) => assigned === null || (Array.isArray(assigned) && assigned.includes(office));

// Who is told about movements towards an office: the gate admins assigned to it; only if nobody is, the unassigned ones.
export function officeGateAdmins(admins, office) {
  const named = admins.filter((a) => Array.isArray(a.locations) && a.locations.includes(office));
  return (named.length ? named : admins.filter((a) => a.locations === null)).map((a) => a.id);
}

// What this viewer may do with this pass. viewer: { id, role, assigned, manages(userId) }
export function permissions(pass, viewer) {
  const own = pass.employee_user_id === viewer.id;
  const hr = ['hr', 'admin'].includes(viewer.role);
  const approver = hr || viewer.manages === true;
  const gate = viewer.role === 'gate_admin' && !own;   // nobody confirms their own movement
  const travel = isTravel(pass);
  const st = pass.status;
  return {
    approve: st === 'pending_approval' && approver && (!own || hr),
    cancel_request: st === 'pending_approval' && (own || approver),
    gate_out: st === 'approved' && (travel ? gate && worksAt(viewer.assigned, pass.current_location) : (hr || (viewer.role === 'gate_admin' && (!pass.current_location || worksAt(viewer.assigned, pass.current_location))))),
    gate_in: !travel && st === 'departed' && (hr || (viewer.role === 'gate_admin' && (!pass.current_location || worksAt(viewer.assigned, pass.current_location)))),
    arrive: travel && st === 'departed' && gate && worksAt(viewer.assigned, pass.destination_location),
    change_destination: travel && ['approved', 'departed'].includes(st) && approver && (!own || hr),
    cancel_trip: travel && ((st === 'approved' && (own || approver)) || (st === 'departed' && approver && (!own || hr))),
  };
}

// Display stage used by every screen (and the wording on All Attendance).
export function stageOf(p) {
  if (p.status === 'departed') return isTravel(p) ? 'in_transit' : 'outside';
  return p.status;
}
export function travelLabel(p) {
  if (!isTravel(p)) return '';
  if (p.status === 'departed') return `Travelling to ${p.destination_location}`;
  if (p.status === 'completed') return `Arrived at ${p.destination_location}`;
  if (p.status === 'cancelled' && p.departure_time) return `Travel to ${p.destination_location} not completed — review`;
  if (p.status === 'approved') return `Approved to travel to ${p.destination_location}`;
  return '';
}

// The rows All Attendance shows for one date: that day's passes, plus travel that was still open on it or arrived on it.
export function passesForDate(passes, date, today) {
  return passes.filter((p) => {
    if (!['approved', 'departed', 'returned', 'auto_closed', 'completed'].includes(p.status) && !(p.status === 'cancelled' && p.departure_time)) return false;
    if (p.request_date === date) return true;
    if (!isTravel(p) || !p.request_date || p.request_date > date) return false;
    return (p.status === 'departed' && date <= today) || String(p.arrival_time || '').slice(0, 10) === date;
  });
}
