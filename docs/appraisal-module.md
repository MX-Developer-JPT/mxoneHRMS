# Performance Management & Appraisal module

Built inside Maxvolt One (page **Appraisal**, nav entry under *Performance* / *Career & Learning*). Nothing is pre-loaded: the
*Mid-Year Performance Review 2026–27* cycle, KPI templates, rating scale and bands are all created / edited through the UI.

## What was reused vs new
| Reused | New |
|---|---|
| Users/roles, `Employee.reporting_manager_id` hierarchy, `notifications` table + push, `TrainingProgram` entities (dev plans link to them), exceljs / `renderPdf`, JSON-entity storage, `functions.js` prefix dispatch, cron in `server.js` | `backend/routes/appraisal.js` (`ap_*` functions), `backend/utils/appraisal.js` (pure scoring/status/eligibility rules), `backend/utils/appraisalExport.js`, entities `ApSettings / ApCycle / ApTemplate / ApReview / ApMeeting / ApGoal / ApDevPlan / ApAudit / ApNotify` (all in `PRIVATE_TYPES`: the generic entity API cannot touch them), `pages/Appraisal.jsx`, `components/appraisal/*` |

The old *Performance* / *PMS Settings* / *PIP* pages are untouched.

## Data model (one `ApReview` per employee per cycle)
`assignment` (copy of the template used + history of every replaced set) · `self` / `self_versions` · `mgr` / `mgr_versions`
(confidential note lives here, never serialised to the employee or senior managers) · `meeting_status` · `hr` (decision log) ·
`scores` {self, manager, original_manager, hr_adjusted, final, band, gaps} · `adjustments` (every HR change with reason) · `flags`
(late_self, reopened, returned, no_manager…). **Status is derived** from the self / manager / meeting / HR tracks — nobody types it in.

## Scoring (all server-side, recomputed from stored ratings)
`weighted = rating × weight ÷ highest rating on the scale`; KPI weights must total exactly 100; incomplete evaluations never produce a final
score; optional KPI/competency split (e.g. 80/20); decimals, scale and bands are settings; a published cycle snapshots them.
Self, manager and HR-adjusted scores are stored separately; `original_manager` is never overwritten. Worked example in the brief = **77 → Meets Expectations** (tested).

## Permission matrix (enforced on the server)
| Action | Employee | Reporting manager | Senior manager (indirect) | HR / admin |
|---|---|---|---|---|
| View own review | ✔ (manager score & final only after publish) | – | – | ✔ |
| View a report's review | ✘ | ✔ (incl. confidential note) | ✔ read-only, no confidential note | ✔ |
| Self-assessment save/submit | own only | ✘ | ✘ | reopen / waive |
| Manager evaluation save/submit | ✘ | direct reports only | ✘ | ✘ (return/reopen only) |
| Change employee KPIs | ✘ | direct reports, reason required | ✘ | ✔ |
| Schedule / complete meeting | ✘ (acknowledge only) | ✔ | ✘ | ✔ |
| Goals | add/report own progress | add/verify | read | ✔ |
| Dev plans | read own (if shared) | create/update for reports | read | ✔ |
| Cycles, templates, settings | ✘ | ✘ | ✘ | ✔ |
| Calibrate, approve, return, publish, close/reopen | ✘ | ✘ | ✘ | ✔ (reason where it matters) |
| Analytics, audit log, most reports | ✘ | team-scoped reports | team-scoped | ✔ |

## API (`POST /api/functions/<name>`)
Settings `ap_get_settings ap_save_settings ap_get_forms` · Cycles `ap_list_cycles ap_save_cycle ap_duplicate_cycle ap_eligible_preview ap_set_cycle_status ap_cycle_employees ap_cycle_roster` ·
Templates `ap_list_templates ap_save_template ap_delete_template ap_assign_template ap_set_employee_kpis ap_import_assignments` ·
Reviews `ap_my_reviews ap_get_review ap_team_reviews ap_save_self ap_submit_self ap_reopen_self ap_waive_self ap_save_manager_eval ap_submit_manager_eval` ·
Meetings `ap_save_meeting ap_complete_meeting ap_ack_meeting` · HR `ap_calibration ap_hr_adjust ap_hr_decide ap_publish_results ap_ack_result ap_reassign_manager ap_exclude_review` ·
Goals `ap_list_goals ap_save_goal ap_update_goal_progress` · Dev plans `ap_save_dev_plan ap_list_dev_plans` · Insight `ap_dashboard ap_analytics ap_audit_log ap_export ap_send_reminders`.

## Edge cases handled
Late self-submission → accepted, flagged, audited · employee without manager → flagged, HR can reassign · manager change mid-cycle (`ap_reassign_manager`) ·
employee removed / added mid-cycle (reason) · reopen self-assessment keeps the old version · HR return/reopen keeps manager versions ·
template edits never change appraisals in progress (each review holds a copy; custom KPIs are never silently replaced) ·
missing manager evaluation blocks approval · meeting required before approval (HR may override with a reason) · incomplete ratings blocked ·
closed cycle is frozen until reopened with a reason · duplicate reminders suppressed (`ApNotify` key) · dev-plan duplicates blocked · CSV export is formula-injection safe.

## Tests
`node backend/tests/appraisal.test.mjs` — 12 pure-rule checks (scoring, bands, scale, weights, IST deadlines, eligibility, hierarchy).
The 17-check end-to-end suite (workflow, permissions, calculation, versioning, audit, exports, reminders, entity-API lockout) ran against a PGlite copy of the backend; it is not committed because it needs that throw-away database harness.

## Known limitations
* Evidence upload is link-based (URLs / names) — not file upload to the bucket.
* Email notifications are not sent; in-app + push only (the module uses the existing notification path).
* A cycle's "eligible employees" are snapshotted at publish; later joiners are added via *Cycles → Employees*.
* Excel import of per-employee **targets** is not built; template import/export and `ap_import_assignments` (employee→template) exist.
* The UI was smoke-tested in a browser (renders with real data, no console errors); the full click-through of every form was verified through the API test suite rather than by hand.
