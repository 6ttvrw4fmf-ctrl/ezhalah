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

// ── ONE PRESS'S PAGE BUDGET ──────────────────────────────────────────────────────────────────────
// A «عرض المزيد» drain walks REAL DB pages in a loop, so the loop needs a bound: against a
// pathological `hasMore` that never clears, and against one tap costing production an unbounded
// number of search RPCs (SEARCH_MATCH_QA_ENGINEER.md §40.1 — the search RPC is already 64.4% of all
// database time). The bound is NOT a product ceiling and must never become one: a press that
// reaches it reveals everything it DID fetch and leaves «عرض المزيد» offered, so every match stays
// reachable across presses and the owner's 2026-08-29 no-lifetime-cap promise holds.
//
// EXPRESS THE BUDGET IN ROWS AND DERIVE THE PAGE COUNT — never hardcode the page count.
// Until 2026-09-12 agent.tsx carried a bare `MAX_DRAIN_PAGES = 50`, justified in its own comment as
// "50 pages of the RPC's own 1,500-row page size covers any real Saudi property search (75,000
// listings) many times over". But the load-more path pages at LOAD_MORE_PAGE_SIZE = 500, not 1,500,
// so the real reach was 25,000 — and the two largest cities in the index sit past it (الرياض 74,724
// rows, جدة 44,533). Measured live on production that day, الرياض/37,532 matching: the second press
// fired 50 RPC searches over 3.5 minutes, hit the backstop, and RETURNED — discarding all 50 pages
// it had just fetched — leaving the user on 100 cards with «حاول مرة ثانية بعد لحظات», permanently,
// because nothing about the turn's state had advanced.
//
// A page count whose adequacy depends on a constant in a DIFFERENT file is a comment, not a
// guarantee. Both numbers live here now and the relationship is arithmetic a barrier EXECUTES.

/** The row page size `loadMoreListings` asks the backend for (src/store.tsx). ONE definition. */
export const LOAD_MORE_PAGE_SIZE = 500;

/** How many rows ONE «عرض المزيد» press may pull before it stops and hands the choice back. */
export const DRAIN_ROW_BUDGET = 25_000;

// ── THE REVEAL CEILING — the product physically cannot render an unbounded result set ────────────
// MEASURED ON PRODUCTION, 2026-09-12, unmodified code. The results list is UNVIRTUALIZED, so a
// press that reveals its whole matched set mounts one card component per match:
//     الخبر        5,706 matching → press 2 drains ~10 pages in 82s and reveals all 5,706. Fine.
//     الرياض/إيجار/سنوي 20,782    → press 2 drains 40 pages and the RENDERER PROCESS CRASHES.
// The JS heap sat flat at ~195 MB through the entire fetch, so this is not the rows — it is mounting
// ~20,000 cards at once. A user on the single most common search in the product who presses
// «عرض المزيد» twice gets a dead tab.
//
// So the owner's 2026-09-11 rule — a later press "drains every remaining page and finishes the
// search" — holds wherever it CAN hold, and stops short of a crash where it cannot. A press reveals
// at most DRAIN_REVEAL_MAX new cards; if matches remain, «عرض المزيد» stays offered and the search
// is NOT marked finished, so nothing is lost and the user keeps browsing. Rows already buffered
// make the next press instant — it reveals from memory before asking the network for anything.
// Every cohort at or under this ceiling still drains and finishes in ONE press exactly as before,
// which is the common case.
//
// THE NUMBER IS A SAFETY CEILING, NOT A UX PREFERENCE, and it is deliberately conservative: the one
// size proven to render is 5,706 on a 4-core/16 GB container, and real users are on phones that will
// give out far earlier. 2,000 keeps a 2.8× margin under the only measured-good point while staying
// 20× BROWSE_BATCH. The real answer is a virtualized list; until then this is the bound that keeps
// the tab alive. Revisit it with a measurement, never with a guess.
export const DRAIN_REVEAL_MAX = 2_000;

