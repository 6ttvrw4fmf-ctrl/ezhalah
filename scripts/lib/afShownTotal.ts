// THE NUMBER ON SCREEN IS THE HONEST TOTAL, NOT THE RAW INDEX TOTAL (🔬 2026-11-07, alert 11763 / backlog 1380).
//
// Since 🔧 backlog 1153 (2026-11-01, src/lib/honestTotal.ts) the results sentence shows the index's total_count MINUS
// the rows of this page whose card the raw hydration could not load (hidden at source since the last :22 sync). That
// is an owner rule: «a count that differs from the reachable cards is a bug». verify-af-live-truth.ts still compared
// the screen with the RAW total_count, so every journey that met one freshly hidden row went red on a correct screen:
// 2026-11-07 run 42352580488 — ui=6705 rpc=6706, ui=18701 rpc=18703, ui=17400 rpc=17402 (always below, never above).
//
// The check now computes what the app is required to show from the SAME responses the page received — the result
// RPC (candidates + total_count) and the raw-table hydration reads (`/rest/v1/<table>_listings?…id=in.(…)`) — through
// the app's own honestTotal(). Nothing is tolerated: the screen must equal that number exactly, and the drop it
// subtracts is only rows the page really asked for and did not get back.
import { honestTotal } from '../../src/lib/honestTotal.ts';

const RAW_READ = /\/rest\/v1\/([a-z0-9_]+_listings)\?(?:.*&)?id=in\./;

/** The `table:id` keys a raw-table hydration response returned, or [] when the URL is not a by-id hydration read. */
export function hydrationKeys(url: string, rows: unknown): string[] {
  const m = RAW_READ.exec(url);
  if (!m || !Array.isArray(rows)) return [];
  const out: string[] = [];
  for (const r of rows) {
    const id = (r as { id?: unknown } | null)?.id;
    if (id != null && Number.isFinite(Number(id))) out.push(`${m[1]}:${Number(id)}`);
  }
  return out;
}

export type ShownTotal = { shown: number; total: number; candidates: number; hydrated: number; dropped: number };

/** What the results sentence must read: honestTotal(total_count, this page's candidates, the ones hydration returned). */
export function expectedShownTotal(searchResp: unknown, hydrated: ReadonlySet<string>): ShownTotal {
  const rows = Array.isArray(searchResp) ? (searchResp as Array<{ source_table?: string; listing_id?: unknown; total_count?: unknown }>) : [];
  const total = Number(rows[0]?.total_count ?? rows.length);
  // Row for row as fetchListingPage counts them: candidates = the page's rows, hydrated = the rows map.get() found.
  const got = rows.filter((r) => hydrated.has(`${r.source_table}:${Number(r.listing_id)}`)).length;
  const shown = honestTotal(total, rows.length, got);
  return { shown, total, candidates: rows.length, hydrated: got, dropped: rows.length - got };
}
