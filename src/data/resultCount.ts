// THE BROWSE-CONTINUATION RULE (owner 2026-09-14 — re-introduced a DISPLAY CAP, superseding the
// 2026-08-29 no-lifetime-ceiling decision), in ONE place so every surface obeys it and one test locks it.
//
//   «عرض المزيد» gives at most TWO reveals and never shows more than 500. The first tap reaches the
//   100 boundary; the last tap reveals up to the 500 cap and then the button retires. A search with
//   ≤500 matches finishes on whichever tap first shows them all; a bigger one caps at 500, and the
//   TERMINAL state takes over — Advanced Filter (if unseen inventory remains, the >500 case) or a new
//   search from the ☰ menu (everything shown, the ≤500 case).
//     trueTotal =   8 → one tap shows 8, "that is every matching listing (8)"
//     trueTotal = 340 → 100 → 340, "that is every matching listing (340)"
//     trueTotal = 9,892 → 100 → 500, "these are the last 500 I can show — narrow, or a new search"
//   The honesty half is unchanged: numbers are never faked. trueTotal (how many listings satisfy the
//   whole search) and the batch size / cap are DIFFERENT numbers and must never be confused. The
//   closing message states trueTotal (or the honest {shown}=500 at the cap), NEVER a batch size or a
//   buffer length. See the ban list in scripts/verify-result-cap-honesty.ts.
//
// This module is pure (no React, no i18n) so it is trivially unit-tested across every boundary and
// mutation-proven. agent.tsx consumes it for BOTH the reveal targets and the closing message.

export const BROWSE_BATCH = 100;

// The reveal target for one «عرض المزيد» press: the NEXT clean batch boundary (…→100→200→300),
// clamped to what actually exists. From the initial drip (e.g. 10 shown) the first press completes
// the first hundred, not 10+100=110 — the owner's spec is explicit about the boundaries.
export function nextBatchTarget(shown: number, available: number, batch = BROWSE_BATCH): number {
  const s = Math.max(0, Math.floor(shown));
  const boundary = (Math.floor(s / batch) + 1) * batch;
  return Math.min(boundary, Math.max(0, Math.floor(available)));
}

// THE LAST «عرض المزيد» NEVER REVEALS BEYOND THIS (owner 2026-09-14). «عرض المزيد» gives at most TWO
// reveals: the first reaches the 100-boundary (nextBatchTarget), the second reveals up to 500 total
// and STOPS — that second tap is the FINAL one, after which the button is gone and the terminal
// message + Advanced-Filter path take over. A search with ≤500 matches finishes on whichever tap
// first shows them all; a bigger one caps here. 500 also sits far under the ~2,000 unvirtualised-
// render ceiling the old drain had to respect, so it removes the renderer-crash class entirely
// rather than merely staying under it.
export const SECOND_PAGE_CAP = 500;

