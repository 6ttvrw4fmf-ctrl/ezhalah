// How many result cards a results turn reveals BEFORE any «عرض المزيد» press. Pure so a barrier can
// EXECUTE it (never test a copy of production code).
//
// SMALL FINAL SET RENDERS IN FULL (owner 2026-08-30): "I can have 13 results, Ezhalah shows 10 and
// asks me to press عرض المزيد. That is unnecessary." The cutoff is NOT a new number — it is the
// canonical INTERVIEW_STOP_AT (25, R11.1): the same line at which Advanced Filter stops narrowing and
// the set is, by contract, the FINAL one — so there is nothing left for a first page to be a preview
// of. Gated on the HONEST total (quotableTotal: null whenever the RPC count would overstate — client-
// only narrowing, agent-annualized budgets); when it is unknown we fall back to the first page rather
// than reveal a page that might not be the whole set. QUERY_LIMIT (1,500) ≥ 25, so a ≤25 set is always
// fully buffered on page 0: revealing `fetched` IS revealing every match, and resultCounts() then
// reports hasMore=false on its own. Larger sets keep the first-page preview untouched.
export function initialReveal(args: {
  fetched: number; honestTotal: number | null; firstPage: number; stopAt: number;
  /** Distinct platforms with a genuine match in this result set (see distinctPlatformCount). */
  platforms?: number;
}): number {
  const fetched = Math.max(0, Math.floor(args.fetched));
  const { honestTotal, firstPage, stopAt } = args;
  if (honestTotal != null && honestTotal <= stopAt) return fetched;
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
