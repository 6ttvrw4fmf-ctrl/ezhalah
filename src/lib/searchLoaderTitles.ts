// Pure ordering/inclusion logic for the search-loading headline rotation. Extracted so a barrier can
// execute the REAL expression (scripts/verify-search-loader-scale-numbers.ts) instead of grepping
// source text — the same precedent as lib/platformDiversity.ts being pulled out of remote.ts.
// SearchLoader.tsx does the t()/formatting; this module decides ORDER, which optional lines exist,
// how every live number is worded, and how long each line stays.
//
// THE FUNNEL (owner 2026-10-17: «checking, searching … not giving out facts», with the numbers of
// THIS search inside the actions). Every line is Ezhalah working, and the numbers narrow down the
// way a search really does — all websites → the whole Kingdom → the user's city → their district →
// what they asked for → results:
//   1. نبحث في 148 منصة عقارية…
//   2. نفحص 372,889 إعلان في المملكة…
//   3. نراجع 162,312 إعلان في الرياض…            (only when the search names a known city)
//   4. ندقق في 11,385 إعلان في حي النرجس…         (only when it names a known district)
//   5. نطابق طلبك: شقة للإيجار…
//   6. نجهز النتائج…
// The same component serves the Filter and the AI agent (the agent shows «إزهله يفكر…» until the
// request is understood, then hands the resolved query to this same rotation), so both get it.
//
// THE ONE INVARIANT THIS EXISTS TO PIN: «نجهز النتائج» (preparing) must be LAST no matter which
// optional lines are present, and an optional line whose number is unknown is OMITTED — never shown
// empty, never shown as zero (SOURCE IS TRUTH / a failed fetch is not an empty answer).

export function buildSearchLoaderTitles(parts: {
  search: string;
  checking: string;        // already resolved to the live-count or the static fallback copy
  city: string | null;     // null when the search names no known city, or its count is unknown → OMITTED
  district: string | null; // null when it names no known district, or its count is unknown → OMITTED
  matching: string;
  preparing: string;
}): string[] {
  return [
    parts.search,
    parts.checking,
    ...(parts.city ? [parts.city] : []),
    ...(parts.district ? [parts.district] : []),
    parts.matching,
    parts.preparing,
  ];
}

/**
 * How a live count is worded inside an action line: THE EXACT COUNT, IN DIGITS («372,889»), never a
 * rounded word form («370 ألف») — owner 2026-10-17: «include the actual number … not in word form».
 * Exact is also the simplest truth: no «أكثر من» to keep honest. Unknown or zero → null, line omitted.
 */
export function countWording(count: number | null | undefined, _locale: 'ar' | 'en'): { kind: 'exact'; text: string } | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  return { kind: 'exact', text: Math.trunc(count).toLocaleString('en-US') };
}

// LINE PACE (owner 2026-10-17: the loader may hold results for at most 10 s, and results show as
// soon as they are ready — so the six funnel lines must FIT inside ten seconds, or the personal
// city/district lines are never reached; measured live on 2026-10-17: a Filter search showed only
// three of six lines at the old 1,900–4,200 ms pace). Still reading-proportional (owner 2026-09-12:
// «make it all at the same speed»), just faster: a per-line duration from its length, floored so a
// short line never flashes and capped so no line can hog the rotation.
export const MS_PER_CHAR = 50;
export const MIN_TITLE_MS = 1400;
export const MAX_TITLE_MS = 2000;
/** The whole six-line funnel must fit inside the loader's longest possible hold. */
export const FUNNEL_BUDGET_MS = 10_000;
export function readingDurationMs(title: string): number {
  return Math.min(MAX_TITLE_MS, Math.max(MIN_TITLE_MS, title.length * MS_PER_CHAR));
}
