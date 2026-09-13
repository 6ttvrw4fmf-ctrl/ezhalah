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

// READING-PACE ROTATION (owner 2026-09-12: "I feel like it's a bit fast... make it all at the same
// speed"). The rotation used to sit on one fixed interval (2400ms) for every line — genuinely
// identical ON-SCREEN TIME per line, but NOT identical READING speed: the live-number lines this
// same session added ("نغطي أكثر من 4,027 موقع...") are much longer than the original short phrases
// ("نطابق الفلاتر"), so the same fixed window reads as rushed for the long ones and idle for the
// short ones. This computes a PER-LINE duration proportional to its length, so every line gets
// roughly the same time-per-character to read — "the same speed" in the sense the owner meant it,
// not the same millisecond count. MS_PER_CHAR/MIN/MAX are tuned so the original short lines land
// close to the old 2400ms floor (no perceptible slowdown for those) while the new long lines get
// proportionally more, capped so no single line can stall the rotation for multiple seconds.
const MS_PER_CHAR = 90;
const MIN_TITLE_MS = 1900;
const MAX_TITLE_MS = 4200;
export function readingDurationMs(title: string): number {
  return Math.min(MAX_TITLE_MS, Math.max(MIN_TITLE_MS, title.length * MS_PER_CHAR));
}