// How many cards ONE «عرض المزيد» tap reveals, given how many are already shown and the true total.
// Under 100 shown → the next clean 100-boundary; at/after 100 → up to the 500 cap. Both clamped to
// the true total, so a 47-match search finishes in one tap and never over-promises 500.
export function revealTarget(shown: number, total: number): number {
  const s = Math.max(0, Math.floor(shown));
  const ceiling = s < BROWSE_BATCH ? BROWSE_BATCH : SECOND_PAGE_CAP;
  return Math.min(ceiling, Math.max(0, Math.floor(total)));
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

// ── THE REVEAL CEILING is now SECOND_PAGE_CAP (500), defined above ────────────────────────────────
// An unvirtualized list mounts one card per match, so an unbounded reveal crashes the renderer
// (measured on production 2026-09-12: الخبر's 5,706 rendered fine; الرياض/إيجار/سنوي's 20,782 killed
// the tab). The old drain model bounded a single press to a 2,000-card DRAIN_REVEAL_MAX ceiling but
// left the cumulative mount unbounded across presses (ops_incident #212). The owner's 2026-09-14 cap
// closes that class outright: «عرض المزيد» reveals at most 500 cards TOTAL and then retires, and 500
// sits far under the only proven-safe mount size (5,706). Those two production measurements, and the
// proof that the whole press SEQUENCE stays bounded, now live in
// scripts/verify-loadmore-cumulative-mount-is-bounded.ts.

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
  hasMore: boolean;    // a "load more" affordance is legitimate (matches remain beyond `shown`, under the 500 cap)
  endKind: EndKind;    // which closing message the truth calls for
  endTotal: number;    // the number the closing message must state (always trueTotal, never a batch)
  endShown: number;    // how many are on screen
  // TERMINAL because we hit the 500 cap and MORE still matches (owner 2026-09-14) — the state that
  // keeps the Advanced-Filter button. false when the row simply ran out of matches (everything shown).
  cappedAtCap: boolean;
  // The «عرض المزيد» currently offered is the FINAL one — the user has already seen the first 100 and
  // the next tap reveals up to 500 and ends. Drives the "this is the last «عرض المزيد» — up to 500"
  // wording. NOT triggered on a small (≤100) search, where the first tap already shows everything and
  // the plain first-page wording applies.
  lastTapOffer: boolean;
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
  // «عرض المزيد» lives only while shown is under BOTH the 500 cap AND the true total, and the rows to
  // reveal exist (buffered, or the server still has pages). It retires at exactly 500 — there is no
  // third tap (owner 2026-09-14). Below 500 it behaves as before: 100 → (last tap) up to 500.
  const cap = Math.min(SECOND_PAGE_CAP, trueTotal);
  const hasMore = shown < cap && (shown < fetched || args.serverMore);
  const endKind: EndKind = hasMore ? 'more' : 'all';
  // Hit the 500 cap with more still matching → the terminal state that keeps Advanced Filter.
  const cappedAtCap = !hasMore && shown >= SECOND_PAGE_CAP && shown < trueTotal;
  // The currently-offered «عرض المزيد» is the last one: the first 100 is already on screen, so the
  // next tap goes to the 500 cap (or the true end) and finishes. A ≤100 search never reaches this —
  // its one tap shows everything and uses the plain first-page wording.
  const lastTapOffer = hasMore && shown >= BROWSE_BATCH;
  return { reachable: trueTotal, hasMore, endKind, endTotal: trueTotal, endShown: shown, cappedAtCap, lastTapOffer };
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
  | 'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}, or help you find more precise ones.'
  | 'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}.'
  | 'I showed you the first {shown} of {total} matching listings. Want help finding more precise ones?'
  | 'I showed you the first {shown} of {total} matching listings.'
  | 'I showed you the first {n} listings. Want me to show more, or help you find more precise ones?'
  | 'I showed you the first {n} listings. Want me to show more?'
  | 'I showed you the first {n} listings. Want help finding more precise ones?'
  | 'I showed you the first {n} listings.'
  // THE FINAL «عرض المزيد» (owner 2026-09-14): once the first 100 is on screen, the next tap is the
  // last and reveals up to 500. Two variants — with the narrow offer, and without it.
  | 'We still have more for you. Showing {shown} of {total}. This is the last «عرض المزيد» — up to 500 at once. Want me to show more, or help you find more precise ones?'
  | 'We still have more for you. Showing {shown} of {total}. This is the last «عرض المزيد» — up to 500 at once. Want me to show more?'
  // TERMINAL, everything shown (≤500): no «عرض المزيد», no narrow — start a new search from the menu.
  | 'That is every matching listing ({n}). For a new search, open the menu and choose Search.'
  // TERMINAL, capped at 500 with more in the set: keep Advanced Filter (with the narrow offer), or a
  // new search from the menu. Second variant for when no useful narrowing question remains.
  | 'These are the last {shown} I can show you. Want help finding more precise ones? Or open the menu for a new search.'
  | 'These are the last {shown} I can show you. For a new search, open the menu and choose Search.'
  // RETIRED from closingNoteKey's own returns (the two above replace them, owner 2026-09-14) but kept
  // as valid ClosingNoteKey values: their i18n rows and a couple of history/CTA barriers still name them.
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
  /** The «عرض المزيد» currently shown is the FINAL one (up to 500) — see ResultCounts.lastTapOffer. */
  lastTapOffer: boolean;
  /** TERMINAL because the 500 cap was hit with more still matching — see ResultCounts.cappedAtCap. */
  cappedAtCap: boolean;
}): ClosingNoteKey {
  const { quoteTotal, offersMore, offersNarrow, lastTapOffer, cappedAtCap } = args;
  if (args.endKind === 'more') {
    // THE FINAL «عرض المزيد» — the first 100 is on screen and the next tap reveals up to 500 and ends
    // (owner 2026-09-14). Only when a «عرض المزيد» is genuinely rendered; the narrow variant follows
    // whether «تحديد أكثر» is on screen too (offersNarrow), so the sentence never names a missing one.
    if (offersMore && lastTapOffer) {
      return offersNarrow
        ? 'We still have more for you. Showing {shown} of {total}. This is the last «عرض المزيد» — up to 500 at once. Want me to show more, or help you find more precise ones?'
        : 'We still have more for you. Showing {shown} of {total}. This is the last «عرض المزيد» — up to 500 at once. Want me to show more?';
    }
    if (quoteTotal) {
      // THE NEXT NUMBER IS STATED, AND IT IS THE REAL ONE (owner 2026-09-13). The Arabic used to end
      // «إذا عرضت لك المزيد بعرض لك كل الإعلانات» — one tap shows ALL — which is false: a tap advances
      // to the next BROWSE_BATCH boundary, clamped to what exists. A hardcoded «100» would be just as
      // wrong in the other direction ("it would be funny if you say 100 and you would only show him
      // 20"): at trueTotal 47 the tap reveals 47, not 100. The caller passes nextBatchTarget(), the
      // same function the button itself pages with, so the sentence and the tap can never disagree.
      if (offersMore && offersNarrow) return 'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}, or help you find more precise ones.';
      if (offersMore) return 'I showed you the first {shown} of {total} matching listings. Want me to show more? I will show the first {next}.';
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
  // TERMINAL (endKind 'all'), owner 2026-09-14. Two shapes:
  //   • capped at 500 with more still matching → keep Advanced Filter (narrow), or a new search.
  //   • everything shown (≤500) → nothing left to page OR narrow; point to a new search via the menu.
  if (cappedAtCap) {
    return offersNarrow
      ? 'These are the last {shown} I can show you. Want help finding more precise ones? Or open the menu for a new search.'
      : 'These are the last {shown} I can show you. For a new search, open the menu and choose Search.';
  }
  return 'That is every matching listing ({n}). For a new search, open the menu and choose Search.';
}

/** Does this key ask the user to tap «عرض المزيد»? */
export const keyOffersMore = (k: ClosingNoteKey): boolean => k.includes('Want me to show more');
/** Does this key ask the user to tap «خلّنا نحدد الطلب أكثر»? */
export const keyOffersNarrow = (k: ClosingNoteKey): boolean =>
  k.includes('help you find more precise ones') || k.includes('Want help finding more precise ones');
