// CV screening engine — pure and deterministic. The score is COMPUTED here from the candidate's CV and the requisition's criteria, so the
// same candidate always gets the same number and every point can be explained. The AI is used only to read messy CVs (parsing) and to
// write the narrative; it never decides the score.
//
//   buildCriteria(requisition, experienceMasters)   what the role asks for (must-have / nice-to-have skills, experience, CTC, location…)
//   analyseResumeText(text)                         facts read straight from the CV text: contacts, experience from dates, degrees
//   scoreAgainst(criteria, candidate)               weighted component scores, knockouts, recommendation, explanation

export const DEFAULT_WEIGHTS = { skills: 35, experience: 25, salary: 10, notice: 8, education: 12, location: 5, industry: 5 };
export const COMPONENT_LABELS = { skills: 'Skills match', experience: 'Experience', salary: 'Salary fit', notice: 'Notice period', education: 'Education', location: 'Location', industry: 'Industry' };

// ── skills ──
const ALIASES = {
  js: 'javascript', 'java script': 'javascript', node: 'nodejs', 'node js': 'nodejs', 'node.js': 'nodejs', reactjs: 'react', 'react js': 'react', 'react.js': 'react', vuejs: 'vue', 'vue js': 'vue', angularjs: 'angular',
  'ms excel': 'excel', 'microsoft excel': 'excel', 'advanced excel': 'excel', 'ms office': 'microsoft office', 'ms word': 'microsoft word', 'ms powerpoint': 'powerpoint', 'power point': 'powerpoint',
  'sap erp': 'sap', 'sap fico': 'sap', 'sap mm': 'sap', 'tally erp': 'tally', 'tally prime': 'tally', 'tally erp 9': 'tally', postgres: 'postgresql', mongo: 'mongodb', 'ci/cd': 'cicd', 'ci cd': 'cicd',
  'machine learning': 'machine learning', ml: 'machine learning', ai: 'artificial intelligence', py: 'python', 'rest api': 'rest apis', 'restful apis': 'rest apis', 'rest apis': 'rest apis', 'api integration': 'rest apis',
  'b2b': 'b2b sales', 'lead gen': 'lead generation', 'client acquisition': 'client acquisition', crm: 'crm', 'gst filing': 'gst', 'gst returns': 'gst', tds: 'tds', 'auto cad': 'autocad', 'solid works': 'solidworks',
  bms: 'battery management system', 'battery management systems': 'battery management system', 'li-ion': 'lithium ion', 'li ion': 'lithium ion', 'lithium-ion': 'lithium ion', plc: 'plc', 'six sigma': 'six sigma', '6 sigma': 'six sigma', '5s': '5s', 'lean manufacturing': 'lean',
};
export function normSkill(s) {
  let t = String(s || '').toLowerCase().replace(/[()\[\]{}"“”‘’]/g, ' ').replace(/[^a-z0-9+#./& -]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\.js$/, 'js').replace(/\bjs$/, ' js').replace(/\s+/g, ' ').trim();
  if (ALIASES[t]) return ALIASES[t];
  const compact = t.replace(/[.\s-]/g, '');
  for (const [k, v] of Object.entries(ALIASES)) if (k.replace(/[.\s-]/g, '') === compact) return v;
  return t;
}
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textHas = (textNorm, skill) => {
  if (!skill || skill.length < 2) return false;
  const re = new RegExp(`(^|[^a-z0-9+#])${esc(skill)}($|[^a-z0-9+#])`, 'i');
  return re.test(textNorm);
};
/** Credit for each required skill: 1 listed, .9 close match, .75 mentioned in the CV text, 0 absent. */
export function matchSkills(required, candidateSkills, resumeText = '') {
  const have = (candidateSkills || []).map(normSkill).filter(Boolean);
  const haveSet = new Set(have);
  const textNorm = ` ${String(resumeText || '').toLowerCase().replace(/[^a-z0-9+#./& -]/g, ' ').replace(/\s+/g, ' ')} `;
  const rows = [];
  for (const raw of required || []) {
    const r = normSkill(raw); if (!r) continue;
    let credit = 0; let how = 'absent';
    if (haveSet.has(r)) { credit = 1; how = 'listed'; }
    else if (have.some((h) => h.length >= 3 && r.length >= 3 && (h.includes(r) || r.includes(h)))) { credit = 0.9; how = 'close'; }
    else if (textHas(textNorm, r) || textHas(textNorm, String(raw).toLowerCase())) { credit = 0.75; how = 'mentioned'; }
    else if (r.includes(' ')) { const toks = r.split(' ').filter((t) => t.length > 2); if (toks.length >= 2 && toks.every((t) => textHas(textNorm, t))) { credit = 0.5; how = 'partial'; } }
    rows.push({ skill: String(raw).trim(), credit, how });
  }
  return rows;
}

// ── facts straight from the CV text ──
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const DATE = '(?:(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[a-z]*[\\s.,\'-]*(\\d{4}|\\d{2})|(\\d{1,2})[/.-](\\d{4})|(\\d{4}))';
const RANGE = new RegExp(`${DATE}\\s*(?:-|–|—|to|till|until)\\s*(?:${DATE}|(present|current|till date|till now|date|now|ongoing|today))`, 'gi');
const monthIndex = (y, m) => y * 12 + (m - 1);
/** Total years of work experience from date ranges ("Jan 2019 – Present"), overlaps counted once. Returns null when no range is found. */
export function experienceFromDates(text, now = new Date()) {
  const t = String(text || '');
  const spans = []; let m;
  RANGE.lastIndex = 0;
  while ((m = RANGE.exec(t))) {
    const yv = (y) => { let n = Number(y); if (n < 100) n += n > 50 ? 1900 : 2000; return n; };
    const mo = (name) => MONTHS[String(name).toLowerCase().slice(0, 4)] || MONTHS[String(name).toLowerCase().slice(0, 3)] || 1;
    // groups: 1 month, 2 year | 3 mm, 4 yyyy | 5 yyyy  (start);  6-10 the same for the end;  11 "present"
    const start = m[1] ? monthIndex(yv(m[2]), mo(m[1])) : m[3] ? monthIndex(Number(m[4]), Number(m[3])) : monthIndex(Number(m[5]), 1);
    let end;
    if (m[11]) end = monthIndex(now.getFullYear(), now.getMonth() + 1);
    else if (m[6]) end = monthIndex(yv(m[7]), mo(m[6]));
    else if (m[8]) end = monthIndex(Number(m[9]), Number(m[8]));
    else if (m[10]) end = monthIndex(Number(m[10]), 1);
    else continue;
    const nowIdx = monthIndex(now.getFullYear(), now.getMonth() + 1);
    if (start < 1990 * 12 || end < start || end > nowIdx + 1 || end - start > 45 * 12) continue;    // study ranges / typos / future dates are ignored
    spans.push([start, Math.min(end, nowIdx) + (m[10] ? 0 : 1)]);     // a month-precise end counts that month; a bare year ends at the year boundary
  }
  if (!spans.length) return null;
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0; let [cs, ce] = spans[0];
  for (const [s, e] of spans.slice(1)) { if (s <= ce) ce = Math.max(ce, e); else { total += ce - cs; cs = s; ce = e; } }
  total += ce - cs;
  return Math.round((total / 12) * 10) / 10;
}
const DEGREES = [
  ['phd', /\b(ph\.?d|doctorate)\b/i, 6], ['master', /\b(m\.?tech|m\.?e\.?|mba|pgdm|m\.?sc|m\.?com|mca|m\.?a\.?|post.?graduate|master'?s?)\b/i, 5], ['ca', /\b(chartered accountant|c\.?a\.?|cma|icwa|cs)\b/i, 5],
  ['bachelor', /\b(b\.?tech|b\.?e\.?|bba|b\.?sc|b\.?com|bca|b\.?a\.?|graduate|bachelor'?s?)\b/i, 4], ['diploma', /\b(diploma|polytechnic)\b/i, 3], ['iti', /\b(iti|vocational)\b/i, 2], ['school', /\b(12th|hsc|intermediate|10th|ssc)\b/i, 1],
];
export function highestDegree(text) {
  let best = null;
  for (const [key, re, rank] of DEGREES) if (re.test(String(text || ''))) { if (!best || rank > best.rank) best = { key, rank }; }
  return best;
}
export function extractContacts(text) {
  const t = String(text || '');
  const email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || '';
  const phone = (t.replace(/[\s()-]/g, '').match(/(?:\+?91|0)?([6-9]\d{9})/) || [])[1] || '';
  const linkedin = (t.match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/[^\s)]+/i) || [])[0] || '';
  const github = (t.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i) || [])[0] || '';
  return { email: email.toLowerCase(), phone, linkedin, github };
}
/** Everything that can be read from the CV text without an AI. */
export function analyseResumeText(text, { skills = [] } = {}) {
  const t = String(text || '');
  const matched = matchSkills(skills, [], t).filter((x) => x.credit > 0).map((x) => x.skill);
  return { chars: t.length, experience_years: experienceFromDates(t), degree: highestDegree(t), contacts: extractContacts(t), skills_in_text: matched, looks_scanned: t.length > 0 && t.length < 200 };
}

// ── requisition criteria ──
const toArr = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map((x) => String(x).trim()).filter(Boolean);
export function parseExperienceText(txt) {
  const t = String(txt || '').toLowerCase();
  if (!t) return { min: null, max: null };
  if (/fresher/.test(t) && !/\d/.test(t)) return { min: 0, max: 1 };
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/); if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = t.match(/(\d+(?:\.\d+)?)\s*\+|(?:above|over|more than|minimum|min\.?|at least)\s*(\d+(?:\.\d+)?)/); if (m) return { min: Number(m[1] || m[2]), max: null };
  m = t.match(/(\d+(?:\.\d+)?)/); if (m) return { min: Number(m[1]), max: null };
  return { min: null, max: null };
}
/** What the role asks for. Works for new manpower requisitions (structured fields) and older ones (text fields). */
export function buildCriteria(jd, expMasters = []) {
  const j = jd || {};
  const lookup = (v) => (expMasters || []).find((m) => m.value === v)?.meta;
  let min = null, max = null;
  if (j.mrf_version === 2 && (j.exp_min || j.exp_max)) {
    const lo = lookup(j.exp_min), hi = lookup(j.exp_max || j.exp_min);
    min = lo ? lo.min : null; max = hi ? (hi.max >= 99 ? null : hi.max) : null;
  } else { const e = parseExperienceText(j.experience_required); min = e.min; max = e.max; }
  const annual = (n) => (n == null || n === '' ? null : (j.ctc_frequency === 'monthly' ? Number(n) * 12 : Number(n)));
  const ctcMin = j.mrf_version === 2 ? annual(j.ctc_min) : (Number(j.salary_range_min) || null);
  const ctcMax = j.mrf_version === 2 ? annual(j.ctc_max) : (Number(j.salary_range_max) || null);
  const must = [...toArr(j.required_skills), ...toArr(j.technical_skills)];
  const mustUniq = must.filter((x, i) => must.findIndex((y) => normSkill(y) === normSkill(x)) === i);
  return {
    title: j.position_title || j.designation || '', department: j.department || '',
    mustSkills: mustUniq, niceSkills: toArr(j.preferred_skills).filter((x) => !mustUniq.some((y) => normSkill(y) === normSkill(x))),
    minYears: min, maxYears: max, ctcMin: ctcMin || null, ctcMax: ctcMax || null,
    qualifications: toArr(j.qualification), industries: toArr(j.industry_experience),
    location: [j.work_location, j.work_city, j.location].filter(Boolean).join(' ').toLowerCase(), remote: j.work_arrangement === 'remote' || j.is_remote === true,
    weights: { ...DEFAULT_WEIGHTS, ...(j.screening_weights || {}) }, knockouts: { mustSkillShare: 0.5, minExperienceGap: 0.4, ctcOverShare: 0.3, noticeDays: 90, ...(j.screening_knockouts || {}) },
  };
}

// ── candidate side ──
export const noticeToDays = (v) => {
  const t = String(v ?? '').toLowerCase().trim(); if (!t) return null;
  if (/immediate|serving|nil|none|(^|\D)0 ?days?/.test(t)) return 0;
  const m = t.match(/(\d+(?:\.\d+)?)\s*(day|week|month|mo|yr|year)?/); if (!m) return null;
  const n = Number(m[1]); const u = m[2] || (n <= 4 ? 'month' : 'day');
  return Math.round(/week/.test(u) ? n * 7 : /^(month|mo)/.test(u) ? n * 30 : /year|yr/.test(u) ? n * 365 : n);
};
export const ctcToRupees = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); if (!Number.isFinite(n) || n <= 0) return null; return n < 1000 ? Math.round(n * 100000) : Math.round(n); };
const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/**
 * candidate = { skills[], experienceYears, expectedCtc, noticeDays, education (text), degree ({rank}), city, openToRelocate, industries[], resumeText, companies[] }
 * Components with no information (the requisition did not ask, or the CV did not say) are left OUT and the weights re-normalised —
 * a missing fact is never silently scored as zero or as perfect.
 */
