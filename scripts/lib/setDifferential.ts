// COMPARING TWO RESULT SETS BY COUNT IS NOT COMPARING THEM.
//
// WHY THIS EXISTS (ops_incident #221, self-reported by routine #9 on 2026-09-12, repaired by
// routine #10 on 2026-09-13).
//
// scripts/redteam-chain-live.mjs is routine #9's eight-layer chain driver. Its L4 layer builds an
// INDEPENDENT PostgREST oracle set of `(source_table, listing_id)` pairs — and then compared it to
// the RPC's L6 response by COUNT alone, on every chain it has ever run. The id set it had already
// paid to build was never differenced against anything except the *paginated* L8 responses.
//
// A dropped row plus an added row cancel out EXACTLY in a count comparison. This repo already knows
// that: scripts/verify-trending-set-equals-the-click-live.ts exists because "every other Trending
// barrier compares COUNTS, and a dropped row plus an added row cancel out in every one of them."
// The same blind spot had quietly reopened in the instrument built to catch it.
//
// So the differential lives here, once, as a pure function both callers can use and a barrier can
// feed broken input — rather than as an inline comparison in a browser-driving script that nothing
// can execute offline.
//
// THE PARTIAL-PAGE RULE, stated rather than hidden. A first response is often a PAGE, not the whole
// cohort. Reporting every unreturned row as "missing" would make the differential scream on every
// healthy paged search, and a check that cries wolf gets weakened until it says nothing. So
// `missing` is only computed when the response is claimed to hold the whole set — `got.length >=
// truthCount`. `extra` and `duplicates` are ALWAYS computed, because neither is ever excusable: a
// page may be short, but it may never contain a row outside the truth set, and it may never contain
// the same row twice.

export type Differential = {
  /** In the truth set but absent from the response. Only meaningful for a complete response. */
  missing: string[];
  /** In the response but NOT in the independent truth set — never excusable, page or not. */
  extra: string[];
  /** How many response rows are repeats — never excusable, page or not. */
  duplicates: number;
  /** False when the response is a partial page, so `missing` was deliberately not computed. */
  missingComputed: boolean;
};

/**
 * Differences a returned id list against an independent truth set.
 *
 * @param got         the response's ids, IN ORDER and WITH repeats — never a Set, or `duplicates`
 *                    would be unmeasurable by construction.
 * @param truth       the independent oracle's id set.
 * @param truthCount  the oracle's own count, which may exceed `truth.size` when the set was capped.
 */
export function setDifferential(got: string[], truth: Set<string>, truthCount: number): Differential {
  const gotSet = new Set(got);
  const complete = got.length >= truthCount;
  return {
    extra: got.filter((k) => !truth.has(k)),
    missing: complete ? [...truth].filter((k) => !gotSet.has(k)) : [],
    duplicates: got.length - gotSet.size,
    missingComputed: complete,
  };
}

/** A clean differential: nothing outside the truth set, nothing repeated, nothing dropped. */
export const differentialIsClean = (d: Differential): boolean =>
  d.missing.length === 0 && d.extra.length === 0 && d.duplicates === 0;

/** One-line summary for a check's failure detail. */
export const describeDifferential = (d: Differential): string =>
  `missing=${d.missingComputed ? d.missing.length : 'n/a (partial page)'} `
  + `extra=${d.extra.length} duplicates=${d.duplicates}`;
