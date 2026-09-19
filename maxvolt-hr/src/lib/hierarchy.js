// Resolves a manager's full downstream hierarchy (direct + indirect
// reports, recursively) from the Reporting Manager (reporting_manager_id)
// field already used everywhere in the app — no separate org-chart data
// structure to keep in sync, so this always reflects whatever's on the
// Employee records right now. If reporting lines change, this recomputes
// correctly on the next load with zero extra work.
//
// IMPORTANT — this rule differs by role:
//   - 'manager' may VIEW their whole downstream hierarchy, but must only
//     ever APPROVE their own direct reports' requests. Use downstreamIds
//     (or isDirectReport()) to decide what to show, but NEVER downstreamIds
//     to decide whether to show an Approve/Reject control for a manager.
//   - 'management' is scoped wider: they both VIEW and MAY APPROVE anywhere
//     in their own downstream hierarchy (direct + indirect reports) — this
//     is intentional, matching the backend's isManagementInHierarchy checks
//     (runLeaveAction / entities.js checkApprovalAuthorization / functions.js
//     processRegularisation). downstreamIds IS the correct gate for a
//     management user's Approve/Reject control.
// Either way, the backend independently enforces the same rule
// (checkApprovalAuthorization / runLeaveAction / processRegularisation), so
// this is belt-and-suspenders on the UI side, not the only line of defense.

// Builds a manager_user_id -> [direct report user_ids] adjacency map once,
// so resolving the downstream set for one manager is proportional to the
// hierarchy's size instead of re-scanning the full employee list at every
// recursion level.
function buildReportsIndex(employees) {
  const index = new Map();
  for (const e of employees) {
    if (!e.reporting_manager_id || !e.user_id) continue;
    if (!index.has(e.reporting_manager_id)) index.set(e.reporting_manager_id, []);
    index.get(e.reporting_manager_id).push(e.user_id);
  }
  return index;
}

// { directIds: Set<user_id>, downstreamIds: Set<user_id> } for a manager —
// downstreamIds includes everyone anywhere below them (direct AND
// indirect); directIds is the subset who report to them directly.
export function resolveHierarchy(managerUserId, employees) {
  const index = buildReportsIndex(employees);
  const directIds = new Set(index.get(managerUserId) || []);
  const downstreamIds = new Set();
  const queue = [...directIds];
  const visited = new Set(); // cycle guard — a corrupted reporting chain must never infinite-loop
  while (queue.length) {
    const uid = queue.shift();
    if (visited.has(uid)) continue;
    visited.add(uid);
    downstreamIds.add(uid);
    const reports = index.get(uid) || [];
    for (const r of reports) if (!visited.has(r)) queue.push(r);
  }
  return { directIds, downstreamIds };
}

// True only if employeeUserId reports DIRECTLY to managerUserId — the one
// question that's allowed to gate an Approve/Reject control.
export function isDirectReport(employeeUserId, managerUserId, employees) {
  const emp = employees.find(e => e.user_id === employeeUserId);
  return !!emp && emp.reporting_manager_id === managerUserId;
}
