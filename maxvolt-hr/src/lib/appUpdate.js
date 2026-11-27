// Does this installed Android app have to be updated? The server decides (getAppUpdatePolicy); this reads the installed build and
// remembers the last answer so that switching to flight mode does not get past a required update. No imports: unit tested in Node.
export const UPDATE_CACHE_KEY = 'mv_app_update_v1';

// The installed versionCode. 0 for an app built before it could report one; null when it simply could not be read.
export async function installedBuild(getInfo) {
  try {
    const info = await getInfo();
    const n = Number(info?.build);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return e?.code === 'UNIMPLEMENTED' || /not implemented/i.test(e?.message || '') ? 0 : null;
  }
}

// -> the server's answer when an update is required, otherwise null.
export async function checkAppUpdate({ platform, getInfo, fetchPolicy, storage }) {
  if (platform !== 'android') return null;
  const build = await installedBuild(getInfo);
  if (build === null) return null;
  try {
    const answer = await fetchPolicy({ platform, build });
    if (!answer?.success) throw new Error('no answer');
    if (!answer.required) { storage?.removeItem(UPDATE_CACHE_KEY); return null; }
    storage?.setItem(UPDATE_CACHE_KEY, JSON.stringify({ ...answer, build }));
    return answer;
  } catch {
    try {
      const kept = JSON.parse(storage?.getItem(UPDATE_CACHE_KEY) || 'null');
      return kept?.required && kept.build === build ? kept : null;   // offline: only for the very build that was told to update
    } catch { return null; }
  }
}
