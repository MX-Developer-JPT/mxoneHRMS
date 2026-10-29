// L&D test cycle — pure helpers (no database). A test cycle is a normal induction (plus a training assignment) that belongs to
// the L&D admin who started it, is flagged `is_test`, and runs with every timed step shortened to 30 seconds so the whole
// journey can be walked through in one sitting. Test data never reaches KPIs, registers or other people (see routes/ld.js).
// Unit-tested in backend/tests/ldTest.test.mjs.

export const TEST_SECONDS = 30;

const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

// Every timed task (website tour, course / product study, org-chart reading, policy reading) becomes 30 seconds; every step is open from
// today and due a week from today, so nothing waits for a calendar date or turns overdue mid-test.
export function applyTestTiming(ind, today) {
  ind.is_test = true;
  ind.test_seconds = TEST_SECONDS;
  ind.anchor_date = today;
  for (const g of ind.gates) {
    g.available_from = today;
    g.due_date = addDays(today, 7);
    for (const t of g.tasks || []) {
      if (t.target_seconds) t.target_seconds = TEST_SECONDS;
      if (t.type === 'policy_ack' || t.min_read_seconds) t.min_read_seconds = TEST_SECONDS;
    }
    g.test_timed = true;
  }
  return ind;
}

// A test induction has no real people around it: the tester is the learner AND every owner (manager, HOD, trainer, buddy, HR SPOC), so
// nobody else is notified and no real manager / HOD is attached.
export function isolateTestPeople(ind, testerId, testerName) {
  ind.employee = { ...ind.employee, reporting_manager_id: null, reporting_manager_name: '' };
  ind.hod_user_id = null; ind.hod_name = '';
  ind.hr_spoc_user_id = testerId;
  ind.buddy_user_id = testerId; ind.buddy_name = testerName || '';
  ind.trainer_user_id = testerId; ind.trainer_name = testerName || '';
  ind.pause_exempt = true;            // the test keeps running while HR has induction training paused
  return ind;
}

// Seconds the tester still has to wait before a test training assignment can be marked complete.
export function testWaitLeft(assignment, nowMs = Date.now()) {
  if (!assignment?.started_at) return TEST_SECONDS;
  return Math.max(0, Math.ceil(TEST_SECONDS - (nowMs - Date.parse(assignment.started_at)) / 1000));
}

// The entity types a test cycle can create. All of them are removed by "End test cycle".
export const TEST_TYPES = ['LdInduction', 'LdAttempt', 'LdPolicyAck', 'LdCertificate', 'LdAssignment', 'LdCourse', 'LdOrgQuiz', 'LdProductQuiz', 'LdCourseQuiz', 'LdWaiver', 'LdFeedback'];
