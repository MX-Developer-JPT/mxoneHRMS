// Mandatory Android app update. Off until an admin switches it on - which must only happen once the new version can actually be
// installed from the Play Store, otherwise people are locked out with nothing to update to. Pure functions (tested).
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.maxvolt.hr';
export const DEFAULT_POLICY = { enabled: false, min_build: 0, min_version: '', message: '' };

export function normalizePolicy(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const build = Math.floor(Number(r.min_build));
  const min_build = Number.isFinite(build) && build > 0 && build < 100000 ? build : 0;
  return {
    enabled: r.enabled === true && min_build > 0,
    min_build,
    min_version: String(r.min_version || '').trim().slice(0, 20),
    message: String(r.message || '').trim().slice(0, 300),
  };
}

// build = the installed app's Android versionCode. 0 = an app too old to say; null = could not be read (never block on that).
// Only the Android app is ever blocked: not the website, not iPhones.
export function updateAnswer(policy, { platform, build } = {}) {
  const p = normalizePolicy(policy);
  const installed = build === null || build === undefined || build === '' ? NaN : Number(build);
  const required = p.enabled && platform === 'android' && Number.isFinite(installed) && installed < p.min_build;
  return { required, min_build: p.min_build, min_version: p.min_version, message: p.message, store_url: PLAY_STORE_URL };
}
