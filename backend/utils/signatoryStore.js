// Configured authorised signatories (entity AuthorisedSignatory).
import { all } from '../db.js';

export async function listSignatories() {
  try {
    return (await all("SELECT id, data FROM entities WHERE type='AuthorisedSignatory'"))
      .map((r) => ({ ...JSON.parse(r.data), id: r.id }))
      .filter((s) => s.name)
      .sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.name.localeCompare(b.name));
  } catch (e) {
    console.error('[signatory] could not load:', e.message);
    return [];
  }
}
