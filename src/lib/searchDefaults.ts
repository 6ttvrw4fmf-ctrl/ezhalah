// Pure, zero-dependency SearchQuery defaults + the home/filter screen's "does any filter differ from
// default" check. Kept free of src/data/search.ts's heavy runtime imports (locations.ts → JSON +
// @/lib/supabase) so this module's real behavior can be executed and asserted by a plain Node test
// (mirrors src/lib/arabicText.ts's design). Only a TYPE is imported from search.ts — erased at
// compile time, so it adds no runtime dependency. src/data/search.ts re-exports `emptyQuery` from
// here so every existing `import { emptyQuery } from '@/data/search'` call site keeps working
// unchanged; this file is simply where the one definition now lives.

import type { SearchQuery } from '@/data/search';

// Defaults are Rent + Residential so a bare Search (nothing else chosen) returns residential
// rentals nationwide — the filter only narrows from there, it's never required. (PRD §6.1)
export const emptyQuery = (): SearchQuery => ({
  deal: 'Rent',
  location: '',
  category: 'Residential',
  type: null,
  detail: null,
  priceInput: '',
  priceBand: null,
  rentPeriod: 'annual',
});

// The home/filter screen's (and the store's initial-state) TRUE default (Buy highlighted — user
// request; emptyQuery() itself stays Rent-default for the agent path). "مسح الكل" (Clear All) resets
// to exactly this, not a partial/merged reset, so every field always lands back on a known default.
export const HOME_DEFAULT_QUERY = (): SearchQuery => ({ ...emptyQuery(), deal: 'Buy' });

// True once ANY filter differs from the screen's initial default — drives whether "مسح الكل" is
// shown at all (no clutter on an already-empty filter, matching the existing per-field clear icon's
// own `query.location.length > 0 &&` convention). Covers every SearchQuery field this screen's UI can
// actually set, INCLUDING rentPeriod (2026-07-13 fix — a stale non-default rentPeriod used to be
// able to hide behind an invisible Clear All button; see the Rent/Buy toggle repro in index.tsx).
// STRICT ALLOWLIST for restoring a history item into the shared store the Filter home binds to
// (audit item 2, owner-approved 2026-07-27). An AI-agent search records its FULL parsed query —
// including fields with NO Filter-home control (bothDeals, sources, keywords, proximity, sort,
// count, type, detail, priceInput, priceIsAnnual, amenities, bathMin, ageMin/ageMax,
// isNewConstruction…). Restoring that verbatim used to let those fields silently ride into the
// user's NEXT filter search (e.g. bothDeals:true made a visible «شراء» search return Rent rows).
// Rule: a filter search may inherit ONLY what the Filter UI visibly represents; everything else
// resets to the screen default. The agent replay itself is unaffected — it receives the full
// query via router params, never through this store write.
export function sanitizeForFilterRestore(q: SearchQuery): SearchQuery {
  const base = HOME_DEFAULT_QUERY();
  return {
    ...base,
    deal: q.deal ?? base.deal,                    // visible: شراء/إيجار toggle (bothDeals is NOT restored)
    location: q.location ?? base.location,        // visible: city field
    locationMatch: q.locationMatch,
    districts: q.districts,                       // visible: district field
    districtLabel: q.districtLabel,
    category: q.category ?? base.category,        // visible: سكني/تجاري
    typeGroup: q.typeGroup ?? null,               // visible: group boxes
    types: q.types ?? null,                       // visible: type boxes
    contextBeds: q.contextBeds,                   // visible: bedroom chips
    contextBedsList: q.contextBedsList,
    contextSize: q.contextSize,                   // visible: area context
    areaMin: q.areaMin,                           // visible: area من/إلى
    areaMax: q.areaMax,
    priceMin: q.priceMin,                         // visible: price من/إلى
    priceMax: q.priceMax,
    rentPeriod: q.rentPeriod ?? base.rentPeriod,  // visible: شهري/سنوي
  };
}

export function hasActiveFilters(q: SearchQuery): boolean {
  const d = HOME_DEFAULT_QUERY();
  return (
    q.location.trim() !== d.location ||
    q.deal !== d.deal ||
    q.category !== d.category ||
    (q.typeGroup ?? null) !== null ||
    q.type !== d.type ||
    !!(q.types && q.types.length) ||
    q.detail !== d.detail ||
    !!q.contextBeds ||
    !!(q.contextBedsList && q.contextBedsList.length) ||
    !!q.contextSize ||
    !!q.areaMin ||
    !!q.areaMax ||
    q.priceInput !== d.priceInput ||
    q.priceBand !== d.priceBand ||
    !!q.priceMin ||
    !!q.priceMax ||
    (q.rentPeriod ?? 'annual') !== d.rentPeriod
  );
}
