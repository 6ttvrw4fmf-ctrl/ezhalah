// How many result cards a results turn reveals BEFORE any «عرض المزيد» press. Pure so a barrier can
// EXECUTE it (never test a copy of production code).
//
// SMALL FINAL SET RENDERS IN FULL (owner 2026-08-30): "I can have 13 results, Ezhalah shows 10 and
// asks me to press عرض المزيد. That is unnecessary." The cutoff is NOT a new number — it is the
// canonical INTERVIEW_STOP_AT (25, R11.1): the same line at which Advanced Filter stops narrowing and
// the set is, by contract, the FINAL one — so there is nothing left for a first page to be a preview
// of. Gated on the HONEST total (quotableTotal: null whenever the RPC count would overstate — client-
// only narrowing, agent-annualized budgets); when it is unknown we fall back to the first page rather
// than reveal a page that might not be the whole set. QUERY_LIMIT (1,500) ≥ 50, so a ≤50 set is always
// fully buffered on page 0: revealing `fetched` IS revealing every match, and resultCounts() then
// reports hasMore=false on its own. Larger sets keep the first-page preview untouched.
// AFTER AN ADVANCED FILTER ROUND, STOP MAKING THE USER TAP (owner 2026-09-20): "if user does
// Advanced Filter still there is a lot of listing just show him all up to 400". A user who has just
// answered (or deliberately skipped) a round of questions has already told us what they want — asking
// them to press «عرض المزيد» to see the consequence of their own answers is the same complaint the
// 2026-08-30 rule above fixed for small sets, one size up. So an AF-completed turn reveals up to
// AF_REVEAL_MAX instead of the first-screen width.
//
// IT IS AN ALLOWANCE, NOT A CEILING. Above it the turn keeps its «عرض المزيد» (and «تحديد أكثر» when
// a truthful question remains) exactly as before — nothing is hidden, it is only the TAPPING that is
// removed for the first 400.
//
// IT DOES NOT FINISH THE CHAT. Completion stays where it is — the ≤ INTERVIEW_STOP_AT rule (R11.1)
// alone, checked separately in agent.tsx. Revealing 400 cards says "here is everything you asked
// for", never "this conversation is over" (owner 2026-09-20, asked explicitly).
//
// WHY THE ORDER SURVIVES IT. The reveal is a COUNT, never a re-sort: rows arrive already ordered by
// the five-dimension diversity the owner's permanent rule requires (platform → deal → type →
// district → photos, src/lib/platformDiversity.ts, applied to the whole fetched set — not just the
// first screen), on top of the RPC's own platform round-robin. Revealing 400 walks further down that
// one list, so match-first and every diversity tier hold exactly as they do at 10.
export const AF_REVEAL_MAX = 400;

// HOW MANY CARDS THE OPENING CASCADE PLAYS BEFORE HANDING OFF TO THE SCROLL (owner 2026-09-20).
// A turn ARRIVES with min(initialReveal(...), CASCADE_MAX) cards on screen — about a screenful,
// ~1.5s of animation — and `maybeRevealOnScroll` walks the rest up to initialReveal()'s target as
// the user approaches it. Exported because two barriers and a live journey need the real number:
// re-typing it is how a check ends up asserting a contract production retired (AGENTS.md harness
// note 21). Live journeys must therefore expect a screenful ON ARRIVAL and scroll to reach the
// target — asserting the whole first page renders immediately is the PRE-2026-09-20 contract.
export const CASCADE_MAX = 12;

export function initialReveal(args: {
  fetched: number; honestTotal: number | null; stopAt: number;
  /** Distinct platforms with a genuine match in this result set (see distinctPlatformCount). */
  platforms?: number;
  /** TRUE when this results turn was produced by a completed Advanced Filter round. */
  afCompleted?: boolean;
}): number {
  const fetched = Math.max(0, Math.floor(args.fetched));
  const { honestTotal, stopAt } = args;
  if (honestTotal != null && honestTotal <= stopAt) return fetched;
  if (args.afCompleted) return Math.min(fetched, AF_REVEAL_MAX);
  // THE FIRST SCREEN SHOWS EXACTLY ONE CARD PER MATCHING PLATFORM, NO PADDING (owner PERMANENT
  // rule 2026-09-25, reversing the 2026-09-02 rule below). The 2026-09-02 rule floored the reveal
  // at 10 so a 1-2-platform match still filled a screen — but with few platforms, those extra
  // slots could only come from whichever matching platform had more inventory (round-robin hands
  // the big platform every leftover slot once the small one runs out of rows to contribute). The
  // owner judged that unfair: a platform's SIZE should never buy it more first-screen presence
  // than a platform with just one genuine match. `Math.max(1, ...)` below is a SAFETY floor, not a
  // fairness floor — it only guards a blank first screen if platform-counting ever miscounts as 0
  // while real matches exist; it never pads beyond the platforms actually present. «عرض المزيد»
  // is unchanged and still reveals each platform's real depth (src/data/resultCount.ts) — this
  // only shortens what arrives BEFORE that first tap.
  //
  // ORIGINAL 2026-09-02 RULE, for history: the reveal used to be `max(10, platforms)` because a
  // fixed cap of 10 (before that date) was erasing platforms beyond the 10th entirely — measured
  // on production, it dropped 3 platforms from «فلل للبيع في الرياض» (13 matched), 8 from
  // «الرياض / كل السكني» (18), and 23 from «كل السكني للبيع» (33 matched). That coverage problem
  // is solved a different way now: revealing every matching platform (instead of padding TO 10)
  // already guarantees none is dropped, so the historical floor is no longer needed for coverage
  // either — `platforms` alone (both ordering layers already emit one row per platform first)
  // delivers full coverage whether that number is 2 or 33.
  const platforms = Math.max(0, Math.floor(args.platforms ?? 0));
  return Math.min(Math.max(1, platforms), fetched);
}
