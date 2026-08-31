// THE BROWSE-CONTINUATION RULE (owner 2026-08-29, supersedes the 2026-08-20 lifetime cap), in ONE
// place so every surface obeys it and one test locks it.
//
//   «عرض المزيد» keeps working for as long as matching listings genuinely exist. The user browses in
//   batches of BROWSE_BATCH (100), landing on clean boundaries — first 100, then 101–200, then
//   201–300 — all the way to the LAST real match. There is no lifetime ceiling: a 9,892-match search
//   is browsable to 9,892. What was true before stays true: numbers are never faked —
//     trueTotal =   8 → browse   8, message says all 8
//     trueTotal = 437 → browse 100 → 200 → 300 → 400 → 437, message always states 437
//   trueTotal (how many listings actually satisfy the whole search) and the batch size are TWO
//   different numbers and must never be confused. The closing message states trueTotal — the
//   authoritative matching count — NOT a batch size and NOT the loaded-array length. See the ban
//   list in scripts/verify-result-cap-honesty.ts: a hardcoded 100, a page size, a candidate cap or
//   a loaded length may never stand in for trueTotal.
//
// This module is pure (no React, no i18n) so it is trivially unit-tested across every boundary and
// mutation-proven. agent.tsx consumes it for BOTH the "load more" targets and the closing message.

export const BROWSE_BATCH = 100;

// The reveal target for one «عرض المزيد» press: the NEXT clean batch boundary (…→100→200→300),
// clamped to what actually exists. From the initial drip (e.g. 10 shown) the first press completes
// the first hundred, not 10+100=110 — the owner's spec is explicit about the boundaries.
export function nextBatchTarget(shown: number, available: number, batch = BROWSE_BATCH): number {
  const s = Math.max(0, Math.floor(shown));
  const boundary = (Math.floor(s / batch) + 1) * batch;
  return Math.min(boundary, Math.max(0, Math.floor(available)));
}

// Which closing sentence to show, and with which number. The renderer maps the kind → an i18n
// string; keeping the STRING out of here is what lets the same logic be asserted without a
// translation table. 'capped' is GONE — with continuation there is no third state.
export type EndKind =
  | 'more'    // more matches remain — "showed first {shown} (of {total}), want more?"
  | 'all';    // every match is on screen — "matched {trueTotal}, all shown"

export type ResultCounts = {
  reachable: number;   // trueTotal — EVERY match is reachable through paging now
  hasMore: boolean;    // a "load more" affordance is legitimate (matches remain beyond `shown`)
  endKind: EndKind;    // which closing message the truth calls for
  endTotal: number;    // the number the closing message must state (always trueTotal, never a batch)
  endShown: number;    // how many are on screen
};

// trueTotal  — authoritative count of listings matching the WHOLE search (RPC total_count when the
//              whole filter ran server-side; the caller substitutes an honest floor when client-only
//              narrowing means the RPC total overstates — this module never guesses).
// shown      — cards currently revealed on screen.
// fetched    — cards currently in the client buffer (a paging artifact — NEVER a stand-in for trueTotal).
// serverMore — the DB still has more matching pages to fetch.
export function resultCounts(args: {
  trueTotal: number;
  shown: number;
  fetched: number;
  serverMore: boolean;
}): ResultCounts {
  const trueTotal = Math.max(0, Math.floor(args.trueTotal));
  const fetched = Math.max(0, Math.floor(args.fetched));
  const shown = Math.min(Math.max(0, Math.floor(args.shown)), trueTotal);
  // More is legitimate while matches remain beyond what's on screen AND the rows exist to reveal
  // (buffered, or the server has more pages). No ceiling: this stays true at 100, 200, 300… until
  // the LAST real match is on screen — and never after (a fabricated "more" would page into nothing).
  const hasMore = shown < trueTotal && (shown < fetched || args.serverMore);
  const endKind: EndKind = hasMore ? 'more' : 'all';
  return { reachable: trueTotal, hasMore, endKind, endTotal: trueTotal, endShown: shown };
}