/** Pages one press may walk = the row budget over the page size actually used. Never a bare count. */
export function drainPageBudget(pageSize: number, rowBudget: number = DRAIN_ROW_BUDGET): number {
  const size = Math.max(1, Math.floor(pageSize));
  const rows = Math.max(0, Math.floor(rowBudget));
  return Math.max(1, Math.ceil(rows / size));
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NEVER PROMISE A BUTTON THAT IS NOT ON SCREEN (2026-09-05, §42 visible output contract).
//
// The closing sentence used to be worded from `endKind` and "could we narrow further?" alone, while
// the buttons it names carry TWO further gates the wording never saw:
//   • `isLatestResults` — only the NEWEST results turn keeps live actions (owner 2026-08-24), so
//     every earlier turn in a multi-search chat kept an offer it could no longer honour.
//   • `!ageFlow` — the whole actions row is hidden while the Advanced Filter interview is open
//     (owner 2026-08-21), because the AF card is an absolute overlay and buttons underneath it are
//     unreachable.
//
// Measured in production 2026-09-05 (الرياض/بيع/فيلا, then one AF answer): the page held two visible
// closing lines promising «تبي أعرض لك المزيد؟» over 11,254 and 5,970 matches, and
// `[data-testid="results-load-more"]` matched ZERO elements. Both COUNTS were exactly right — only
// the offer was false.
//
// So the offer is decided here, from the same booleans the Pressables are gated on, and the caller
// maps the returned KEY to its translation. The key — not the translated string — keeps this module
// free of a translation table (its original design note) while making the whole decision pure,
// exhaustively testable, and impossible to get right in speech and wrong in text.
//
// This does NOT decide whether «عرض المزيد» should be available during an open AF interview; that is
// the owner's 2026-08-21 call. It only makes the sentence tell the truth about what is rendered.

/** The i18n keys the closing sentence can take. Every key that asks a question requires its button. */
export type ClosingNoteKey =
  | 'I showed you the first {shown} of {total} matching listings. Want me to show more, or help you find more precise ones?'
  | 'I showed you the first {shown} of {total} matching listings. Want me to show more?'
  | 'I showed you the first {shown} of {total} matching listings. Want help finding more precise ones?'
  | 'I showed you the first {shown} of {total} matching listings.'
  | 'I showed you the first {n} listings. Want me to show more, or help you find more precise ones?'
  | 'I showed you the first {n} listings. Want me to show more?'
  | 'I showed you the first {n} listings. Want help finding more precise ones?'
  | 'I showed you the first {n} listings.'
  | 'I showed you all {n} matching listings. Want help finding more precise ones?'
  | 'I showed you all {n} matching listings.';

export function closingNoteKey(args: {
  endKind: EndKind;
  /** The whole filter ran server-side, so the exact total may be quoted. */
  quoteTotal: boolean;
  /** A «عرض المزيد» button is ACTUALLY RENDERED right now. */
  offersMore: boolean;
  /** A «خلّنا نحدد الطلب أكثر» button is ACTUALLY RENDERED right now. */
  offersNarrow: boolean;
}): ClosingNoteKey {
  const { quoteTotal, offersMore, offersNarrow } = args;
  if (args.endKind === 'more') {
    if (quoteTotal) {
      if (offersMore && offersNarrow) return 'I showed you the first {shown} of {total} matching listings. Want me to show more, or help you find more precise ones?';
      if (offersMore) return 'I showed you the first {shown} of {total} matching listings. Want me to show more?';
      // No «عرض المزيد» on screen. The counts stay exactly as true as they were; the question goes —
      // but a narrow button that IS rendered still gets its invitation, or the fix would silently
      // retire a working affordance instead of telling the truth about which ones exist.
      if (offersNarrow) return 'I showed you the first {shown} of {total} matching listings. Want help finding more precise ones?';
      return 'I showed you the first {shown} of {total} matching listings.';
    }
    if (offersMore && offersNarrow) return 'I showed you the first {n} listings. Want me to show more, or help you find more precise ones?';
    if (offersMore) return 'I showed you the first {n} listings. Want me to show more?';
    if (offersNarrow) return 'I showed you the first {n} listings. Want help finding more precise ones?';
    return 'I showed you the first {n} listings.';
  }
  // Everything matching is on screen — there is nothing to page, so only the narrow offer can apply.
  return offersNarrow
    ? 'I showed you all {n} matching listings. Want help finding more precise ones?'
    : 'I showed you all {n} matching listings.';
}

/** Does this key ask the user to tap «عرض المزيد»? */
export const keyOffersMore = (k: ClosingNoteKey): boolean => k.includes('Want me to show more');
/** Does this key ask the user to tap «خلّنا نحدد الطلب أكثر»? */
export const keyOffersNarrow = (k: ClosingNoteKey): boolean =>
  k.includes('help you find more precise ones') || k.includes('Want help finding more precise ones');
