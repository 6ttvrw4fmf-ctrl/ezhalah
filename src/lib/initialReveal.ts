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
export function initialReveal(args: { fetched: number; honestTotal: number | null; firstPage: number; stopAt: number }): number {
  const fetched = Math.max(0, Math.floor(args.fetched));
  const { honestTotal, firstPage, stopAt } = args;
  if (honestTotal != null && honestTotal <= stopAt) return fetched;
  return Math.min(firstPage, fetched);
}
