import type { SearchQuery } from '@/data/search';

// WHEN ARE TWO SAVED SEARCHES THE SAME SEARCH?
//
// The sidebar de-dupes history by the QUERY, not the label: re-running a search you already have
// must update that one chat (keeping its id and its star) instead of forking a second copy. That
// rule is right and stays. What was wrong was the comparison behind it.
//
// THE DEFECT (owner decision 2026-08-20, "reopening saved history restores exact filters — no
// stale/mismatched filters"). store.tsx's sameQuery() hand-listed 17 of SearchQuery's 41 fields, so
// every field it forgot made two genuinely different searches look identical — the newer one
// overwrote the older entry's query and label, and the older search vanished from the sidebar with
// no way to reopen it. Measured against the shipped comparison, 15/15 of these collapsed into ONE
// entry, including every case the owner named:
//   سنوي vs شهري · سنوي vs كلاهما · شهري vs كلاهما · إيجار vs إيجار+شراء
//   Advanced Filter: furnished · amenities · bathMin · ratingMin · reviewsMin · unitSubtypes
//                    streetWidthMin · directions · ageMax · isNewConstruction · platform sources
//
// THE FIX IS THE DIRECTION OF THE LIST, not a longer list. Comparing an allowlist means the next
// field added to SearchQuery is silently excluded and the bug returns. So identity now compares
// EVERYTHING except an explicit, justified ignore list, and verify-saved-search-identity.ts fails
// the build if any SearchQuery key is neither compared nor listed below — a new field must be
// classified by a human, not defaulted into invisibility.
//
// Only strictness changes: every field the old comparison checked is still checked, so this can
// never merge two entries that used to be separate. It can only keep separate what was being lost.

/**
 * Fields deliberately EXCLUDED from saved-search identity.
 *
 * The bar is high and specific: a field may be ignored only if it cannot change which listings the
 * search returns AND it can legitimately differ between two runs of the same user search. Anything
 * that fails the second half would make re-running an identical search fork a duplicate entry and
 * silently drop the user's star — the bug the de-dupe exists to prevent.
 */
export const SAVED_SEARCH_IGNORED_KEYS: Readonly<Record<string, string>> = Object.freeze({
  districtListingCount:
    'A LIVE count read from district_options_ar at search time. It moves as inventory moves, so ' +
    'comparing it would fork a new entry for the same search every time the district gained a listing.',
  locationMatch:
    'The resolver’s explanation of what it understood, derived from `location` + `districts` — both ' +
    'of which ARE compared. It can carry live counts and re-resolution detail, so it is descriptive ' +
    'output, never an input the user chose.',
  districtLabel:
    'Display spelling of the district already compared via `districts`; purely for the summary line.',
  priceOriginal:
    'Display-only echo of a foreign-currency budget ("USD 100,000"); the SAR figure it converts to ' +
    'is compared through priceInput/priceMin/priceMax.',
});

/** Every SearchQuery key that participates in identity is everything MINUS the ignore list. */
export function savedSearchComparedKeys(sample: SearchQuery): string[] {
  return Object.keys(sample).filter((k) => !(k in SAVED_SEARCH_IGNORED_KEYS)).sort();
}

// Canonicalise one value so cosmetic differences never fork an entry:
//   • undefined and null are the same "not set" (the filter writes both in different paths);
//   • strings are trimmed, and '' collapses to null (an emptied input is not a different search);
//   • arrays of primitives are order-insensitive — picking حي A then حي B is the same search as
//     B then A, and the RPC ORs them either way;
//   • empty arrays collapse to null (no selection).
function canon(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') { const t = v.trim(); return t === '' ? null : t; }
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const items = v.map(canon);
    const primitive = items.every((x) => x === null || typeof x !== 'object');
    return primitive
      ? [...items].sort((a, b) => String(a).localeCompare(String(b)))
      : items;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      const c = canon(o[k]);
      if (c !== null) out[k] = c;
    }
    return out;
  }
  return v;
}

/**
 * A stable string that is equal for exactly those queries the product considers the same saved
 * search. Stable across key order, so it is also safe to persist or log.
 */
export function savedSearchIdentity(q: SearchQuery): string {
  const src = q as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) {
    if (k in SAVED_SEARCH_IGNORED_KEYS) continue;
    const c = canon(src[k]);
    if (c !== null) out[k] = c;          // absent === not set, so both shapes hash alike
  }
  return JSON.stringify(out);
}

/** Do these two queries represent the SAME entry in the user's sidebar history? */
export function isSameSavedSearch(a: SearchQuery, b: SearchQuery): boolean {
  return savedSearchIdentity(a) === savedSearchIdentity(b);
}