export function scoreAgainst(c, cand) {
  const w = c.weights; const comps = []; const gaps = []; const strengths = []; const knock = [];
  // skills
  const must = matchSkills(c.mustSkills, cand.skills, cand.resumeText); const nice = matchSkills(c.niceSkills, cand.skills, cand.resumeText);
  let skillsScore = null; let matched = [], missing = [], bonus = [];
  if (must.length || nice.length) {
    const mustShare = must.length ? must.reduce((s, x) => s + x.credit, 0) / must.length : null;
    const niceShare = nice.length ? nice.reduce((s, x) => s + x.credit, 0) / nice.length : null;
    skillsScore = clamp(Math.round(100 * (mustShare != null && niceShare != null ? mustShare * 0.8 + niceShare * 0.2 : mustShare ?? niceShare)));
    matched = [...must, ...nice].filter((x) => x.credit >= 0.75).map((x) => x.skill); missing = must.filter((x) => x.credit < 0.5).map((x) => x.skill); bonus = nice.filter((x) => x.credit >= 0.75).map((x) => x.skill);
    comps.push({ key: 'skills', score: skillsScore, detail: `${must.filter((x) => x.credit >= 0.75).length} of ${must.length} must-have skills shown${nice.length ? `, ${bonus.length} of ${nice.length} nice-to-have` : ''}${must.some((x) => x.how === 'mentioned') ? ' (some only mentioned in the CV text)' : ''}` });
    if (must.length >= 2 && mustShare < 1 - c.knockouts.mustSkillShare) knock.push(`Only ${Math.round(mustShare * 100)}% of the must-have skills found (${missing.slice(0, 4).join(', ')})`);
  }
  // experience
  const yrs = cand.experienceYears;
  if (yrs != null && (c.minYears != null || c.maxYears != null)) {
    let s = 100; let d = `${yrs} years`;
    if (c.minYears != null && yrs < c.minYears) { const gap = c.minYears - yrs; s = clamp(100 - Math.round((gap / Math.max(c.minYears, 1)) * 120)); d += ` — ${gap.toFixed(1)} below the ${c.minYears}-year minimum`; if (gap / Math.max(c.minYears, 1) > c.knockouts.minExperienceGap) knock.push(`Experience ${yrs} yrs against a ${c.minYears}-year minimum`); }
    else if (c.maxYears != null && yrs > c.maxYears + 2) { s = clamp(100 - (yrs - c.maxYears - 2) * 6, 65, 100); d += ` — above the ${c.maxYears}-year ceiling (may be over-qualified)`; }
    else d += ' — within the required range';
    comps.push({ key: 'experience', score: s, detail: d });
  }
  // salary
  const exp = cand.expectedCtc;
  if (exp && c.ctcMax) {
    const over = (exp - c.ctcMax) / c.ctcMax;
    const s = over <= 0 ? 100 : over <= 0.1 ? 70 : over <= 0.25 ? 40 : 10;
    comps.push({ key: 'salary', score: s, detail: `Expects ₹${exp.toLocaleString('en-IN')} against a maximum of ₹${c.ctcMax.toLocaleString('en-IN')}${over > 0 ? ` (${Math.round(over * 100)}% over)` : ''}` });
    if (over > c.knockouts.ctcOverShare) knock.push(`Expected CTC is ${Math.round(over * 100)}% above the approved maximum`);
  }
  // notice
  if (cand.noticeDays != null) {
    const n = cand.noticeDays; const s = n <= 15 ? 100 : n <= 30 ? 90 : n <= 45 ? 75 : n <= 60 ? 60 : n <= 90 ? 40 : 20;
    comps.push({ key: 'notice', score: s, detail: n === 0 ? 'Immediate joiner' : `${n}-day notice period` });
    if (n > c.knockouts.noticeDays) knock.push(`Notice period of ${n} days`);
  }
  // education
  if (c.qualifications.length || cand.degree) {
    let s = null; let d = '';
    if (c.qualifications.length) {
      const text = `${cand.education || ''} ${cand.resumeText || ''}`.toLowerCase();
      const hit = c.qualifications.filter((q) => { const nq = normSkill(q); return nq.length >= 2 && (text.includes(q.toLowerCase()) || textHas(` ${text.replace(/[^a-z0-9+#./& -]/g, ' ')} `, nq)); });
      if (hit.length) { s = 100; d = `Matches the required qualification (${hit[0]})`; }
      else if (cand.degree) { const need = Math.min(...c.qualifications.map((q) => (highestDegree(q)?.rank ?? 4))); s = cand.degree.rank >= need ? 85 : 45; d = cand.degree.rank >= need ? 'Holds an equivalent or higher level of qualification' : 'Qualification is below the level asked for'; }
      else { s = null; }
    } else if (cand.degree) { s = cand.degree.rank >= 4 ? 80 : cand.degree.rank >= 3 ? 65 : 50; d = 'No specific qualification asked — scored on the level of degree held'; }
    if (s != null) comps.push({ key: 'education', score: s, detail: d });
  }
  // location
  if (c.location || c.remote) {
    if (c.remote) comps.push({ key: 'location', score: 100, detail: 'Remote role — location is not a constraint' });
    else if (cand.city) { const near = c.location.includes(String(cand.city).toLowerCase()) || String(cand.city).toLowerCase().split(/[ ,]+/).some((p) => p.length > 3 && c.location.includes(p)); comps.push({ key: 'location', score: near ? 100 : cand.openToRelocate ? 80 : 45, detail: near ? `Based in ${cand.city}` : cand.openToRelocate ? `${cand.city} — open to relocation` : `${cand.city} — outside the job location` }); }
  }
  // industry
  if (c.industries.length) {
    const text = ` ${String(cand.resumeText || '').toLowerCase()} ${(cand.companies || []).join(' ').toLowerCase()} `;
    const hit = c.industries.filter((i) => text.includes(i.toLowerCase()));
    if (cand.resumeText || (cand.companies || []).length) comps.push({ key: 'industry', score: hit.length ? 100 : 40, detail: hit.length ? `Industry exposure: ${hit.slice(0, 3).join(', ')}` : 'No mention of the required industry experience' });
  }

  // weighted total over what is known
  const used = comps.filter((x) => w[x.key] > 0);
  const totalW = used.reduce((s, x) => s + w[x.key], 0);
  const rawOverall = totalW ? Math.round(used.reduce((s, x) => s + x.score * w[x.key], 0) / totalW) : null;
  const known = used.length;
  const overall = rawOverall == null ? null : knock.length ? Math.min(rawOverall, 49) : rawOverall;
  let recommendation = overall == null ? 'Not enough information' : overall >= 80 ? 'Strongly Recommend' : overall >= 65 ? 'Recommend' : overall >= 45 ? 'Maybe' : 'Not Recommend';
  const criteria = comps.map((x) => ({ key: x.key, label: COMPONENT_LABELS[x.key], weight: totalW ? Math.round((w[x.key] / totalW) * 100) : 0, score: x.score, detail: x.detail }));
  for (const x of criteria) { if (x.score >= 85) strengths.push(x.detail); else if (x.score < 50) gaps.push(x.detail); }
  const by = Object.fromEntries(comps.map((x) => [x.key, x.score]));
  return {
    overall_score: overall, raw_score: rawOverall, recommendation, knockouts: knock, criteria, weights_used: Object.fromEntries(criteria.map((x) => [x.key, x.weight])),
    skills_score: by.skills ?? null, experience_score: by.experience ?? null, salary_score: by.salary ?? null, notice_score: by.notice ?? null, education_score: by.education ?? null, location_score: by.location ?? null, industry_score: by.industry ?? null,
    matched_skills: matched, missing_skills: missing, bonus_skills: bonus, strengths, gaps: [...knock.map((k) => `Knock-out: ${k}`), ...gaps],
    confidence: known >= 4 ? 'high' : known >= 2 ? 'medium' : 'low', components_scored: known,
    summary: overall == null ? 'There is too little information (no CV text and no requisition criteria) to score this candidate.' : `${overall}/100 — ${recommendation}. ${strengths[0] ? 'Strongest: ' + strengths[0] + '. ' : ''}${knock.length ? 'Knock-out: ' + knock[0] + '.' : gaps[0] ? 'Main gap: ' + gaps[0] + '.' : ''}`.trim(),
  };
}

