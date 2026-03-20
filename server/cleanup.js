const SIX_HOURS = 6 * 60 * 60 * 1000;

export function startCleanup(db, pruneFn, intervalMs = 10 * 60 * 1000) {
  const id = setInterval(() => {
    pruneFn(db, SIX_HOURS);
    console.log('[Cleanup] Pruned old data');
  }, intervalMs);

  return () => clearInterval(id);
}
