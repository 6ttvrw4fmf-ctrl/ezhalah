// THE HONEST HEADLINE, MEASURED (🦅 2026-11-10). The app prints total_count MINUS the rows of the page it asked the
// raw tables for and did not get back (src/lib/honestTotal.ts, owner 2026-10-30: «a count that differs from the
// reachable cards is a bug»). A live robot that demands «headline == total_count» therefore goes red whenever one
// listing was hidden at source between two :22 index syncs — measured that day on af-live-truth-check
// (headline 23,780 vs rpc 23,781) and on the Trending four-way check (Dammam ui 1,809 vs rpc 1,810).
//
// The allowance is EXACT and MEASURED, never a tolerance: the robot records the hydration requests the page really
// sent (`…_listings?…&id=in.(…)`), and the headline must equal rpc − (rows asked for and not returned). When any row's
// request was not observed the allowance is null and the headline must equal rpc. More than MAX_HYDRATION_DROPS
// drops is index↔raw drift and stays red.
export const MAX_HYDRATION_DROPS = 25;

export type HydrationLedger = { asked: Map<string, number>; got: Set<string> };
export const newHydrationLedger = (): HydrationLedger => ({ asked: new Map(), got: new Set() });

/** Record one raw-table hydration response: its URL names the table and the ids asked for; its body holds the rows returned. */
export function recordHydration(led: HydrationLedger, url: string, ok: boolean, body: unknown, seq: number): boolean {
  const dec = (() => { try { return decodeURIComponent(url); } catch { return url; } })();
  const tbl = (url.match(/\/rest\/v1\/([a-z0-9_]+_listings)\?/) || [])[1];
  const inList = (dec.match(/[?&]id=in\.\(([^)]*)\)/) || [])[1];
  if (!tbl || inList == null || !ok || !Array.isArray(body)) return false;   // a failed chunk is not a drop
  for (const id of inList.split(',').map((x) => x.trim()).filter(Boolean)) led.asked.set(`${tbl}:${id}`, seq);
  for (const row of body as any[]) if (row?.id != null) led.got.add(`${tbl}:${row.id}`);
  return true;
}

/** Rows of a search page («table:id» keys) asked for after `sinceSeq` and not returned; null if any row was not observed. */
export function dropsOf(led: HydrationLedger, rows: string[], sinceSeq = -Infinity): { n: number | null; keys: string[] } {
  const keys: string[] = [];
  for (const k of rows) {
    const s = led.asked.get(k);
    if (s == null || s < sinceSeq) return { n: null, keys: [] };
    if (!led.got.has(k)) keys.push(k);
  }
  return { n: keys.length, keys };
}

/** headline == rpc − measured drops (exact); unobserved drops → headline == rpc; drift above the cap is never honest. */
export function honestHeadline(headline: number | null, rpc: number | null, drops: number | null): boolean {
  if (headline == null || rpc == null) return false;
  if (drops == null) return headline === rpc;
  return drops <= MAX_HYDRATION_DROPS && headline === rpc - drops;
}