// ── reading a CV without an AI (used when the AI is unavailable or not permitted) ──
const LEXICON = ['javascript', 'typescript', 'react', 'angular', 'vue', 'nodejs', 'python', 'java', 'c++', 'c#', 'php', 'sql', 'postgresql', 'mysql', 'mongodb', 'aws', 'azure', 'docker', 'kubernetes', 'git', 'rest apis', 'html', 'css', 'django', 'flask', 'spring',
  'excel', 'power bi', 'tableau', 'tally', 'sap', 'gst', 'tds', 'financial reporting', 'budgeting', 'reconciliation', 'audit', 'crm', 'salesforce', 'b2b sales', 'lead generation', 'negotiation', 'cold calling', 'dealer management', 'market research', 'key account management',
  'autocad', 'solidworks', 'catia', 'creo', 'plc', 'scada', 'embedded c', 'matlab', 'pcb design', 'battery management system', 'lithium ion', 'thermal management', 'six sigma', 'lean', '5s', 'kaizen', 'iso 9001', 'quality control', 'quality assurance', 'production planning',
  'supply chain', 'vendor development', 'inventory management', 'logistics', 'procurement', 'warehouse management', 'recruitment', 'payroll', 'onboarding', 'labour laws', 'employee engagement', 'hrms', 'customer service', 'ticketing', 'warranty',
  'communication', 'leadership', 'team management', 'project management', 'ms project', 'jira', 'agile', 'scrum', 'microsoft office', 'powerpoint', 'data analysis', 'machine learning', 'artificial intelligence', 'seo', 'social media', 'content writing', 'graphic design'];
