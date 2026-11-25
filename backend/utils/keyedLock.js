// A tiny in-process mutex per key. The phone's JavaScript recorder and its native recorder upload the same session at the same time,
// and several server jobs rewrite a session document; every one of those is read-modify-write on one row, so without a lock the
// later writer silently erases the earlier one's points. The app runs as a single server process, so an in-process lock is enough.
const locks = new Map();

export async function keyedLock(key) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  const chain = prev.then(() => next);
  locks.set(key, chain);
  await prev;
  return () => { release(); if (locks.get(key) === chain) locks.delete(key); };
}
