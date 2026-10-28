// HR / admin choice of which departments are eligible for the Roaster holiday (a single RoasterConfig entity).
import { v4 as uuidv4 } from 'uuid';
import { one, run } from '../db.js';

export async function loadRoasterConfig() {
  const row = await one("SELECT id,data FROM entities WHERE type='RoasterConfig' ORDER BY created_at LIMIT 1");
  return row ? { ...JSON.parse(row.data), id: row.id } : null;
}

export async function saveRoasterConfig(departments, userId) {
  const clean = [...new Set((departments || []).map(d => String(d || '').trim()).filter(Boolean))];
  const cur = await loadRoasterConfig();
  const data = { id: cur?.id || uuidv4(), eligible_departments: clean, updated_by: userId, updated_at: new Date().toISOString() };
  if (cur) await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(data), data.id]);
  else await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'RoasterConfig',NULL,'active',$2)", [data.id, JSON.stringify(data)]);
  return data;
}