/** Skills from a general lexicon that the CV text actually mentions. */
export function detectSkills(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9+#./& -]/g, ' ').replace(/\s+/g, ' ')} `;
  return LEXICON.filter((k) => textHas(t, k) || (k === 'nodejs' && /\bnode\.?js\b/.test(t)) || (k === 'react' && /\breact(\.js|js)?\b/.test(t)));
}
/** A ParsedResume built only from the text (no AI): honest about what it could and could not read. */
export function rulesParse(text, cand = {}) {
  const a = analyseResumeText(text); const skills = detectSkills(text);
  const deg = a.degree ? { master: 'Master’s degree', bachelor: 'Bachelor’s degree', diploma: 'Diploma', phd: 'Doctorate', ca: 'CA / CMA', iti: 'ITI', school: 'School' }[a.degree.key] : null;
  return {
    resume_headline: cand.position_applied || null, professional_summary: null, total_experience_years: a.experience_years, relevant_experience_years: null,
    current_designation: null, current_company: cand.current_company || null, primary_skills: skills.slice(0, 12), secondary_skills: skills.slice(12, 24), tools_and_platforms: [], certifications: [],
    degree: deg, linkedin_url: a.contacts.linkedin || null, github_url: a.contacts.github || null, ats_score: null, parse_note: 'Read by rules only (no AI): skills are matched from a general list and experience from the dates in the CV.',
  };
}
