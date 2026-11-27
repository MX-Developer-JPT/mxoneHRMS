// Who may see candidate records: HR, admin and recruiters see all of them; a Hiring Manager sees the candidates of the
// requisitions that name them. Nobody else — management and department heads get numbers, not people.
import { requisitionOf } from './hiringLifecycle.js';

export const CANDIDATE_ROLES = ['hr', 'admin', 'recruiter'];
/** Record types that hold candidate information. */
export const CANDIDATE_TYPES = new Set(['Candidate', 'ParsedResume', 'CandidateScore', 'Interview', 'CandidateReminder']);
export const HIDDEN_NAME = 'Name hidden';
export const hasFullCandidateAccess = (roles) => (roles || []).some((r) => CANDIDATE_ROLES.includes(r));

const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** What this user may see: { all, reqIds, candidateIds, parsedIds, can(type, record) }. */
export async function candidateAccess(userId, db) {
  const { one, all } = db || (await import('../db.js'));
  const u = userId ? await one('SELECT role, custom_role FROM users WHERE id=$1', [userId]) : null;
  const full = hasFullCandidateAccess([u?.role, u?.custom_role]);
  const reqIds = new Set(), candidateIds = new Set(), parsedIds = new Set();
  if (!full && u) {
    for (const r of await all("SELECT id FROM entities WHERE type='JobRequisition' AND data::jsonb->>'hiring_manager_id'=$1", [userId])) reqIds.add(r.id);
    if (reqIds.size) {
      for (const r of await all("SELECT id, data FROM entities WHERE type='Candidate'")) {
        const c = jparse(r.data);
        if (c && reqIds.has(requisitionOf(c))) { candidateIds.add(r.id); if (c.parsed_resume_id) parsedIds.add(c.parsed_resume_id); }
      }
    }
  }
  const can = (type, d) => {
    if (full) return true;
    if (!d) return false;
    if (type === 'Candidate') return candidateIds.has(d.id) || reqIds.has(requisitionOf(d));
    if (type === 'ParsedResume') return parsedIds.has(d.id) || candidateIds.has(d.candidate_id);
    return candidateIds.has(d.candidate_id);
  };
  return { all: full, reqIds, candidateIds, parsedIds, can };
}

/** Audit entries name the person who joined; viewers without candidate access get the fact without the name. */
export const maskAudit = (audit) => (audit || []).map((a) => (a.action === 'candidate_joined' ? { ...a, detail: String(a.detail || '').replace(/^[\s\S]*? joined/, 'A candidate joined') } : a));

/** A copy of a candidate with everything that identifies the person removed, for reports shown to others. */
export const anonymousCandidate = (c) => ({ ...c, full_name: HIDDEN_NAME, name: HIDDEN_NAME, first_name: '', last_name: '', email: '', phone: '', current_company: '', referred_by_name: c.referred_by_name });
