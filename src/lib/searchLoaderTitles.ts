// Pure ordering/inclusion logic for the search-loading headline rotation. Extracted so a barrier can
// execute the REAL expression (scripts/verify-search-loader-scale-numbers.ts) instead of grepping
// source text — the same precedent as lib/platformDiversity.ts being pulled out of remote.ts.
// SearchLoader.tsx does the t()/formatting; this module decides ORDER, which optional lines exist,
// and how every live number is worded.
//
// THE FUNNEL (owner 2026-10-17: «checking, searching … not giving out facts», with the numbers of
// THIS search inside the actions). Every line is Ezhalah working, and the numbers narrow down the
// way a search really does — all websites → the whole Kingdom → the user's city → their district →
// what they asked for → results:
//   1. نبحث في 149 منصة عقارية…
//   2. نفحص أكثر من 370 ألف إعلان في المملكة…
//   3. نراجع أكثر من 160 ألف إعلان في الرياض…          (only when the search names a known city)
//   4. ندقق في أكثر من 11 ألف إعلان في حي النرجس…       (only when it names a known district)
//   5. نطابق طلبك: شقة للإيجار…
//   6. نجهز النتائج…
// The same component serves the Filter and the AI agent (the agent shows «إزهله يفكر…» until the
// request is understood, then hands the resolved query to this same rotation), so both get it.
//
// THE ONE INVARIANT THIS EXISTS TO PIN: «نجهز النتائج» (preparing) must be LAST no matter which
// optional lines are present, and an optional line whose number is unknown is OMITTED — never shown
// empty, never shown as zero (SOURCE IS TRUTH / a failed fetch is not an empty answer).
import { moreThan } from './filterWelcome.ts';

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
 * How a live count is worded inside an action line. ≥1,001 → «أكثر من» with a number rounded DOWN
 * strictly below the truth (moreThan); 1..1,000 → the exact count (a small town's 300 listings are
 * worth saying, and "more than 200" would undersell them); unknown/zero → null, line omitted.
 */
export function countWording(count: number | null | undefined, locale: 'ar' | 'en'): { kind: 'more' | 'exact'; text: string } | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  const more = moreThan(count, locale);
  if (more) return { kind: 'more', text: more };
  return { kind: 'exact', text: Math.trunc(count).toLocaleString('en-US') };
}

// READING-PACE ROTATION (owner 2026-09-12: "I feel like it's a bit fast... make it all at the same
// speed"). A PER-LINE duration proportional to its length, so every line gets roughly the same
// time-per-character — "the same speed" in the sense the owner meant it, not the same millisecond
// count. MS_PER_CHAR/MIN/MAX are tuned so short lines land close to the old 2400ms floor while long
// live-number lines get proportionally more, capped so no single line stalls the rotation.
const MS_PER_CHAR = 90;
const MIN_TITLE_MS = 1900;
const MAX_TITLE_MS = 4200;
export function readingDurationMs(title: string): number {
  return Math.min(MAX_TITLE_MS, Math.max(MIN_TITLE_MS, title.length * MS_PER_CHAR));
}
