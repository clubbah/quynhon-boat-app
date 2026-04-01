const DETAIL_WINDOW = 24 * 60 * 60 * 1000;     // Keep detailed positions for 24 hours
const STALE_VESSEL_AGE = 2 * 60 * 60 * 1000;   // Remove from live map after 2 hours

export function startCleanup(db, pruneVessels, compressPositions, intervalMs = 10 * 60 * 1000) {
  const id = setInterval(() => {
    // Remove stale vessels from the live vessels table (map display)
    pruneVessels(db, STALE_VESSEL_AGE);
    // Compress positions older than 24h into hourly summaries
    const compressed = compressPositions(db, DETAIL_WINDOW);
    console.log(`[Cleanup] Pruned stale vessels, compressed ${compressed} position rows`);
  }, intervalMs);

  return () => clearInterval(id);
}
