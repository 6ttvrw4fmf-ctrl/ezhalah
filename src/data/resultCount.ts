// THE RESULT-CAP RULE (owner 2026-08-20), in ONE place so every surface obeys it and one test locks it.
//
//   Ezhalah shows at most BROWSE_CAP (100) listing cards for a single search. But 100 is a CAP, never a
//   fake result count. The number of cards a user can reach is ALWAYS min(trueTotal, BROWSE_CAP):
//     trueTotal =   8 → browse   8      trueTotal =  99 → browse  99
//     trueTotal =  46 → browse  46      trueTotal = 100 → browse 100
//     trueTotal = 437 → browse 100, and the end message still tells the truth: "matched 437, showed 100".
//
//   trueTotal (how many listings actually satisfy the whole search) and the browse cap are TWO different
//   numbers and must never be confused. The end-of-results message states trueTotal — the authoritative
//   matching count — NOT the cap and NOT the loaded-array length. See the ban list in
//   scripts/verify-result-cap-honesty.ts: a hardcoded 100, a page size, a candidate cap or a loaded
//   length may never stand in for trueTotal.
//
// This module is pure (no React, no i18n) so it is trivially unit-tested across every boundary and
// mutation-proven. agent.tsx consumes it for BOTH the "load more" gate and the closing message.

export const BROWSE_CAP = 100;

// Which closing sentence to show, and with which number. The renderer maps the kind → an i18n string;
// keeping the STRING out of here is what lets the same logic be asserted without a translation table.
export type EndKind =
  | 'more'    // still revealing toward the cap — "showed first {shown}, want more?"
  | 'all'     // trueTotal <= cap and every match is on screen — "matched {trueTotal}, all available"
  | 'capped'; // trueTotal >  cap and the cap is on screen — "matched {trueTotal}, showed {cap}"

export type ResultCounts = {
  reachable: number;   // min(trueTotal, cap) — the MOST cards this search will ever show
  hasMore: boolean;    // a "load more" affordance is legitimate (more reachable cards not yet revealed)
  atCap: boolean;      // trueTotal exceeds the cap
  endKind: EndKind;    // which closing message the truth calls for
  endTotal: number;    // the number the closing message must state (always trueTotal, never the cap)
  endShown: number;    // how many were shown (== reachable at the end)
};

// trueTotal  — authoritative count of listings matching the WHOLE search (RPC total_count when the whole
//              filter ran server-side; the honest loaded count when client-only narrowing means the RPC
//              total overstates — the caller decides which, this module never guesses).
// shown      — cards currently revealed on screen.
// fetched    — cards currently in the client buffer (a page/paging artifact — NEVER a stand-in for trueTotal).
// serverMore — the DB still has more matching pages to fetch.
export function resultCounts(args: {
  trueTotal: number;
  shown: number;
  fetched: number;
  serverMore: boolean;
  cap?: number;
}): ResultCounts {
  const cap = args.cap ?? BROWSE_CAP;
  const trueTotal = Math.max(0, Math.floor(args.trueTotal));
  const fetched = Math.max(0, Math.floor(args.fetched));
  const reachable = Math.min(trueTotal, cap);
  // Never let the revealed count exceed what the cap allows — the display cap is a hard ceiling.
  const shown = Math.min(Math.max(0, Math.floor(args.shown)), reachable);
  // More is legitimate ONLY while fewer than the reachable set is on screen AND the rows exist to reveal
  // (buffered, or the server has more pages). Crucially this goes false the instant `shown` hits the cap,
  // so a 2,223-match search stops offering "load more" at 100 instead of paging on forever.
  const hasMore = shown < reachable && (shown < fetched || args.serverMore);
  const atCap = trueTotal > cap;
  const endKind: EndKind = hasMore ? 'more' : atCap ? 'capped' : 'all';
  return { reachable, hasMore, atCap, endKind, endTotal: trueTotal, endShown: shown };
}
