// The pure half of the logo warm-up (no react-native, so a barrier can run it): the concurrency cap, the data-saver rule and the queue.
// See lib/warmPlatformLogos.ts for what is warmed and when.
export const WARM_CONCURRENCY = 3;

/** Data-saver or a 2G link: leave the logos to load on demand, as before. */
export function shouldSkipWarm(conn: { saveData?: boolean; effectiveType?: string } | null | undefined): boolean {
  if (!conn) return false;
  return conn.saveData === true || /(^|-)2g$/.test(String(conn.effectiveType ?? ''));
}

/** Runs `load` over `items` with at most `limit` in flight, in order; one failure never stops the others. */
export async function warmQueue<T>(items: readonly T[], load: (item: T) => Promise<unknown>, limit = WARM_CONCURRENCY): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await load(item); } catch { /* a logo that fails here simply loads on demand later */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
