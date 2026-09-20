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

export function initialReveal(args: {
  fetched: number; honestTotal: number | null; firstPage: number; stopAt: number;
  /** Distinct platforms with a genuine match in this result set (see distinctPlatformCount). */
  platforms?: number;
  /** TRUE when this results turn was produced by a completed Advanced Filter round. */
  afCompleted?: boolean;
}): number {
  const fetched = Math.max(0, Math.floor(args.fetched));
  const { honestTotal, firstPage, stopAt } = args;
  if (honestTotal != null && honestTotal <= stopAt) return fetched;
  if (args.afCompleted) return Math.min(fetched, AF_REVEAL_MAX);
  // THE FIRST SCREEN IS AS WIDE AS THE MARKET (owner PERMANENT rule 2026-09-02).
  // firstPage is a FLOOR, never a cap: reveal max(10, distinct matching platforms) so every platform
  // with a genuine match gets a slot before any platform repeats. Both ordering layers already emit
  // one row per platform first, so this size alone delivers the coverage — measured on production
  // 2026-09-02, the old fixed 10 was erasing 3 platforms from «فلل للبيع في الرياض» (13 matched),
  // 8 from «الرياض / كل السكني» (18), and 23 from «كل السكني للبيع» (33 matched).
  // Still bounded by `fetched`, so it can never claim a row the eligible set does not contain.
  const platforms = Math.max(0, Math.floor(args.platforms ?? 0));
  return Math.min(Math.max(firstPage, platforms), fetched);
}
