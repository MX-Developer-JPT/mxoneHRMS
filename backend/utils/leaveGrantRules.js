// Automatic CL, SL and EL credits (these three are not part of the monthly total/12 accrual).
//   • CL: +1 day for every 20 working days, at most 7 a year — confirmed employees, not interns
//   • CL for interns: 1 day for every calendar month (no working-day condition)
//   • SL: +1 day for every 20 working days, at most 7 a year — Manager tier and above (Territory Managers included)
//   • EL: +1 day for every 20 working days — only after probation is completed
// Counting starts on 1 October 2026 (or the joining date if later). A "working day" is any day the
// employee was on paid status: present / on duty / WFH / leave / holiday / weekly off count; absent,
// LOP and short-attendance days do not; a half-day with no leave behind it counts 0.5 (same rule as payroll).
// Per-employee progress is kept in a LeaveGrantState entity so the job is catch-up safe and idempotent.
// When the rules change (RULES_VERSION), CL and SL are recounted from the start date once and only a shortfall is
// credited: days already given are never taken back.
// The rules themselves (pure, no database); cron/leaveGrantAutomation.js applies them.
export const GRANT_START_DATE = '2026-10-01';
export const RULES_VERSION = 2;
export const SL_TIERS = ['manager', 'territory_manager', 'general_manager', 'director'];
export const GRANT_RULES = {
  CL: { every: 20, grant: 1, needsConfirmation: true, noInterns: true, yearCap: 7 },
  SL: { every: 20, grant: 1, tiers: SL_TIERS, yearCap: 7 },
  EL: { every: 20, grant: 1, needsConfirmation: true },
};
export const isIntern = (emp) => emp?.employment_type === 'intern' || emp?.designation_tier === 'intern' || /\bintern\b/i.test(emp?.designation || '');
export const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

const NOT_PAID = new Set(['absent', 'lop', 'short_attendance']);
// 1 = full working day, 0.5 = partial, 0 = not counted
export function dayCredit(rec) {
  if (!rec) return 1; // no row = scheduled off-day / holiday (nightly job marks missed working days absent)
  const s = rec.status;
  if (NOT_PAID.has(s)) return 0;
  if (s === 'half_day' && !rec.leave_id) return 0.5;
  return 1;
}

export function isOnProbation(emp, ds) {
  const confDate = emp.employee_confirmation_date || emp.confirmation_date || '';
  const probationNow = emp.employee_status === 'probation' || (!emp.employee_status && !confDate);
  if (probationNow) return true;
  return !!confDate && ds < String(confDate).slice(0, 10);
}

// Stricter than isOnProbation (which also treats a blank status as probation for accrual): applying for EL is
// blocked only for an employee explicitly on probation, or whose confirmation date has not arrived yet.
export function elBlockedByProbation(emp, ds) {
  const confDate = String(emp?.employee_confirmation_date || emp?.confirmation_date || '').slice(0, 10);
  return emp?.employee_status === 'probation' || (!!confDate && ds < confDate);
}

// Walks the days from..to for the given leave codes, moving the counters in `state` and returning what became due.
// `byDate` maps a date to that day's attendance rows. Pure: no database.
export function accrue({ emp, byDate, state, from, to, codes, policies }) {
  const due = [];
  for (let ds = from; ds <= to; ds = addDays(ds, 1)) {
    const rows = byDate[ds] || [];
    const credit = rows.length ? Math.max(...rows.map(dayCredit)) : 1;
    if (credit <= 0) continue;
    for (const code of codes) {
      const rule = GRANT_RULES[code];
      if (!policies[code]) continue;
      if (rule.noInterns && isIntern(emp)) continue;
      if (rule.tiers && !rule.tiers.includes(emp.designation_tier)) continue;
      if (rule.needsConfirmation && isOnProbation(emp, ds)) continue;
      state.counters[code] = (state.counters[code] || 0) + credit;
      while (state.counters[code] >= rule.every) {
        state.counters[code] -= rule.every;
        const year = Number(ds.slice(0, 4));
        const used = (state.grants_by_year[year] ||= {});
        const cap = rule.yearCap ?? (policies[code].total_days || Infinity);
        if ((used[code] || 0) + rule.grant > cap) continue; // annual cap reached
        used[code] = (used[code] || 0) + rule.grant;
        state.log.push({ date: ds, code, days: rule.grant });
        due.push({ code, year, days: rule.grant, why: `completing ${rule.every} working days` });
      }
    }
  }
  return due;
}

const monthsBetween = (from, to) => {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  return out;
};

// One employee's step: mutates `state` and returns the credits to apply. Pure: no database.
export function planGrants({ emp, byDate, state, upTo, today, policies }) {
  const doj = emp.date_of_joining ? String(emp.date_of_joining).slice(0, 10) : '';
  const begin = doj && doj > GRANT_START_DATE ? doj : GRANT_START_DATE;
  const due = [];

  if (state.rules_version !== RULES_VERSION) {
    // recount the changed codes over the days already processed and top up what the new rules owe
    const replay = { counters: {}, grants_by_year: {}, log: [] };
    accrue({ emp, byDate, state: replay, from: begin, to: state.last_processed, codes: ['CL', 'SL'], policies });
    for (const code of ['CL', 'SL']) {
      state.counters[code] = replay.counters[code] || 0;
      for (const [year, g] of Object.entries(replay.grants_by_year)) {
        const used = (state.grants_by_year[year] ||= {});
        const short = (g[code] || 0) - (used[code] || 0);
        if (short <= 0) continue;
        used[code] = g[code];
        state.log.push({ date: today, code, days: short, note: 'rule change top-up' });
        due.push({ code, year: Number(year), days: short, why: 'the updated leave rules (from 1 October 2026)' });
      }
    }
    // CL an intern already received under the old rule counts against their first months
    if (isIntern(emp) && !state.intern_months) {
      const already = Math.floor(state.grants_by_year[GRANT_START_DATE.slice(0, 4)]?.CL || 0);
      state.intern_months = monthsBetween(begin, today).slice(0, already);
    }
    state.rules_version = RULES_VERSION;
  }

  if (state.last_processed < upTo) {
    const next = addDays(state.last_processed, 1);
    due.push(...accrue({ emp, byDate, state, from: next > begin ? next : begin, to: upTo, codes: Object.keys(GRANT_RULES), policies }));
    state.last_processed = upTo;
  }

  if (isIntern(emp) && policies.CL && begin <= today) {
    const done = (state.intern_months ||= []);
    for (const month of monthsBetween(begin, today)) {
      if (done.includes(month)) continue;
      done.push(month);
      const year = Number(month.slice(0, 4));
      const used = (state.grants_by_year[year] ||= {});
      used.CL = (used.CL || 0) + 1;
      state.log.push({ date: today, code: 'CL', days: 1, month });
      due.push({ code: 'CL', year, days: 1, why: `the intern's monthly leave (${month})` });
    }
  }
  return due;
}
