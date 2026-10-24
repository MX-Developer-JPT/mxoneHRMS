# Intelligent MIS — audit, metric dictionary and data gaps

Code: `backend/utils/mis/` (`calendar.js`, `analytics.js`, `export.js`), API cases `getMisAnalytics`, `getMisRegister`, `exportMisIntelligence`, `setMisInsightStatus`, `getMisConfig`, `saveMisConfig` in `routes/functions.js`, page `maxvolt-hr/src/pages/MISIntelligence.jsx`. Tests: `node backend/tests/misAnalytics.test.mjs` (26 cases, no database needed).

## 1. Audit of the previous MIS (`utils/misReport.js`, still in place and working)

| Finding | Effect | Status |
|---|---|---|
| "Open requisitions" counted only status `open/approved/active`; every live requisition is `published` | Reported **0** open requisitions while 38 were open | Fixed in the old export too |
| "Present" included WFH and On-duty | Presence overstated (Sept: 1,385 OD days counted as present) | New engine keeps physical presence, WFH, OD, leave separate |
| Attendance rate = (present + ½ half) ÷ *marked* days, where marked included leave and excluded missing days | Missing records silently improved the rate | New: documented denominators, missing counted |
| No scheduled-day calendar (Sunday hard-coded, shifts/holidays-by-department ignored) | Wrong denominators for 6-day or custom shifts | New: shift working days + department holidays + joining/exit dates |
| Headcount = current active staff for every period | Opening/closing and exits not derivable | New: as-of-date headcount with reconciliation |
| Leave listed per request only; gate-pass durations not computed; no comparison, no exceptions | — | New modules |
| Duplicate attendance rows for one employee-day (17 in Sept) | Last-one-wins, not reported | Counted once, reported in Data Quality |

## 2. Metric dictionary (short form — full text is in the Excel "Definitions" sheet and PDF methodology)

* **Scheduled employee-day (ED)** — employee within employment dates, on a shift working day, not a department holiday, not attendance-exempt. Weekly offs/holidays never enter a denominator.
* **Categories (one per scheduled ED, they add up exactly):** present, late, short attendance, half-day, WFH, on-duty, leave, absent, missing record.
* **Physical presence rate** = (present + late + short + ½·half) ÷ scheduled ED. **Compliance rate** = (scheduled − absent − missing) ÷ scheduled ED. Leave/WFH/OD are never physical presence.
* **Missing** = scheduled day before today with no record (today is "pending"; future days are ignored). **Absent** = a record with status absent. **Unexplained absence** = absent with no approved leave covering the day.
* **Headcount** (as-of date d) = joined on/before d and last working day ≥ d. **Closing = Opening + Joinings − Exits.** An exit takes effect the day after the last working day. Company and every department reconcile (checked on every run).
* **Open vacancy** = approved positions − candidates joined, on published requisitions (never "requisitions − joinings").
* **Regularisation** counted by submission date; backlog is today's snapshot; "late" = raised > N days after the attendance date; SLA = N days pending.
* **Leave** requests counted by application date; leave days counted on scheduled days inside the period (½ for half-days).
* **No-leave-application cases** (30/60/90/180 days) are classified from attendance evidence: consistently present, WFH, OD, frequently regularised, attendance incomplete, absences without leave, new joiner, special arrangement, requires review. Never treated as good or bad.
* **Gate pass** open = approved/departed without return; overdue = past expected return or from an earlier day; duration only from real departure+return (auto-closed excluded).
* **Reimbursement:** claimed ≠ approved ≠ paid; approved-not-paid stays outstanding.
* **Comparison:** previous working day / week / month / quarter, same period last year, custom; a running period is compared with the same number of elapsed days; no % when the base is 0 or tiny (< 5).

All thresholds (absence/late/regularisation repeats, SLA days, ageing, outlier σ …) live in `DEFAULT_CFG` and can be overridden by HR/Admin (`saveMisConfig`).

## 3. History now captured (and what is still not stored)

Added 24 Oct 2026 — `backend/utils/mis/history.js`:

* **`DeptTransfer` records** — written automatically when an employee's department is edited (entities PATCH hook), by HR via *Record a transfer* (`recordDeptTransfer`), and by the nightly job for any other write path. Department history is walked back from the current department, so opening/closing headcount per department, joinings/exits and **Transfers in/out** are exact from the first record; `Closing = Opening + Joinings − Exits + In − Out` is checked per department and company.
* **`HeadcountSnapshot`** nightly at 12:30 AM IST (plus a catch-up 90 s after boot): who is in which department, open vacancies by department, offer pipeline, candidate stages. It supplies the *comparison* for open vacancies and offers, and detects department moves and candidate stage changes made outside the hooks. Preview without writing: `runMisSnapshot` with `dry_run`.
* **`JobRequisition.closed_date / closed_reason`** (`filled` when joined ≥ positions, else `closed`) and **`Candidate.status_history`** — recorded on every status change. They drive **time to fill, time to hire, time to offer** and period stage movements. Existing closed requisitions have no closure date and are excluded rather than guessed.

Everything reports its **tracked-since date** and sample size. Before tracking began, values stay "n/a", never 0. Still not stored: sanctioned / budgeted positions, reporting-manager history, a leave-deduction ledger.

## 4. Data-quality findings from live data (24 Oct 2026)

Duplicate employee codes (2), 17 duplicate attendance rows, ~149 scheduled days with no attendance record in September, 16 leave/attendance conflicts, 6 candidates linked to a missing requisition, employees with no status (onboarding records counted as active and shown absent), and a lowercase "unassigned" department spelling (now normalised to *Unassigned*). Full list: *Intelligent MIS → Data quality*.

## 5. Access control

HR / Admin / Management: everything, exports, insight status. Managers: their downstream team only (attendance, regularisation, leave, gate pass); no visitors, reimbursements, recruitment or data-quality; no export. Enforced server-side; internal record types `MisConfig` / `MisInsightState` are blocked from the generic entities API. Exports are written to the server log.
