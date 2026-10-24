// THE SEARCH RPC STOPS PAGING AT OFFSET 25,000 (security cap, migration *_search_page_is_capped.sql, applied
// 2026-10-21): `limit (case when greatest(p_offset, 0) > 25000 then 0 else … end)`. A customer never pages past
// 500, so the cap is invisible in the app — but every robot that walks the WHOLE result set to diff it against an
// independent oracle now stops short on scopes above ~25k rows, and read the unreachable tail as dropped listings.
// Measured 2026-10-23 (af-live-truth-check run 39940963632): Riyadh Buy Villa total 27,349 = oracle, MISSING 1,349
// = 27,349 − 26,000 (PAGE 1000); Apartment/RentAnnual total 28,484 = oracle, MISSING 2,984 = 28,484 − 25,500
// (PAGE 1500). Arithmetic, not a defect — the 2026-09-01 «page shortfall read as MISSING» trap again.
//
// The honest comparison over the cap: the walk must return EXACTLY the reachable rows, every one of them must be
// eligible (EXTRA = 0, checked by the caller), and MISSING must be EXACTLY the unreachable tail — never more.
// One dropped listing inside the window still shows as missing = tail + 1.
export const SEARCH_RPC_MAX_OFFSET = 25000;

/** Rows a walk of `page`-sized calls (offsets 0, page, 2·page, …) can reach for a scope of `total` rows. */
export function reachableRows(total: number, page: number, maxOffset = SEARCH_RPC_MAX_OFFSET): number {
  if (!(page > 0) || !(total >= 0)) return 0;
  const lastOffset = Math.floor(maxOffset / page) * page;   // the deepest offset the RPC still answers
  return Math.min(total, lastOffset + page);
}

/** How many oracle ids a full walk cannot reach (0 when the whole scope is reachable). */
export function unreachableTail(total: number, page: number, maxOffset = SEARCH_RPC_MAX_OFFSET): number {
  return Math.max(0, total - reachableRows(total, page, maxOffset));
}

/** The MISSING verdict, cap-aware: ok only when every missing id is explained by the unreachable tail AND the
 *  walk really returned every reachable row. */
export function missingVerdict(
  missing: number, walkedDistinct: number, total: number, page: number, maxOffset = SEARCH_RPC_MAX_OFFSET,
): { ok: boolean; tail: number; detail: string } {
  const tail = unreachableTail(total, page, maxOffset);
  const reach = reachableRows(total, page, maxOffset);
  const ok = missing === tail && walkedDistinct === reach;
  const detail = tail
    ? `missing=${missing} (unreachable tail past offset ${maxOffset} = ${tail}) walked=${walkedDistinct}/${reach} reachable`
    : `missing=${missing}`;
  return { ok, tail, detail };
}
