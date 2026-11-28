// Admin Panel → Gate Pass Email (lw_* functions, admin only): who receives the daily "left without gate pass" email.
import { one, all } from '../db.js';
import { validEmail } from '../utils/hrMail.js';
import { loadConfig, saveConfig, cleanRecipients, sendLeftGatePassMail, MAX_RECIPIENTS } from '../cron/leftGatePassMail.js';
import { leftWithoutGatePass, leftRows, COLUMNS, LEFT_EARLY_MIN } from '../utils/leftWithoutGatePass.js';

const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
const istDate = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);

export async function handleLeftGatePassMail(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const u = await one('SELECT role, custom_role, full_name, email FROM users WHERE id=$1', [cu.id]) || {};
  if (![u.role, u.custom_role].includes('admin')) return fail(res, 'Admin access required', 403);
  const log = async () => (await all("SELECT data FROM entities WHERE type='LeftGatePassMailLog' AND status<>'sending' ORDER BY data::jsonb->>'sent_at' DESC LIMIT 15")).map((r) => JSON.parse(r.data));

  if (name === 'lw_get') return res.json({ success: true, config: await loadConfig(), log: await log(), yesterday: istDate(-1), threshold_minutes: LEFT_EARLY_MIN });

  if (name === 'lw_save') {
    const recipients = cleanRecipients(p.recipients);
    const bad = recipients.find((e) => !validEmail(e));
    if (bad) return fail(res, `"${bad}" is not a valid email address.`);
    if (recipients.length > MAX_RECIPIENTS) return fail(res, `At most ${MAX_RECIPIENTS} recipients.`);
    await saveConfig({ recipients, enabled: p.enabled !== false, send_when_none: p.send_when_none !== false, updated_at: new Date().toISOString(), updated_by: cu.id, updated_by_name: u.full_name || u.email || '' });
    return res.json({ success: true, config: await loadConfig() });
  }

  const date = String(p.date || istDate(-1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= istDate()) return fail(res, 'Choose a day before today.');
  if (name === 'lw_preview') {
    const { flagged, byUser } = await leftWithoutGatePass(date, date);
    return res.json({ success: true, date, columns: COLUMNS.map((c) => c[0]), rows: leftRows(flagged, byUser) });
  }
  if (name === 'lw_send') {
    try {
      const out = await sendLeftGatePassMail({ date, manual: true });
      if (out.skipped) return fail(res, out.skipped === 'no recipients configured' ? 'Add and save at least one recipient first.' : out.skipped);
      return res.json({ success: true, ...out });
    } catch (e) { return fail(res, `The email could not be sent: ${e.message}`, 502); }
  }
  return res.status(400).json({ error: `Unknown function ${name}` });
}
