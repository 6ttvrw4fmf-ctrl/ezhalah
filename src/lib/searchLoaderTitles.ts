// Pure ordering/inclusion logic for the search-loading headline rotation (owner 2026-09-12: three of
// the six lines carry a live "big database" number — see SearchLoader.tsx's SEARCH_TITLES comment).
// Extracted so a barrier can execute the REAL expression (scripts/verify-search-loader-scale-numbers.ts)
// instead of grepping source text — the same precedent as lib/platformDiversity.ts being pulled out
// of remote.ts for the same reason. SearchLoader.tsx does the t()/grouped() translation+formatting;
// this function only decides ORDER and whether the coverage line is present at all.
//
// THE ONE INVARIANT THIS EXISTS TO PIN: «نجهز النتائج» (preparing) must be LAST no matter whether
// the coverage line is included — a future edit that appends something after it, or that puts the
// optional line last instead of second-to-last, is exactly the kind of off-by-one a source-text
// grep would miss.
export function buildSearchLoaderTitles(parts: {
  search: string;
  checking: string;   // already resolved to either the live-count or the static fallback copy
  matchFilters: string;
  reviewing: string;  // already resolved to either the live-count or the static fallback copy
  coverage: string | null; // null when scale stats haven't resolved — the line is OMITTED, never shown empty/zero
  preparing: string;
}): string[] {
  return [
    parts.search,
    parts.checking,
    parts.matchFilters,
    parts.reviewing,
    ...(parts.coverage ? [parts.coverage] : []),
    parts.preparing,
  ];
}
