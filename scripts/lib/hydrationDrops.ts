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

// Per listing key, the NEWEST hydration that asked for it (by arrival order) and whether THAT response returned it.
// A slower, older response never overwrites a newer observation, and «returned» belongs to one response, never to
// the key forever — so a row an older search got back cannot mask the newer search's drop (CodeRabbit, PR 11725).
// Every observation is kept: an older search's hydration can ARRIVE after the newer one's, and the URL cannot say
// which search asked. When the observations made after a search DISAGREE about a row, the drop count is ambiguous
// and is reported as unmeasured, so the strict «headline == rpc» rule applies (CodeRabbit, PR 11725).
// `pending` counts hydration responses that have ARRIVED but whose body is still being read: while any is pending, a
// newer observation may be about to land, so no drop count is a verdict yet (CodeRabbit, PR 11725).
// `failed`: arrival stamps of hydrations that settled WITHOUT an observation (request failed, non-2xx, unreadable
// body). A failed newer hydration may have been the one that returned a row, so any failure at or after a search
// keeps that search's drop count unmeasured (CodeRabbit, PR 11725).
export type HydrationLedger = { obs: Map<string, { seq: number; got: boolean }[]>; pending: number; failed: number[] };
export const newHydrationLedger = (): HydrationLedger => ({ obs: new Map(), pending: 0, failed: [] });
/** Call synchronously when a hydration response arrives (before any await); call `done()` once it is recorded or failed. */
export function beginHydration(led: HydrationLedger): () => void {
  led.pending++;
  let closed = false;
  return () => { if (!closed) { closed = true; led.pending--; } };
}

/** A raw-table hydration request the app sends (fetchRawByIds: GET /rest/v1/<table>_listings?…&id=in.(…)). */
export function isHydrationRequest(method: string, url: string): boolean {
  let u = url; try { u = decodeURIComponent(url); } catch { /* keep raw */ }
  return method === 'GET' && /\/rest\/v1\/[a-z0-9_]+_listings\?/.test(u) && /[?&]id=in\./.test(u);
}
/**
 * Hold the ledger open from the moment a hydration REQUEST is sent until its response is recorded or the request
 * fails (CodeRabbit, PR 11725): a newer hydration still waiting for its response headers may carry the newer
 * observation, so an older omission cannot be counted as a drop while it is in flight.
 */
export function hydrationRequestTracker<K>(led: HydrationLedger) {
  const open = new Map<K, () => void>();
  return {
    sent(k: K) { if (!open.has(k)) open.set(k, beginHydration(led)); },
    /** `recorded` false (failed / unreadable) stamps a failure at `seq`, so the overlap stays unmeasured. */
    settled(k: K, recorded: boolean, seq: number) {
      const close = open.get(k);
      if (!close) return;
      open.delete(k);
      if (!recorded) led.failed.push(seq);
      close();
    },
    get inFlight() { return open.size; },
  };
}

/** Record one raw-table hydration response: its URL names the table and the ids asked for; its body holds the rows returned. */
export function recordHydration(led: HydrationLedger, url: string, ok: boolean, body: unknown, seq: number): boolean {
  const dec = (() => { try { return decodeURIComponent(url); } catch { return url; } })();
  const tbl = (url.match(/\/rest\/v1\/([a-z0-9_]+_listings)\?/) || [])[1];
  const inList = (dec.match(/[?&]id=in\.\(([^)]*)\)/) || [])[1];
  if (!tbl || inList == null || !ok || !Array.isArray(body)) return false;   // a failed chunk is not a drop
  const returned = new Set((body as any[]).filter((r) => r?.id != null).map((r) => String(r.id)));
  for (const id of inList.split(',').map((x) => x.trim()).filter(Boolean)) {
    const k = `${tbl}:${id}`;
    const list = led.obs.get(k) ?? [];
    list.push({ seq, got: returned.has(id) });
    led.obs.set(k, list);
  }
  return true;
}

/** Rows of a search page («table:id» keys) asked for after `sinceSeq` and not returned; null if any row was not observed. */
export function dropsOf(led: HydrationLedger, rows: string[], sinceSeq = -Infinity): { n: number | null; keys: string[] } {
  if (led.pending > 0) return { n: null, keys: [] };              // a hydration body is still being read
  if (led.failed.some((f) => f >= sinceSeq)) return { n: null, keys: [] };   // a hydration for this search failed
  const keys: string[] = [];
  for (const k of rows) {
    const after = (led.obs.get(k) ?? []).filter((o) => o.seq >= sinceSeq);
    if (!after.length) return { n: null, keys: [] };                         // not observed for this search
    if (after.some((o) => o.got) && after.some((o) => !o.got)) return { n: null, keys: [] };  // ambiguous overlap
    if (!after[0].got) keys.push(k);
  }
  return { n: keys.length, keys };
}

/** headline == rpc − measured drops (exact); unobserved drops → headline == rpc; drift above the cap is never honest. */
export function honestHeadline(headline: number | null, rpc: number | null, drops: number | null): boolean {
  if (headline == null || rpc == null) return false;
  if (drops == null) return headline === rpc;
  return drops <= MAX_HYDRATION_DROPS && headline === rpc - drops;
}

/** The search the headline describes is a RESULTS page: page 0 of a real page size. A count probe (p_limit 1) or a later
 *  page never is — letting one replace the results page would count drops over the wrong rows (CodeRabbit, PR 11725). */
export function isResultsPage(body: { p_offset?: unknown; p_limit?: unknown } | null | undefined): boolean {
  return Number(body?.p_offset ?? 0) === 0 && Number(body?.p_limit ?? 0) > 1;
}

/** The captured entry that ARRIVED last (greatest seq), never merely the one whose body finished reading last. */
export function newestBySeq<T extends { seq: number }>(items: T[]): T | null {
  let best: T | null = null;
  for (const it of items) if (!best || it.seq > best.seq) best = it;
  return best;
}

/** The ONE rule a live robot uses to keep the search its headline is judged against: a results page replaces the kept
 *  one only if it ARRIVED later; anything that is not a results page (a count probe, a later page) never does. */
export function pickResultsSearch<T extends { body: any; seq: number }>(kept: T | null, arrived: T): T | null {
  if (!isResultsPage(arrived.body)) return kept;
  return !kept || arrived.seq > kept.seq ? arrived : kept;
}

/**
 * Read the headline only AFTER the drop count is measured, and keep re-reading both until they agree or the
 * bounded wait ends (CodeRabbit, PR 11725): the app may still be updating its headline while hydration lands,
 * so a headline read before the wait is stale. The verdict is always the LAST pair read; nothing is excused.
 */
export async function settleHeadline<D extends { n: number | null }>(
  readUi: () => Promise<number | null>, readDrops: () => D, rpc: number | null,
  sleep: () => Promise<void>, tries = 20,
): Promise<{ ui: number | null; drops: D; ok: boolean }> {
  let drops = readDrops();
  for (let i = 0; i < tries && drops.n == null; i++) { await sleep(); drops = readDrops(); }
  let ui = await readUi();
  for (let i = 0; i < tries && !honestHeadline(ui, rpc, drops.n); i++) { await sleep(); drops = readDrops(); ui = await readUi(); }
  return { ui, drops, ok: honestHeadline(ui, rpc, drops.n) };
}
