// AN ADVANCED-FILTER ANSWER MUST NOT SURVIVE A SCOPE IT IS NOT CERTIFIED FOR.
//
// ── THE DEFECT (found 2026-09-01, owner property-type audit) ────────────────────────────────────
//
// `SearchQuery` carries ELEVEN Advanced Filter answer fields — ageMin, ageMax, isNewConstruction,
// amenities, bathMin, ratingMin, reviewsMin, unitSubtypes, furnishedPref, streetWidthMin,
// directions. Nothing anywhere cleared a single one of them when the user changed scope:
//
//   src/lib/searchDefaults.ts  setCategory()  resets 13 fields — none of the 11.
//                              And R1.1.1 says a category switch "CLEARS everything beneath it".
//   src/app/index.tsx ~1580    the type toggle resets types/type/detail/priceBand/contextBeds*
//                              — none of the 11.
//
// So: answer «كم دورة مياه تفضل؟ ٣+» on an Apartment search, go back, switch to Commercial, pick
// أرض تجارية — and `bathMin: 3` is still on the query. Land rows have NULL bathrooms and the shared
// clause is strict-NULL-EXCLUDING, so the search silently amputates almost everything, with no AF
// pill on the Filter home to explain why (that scope cannot even offer the question). The user sees
// "there is nothing here" about an inventory of thousands.
//
// Every transition the owner named is the same shape: Apartment→Villa, Villa→Land, Shop→Office,
// single→multi type, multi→remove one, Buy→Rent, Annual→Monthly.
//
// ── WHY THE PRUNE LIVES AT THE REQUEST BOUNDARY ─────────────────────────────────────────────────
//
// Pruning only in the Filter screen would fix the screen, not the product: the same query object is
// also mutated by the AI chat, by reopening a saved chat from the sidebar, by a Trending
// click-through, and by Load-More pagination. Each is a separate path that would have to remember.
// `rpcFilterParams()` / `rpcCountFilterParams()` in src/data/remote.ts is the ONE place every search
// and every count passes through, so enforcing it there covers all of them at once and cannot be
// forgotten by a future call site.
//
// This is deliberately a SAFETY NET, not a substitute for correct state: it guarantees the RESULTS
// are honest. The UI should still prune its own state so the pills agree — but if it ever fails to,
// the user still gets the right listings rather than a silent amputation.
//
// ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
//
// An answer survives iff `cohortAllows(q, id)` — the ONE certified registry that both the manual AF
// UI and the AI chat gate on. Nothing here decides certification on its own; if it did, it would
// become another opinion about what is askable, which is exactly the duplicate-map failure that
// src/lib/ageFilterTypes.ts was deleted for on 2026-09-01.

import type { SearchQuery } from '@/data/search';
import { cohortAllows, partitionRequestedAmenities } from './afCohorts.ts';

/** Which query fields each AF question owns. Amenity TOKENS are handled separately below, because
 *  two different questions (`amenities` and `rnpl`) both write into the one `amenities` array. */
const ANSWER_FIELDS: Record<string, readonly (keyof SearchQuery)[]> = {
  property_age: ['ageMin', 'ageMax', 'isNewConstruction'],
  bathrooms: ['bathMin'],
  furnished: ['furnishedPref'],
  street_width: ['streetWidthMin'],
  direction: ['directions'],
  rating: ['ratingMin', 'reviewsMin'],
  unit_subtype: ['unitSubtypes'],
};

const RNPL_TOKENS = new Set(['rnpl', 'rent_now_pay_later']);

/**
 * Drop every Advanced Filter answer the CURRENT scope no longer certifies.
 * Pure, and a no-op when nothing is stale — it returns the identical object so React reference
 * checks and the existing "did the query change" comparisons are unaffected.
 */
export function pruneUncertifiedAdvanced(q: SearchQuery): SearchQuery {
  let out = q;

  for (const [id, fields] of Object.entries(ANSWER_FIELDS)) {
    if (cohortAllows(out, id)) continue;
    for (const f of fields) {
      if (out[f] === undefined || out[f] === null) continue;
      out = { ...out, [f]: null };
    }
  }

  // AMENITY TOKENS ARE PRUNED INDIVIDUALLY, not all-or-nothing. A chip list is per-cohort
  // (COHORT_CHIPS): Office/Shop/Warehouse certify the utility trio, residential cohorts certify a
  // different set, so a token can go stale even while the amenities question itself stays
  // certified for the new scope — e.g. «مصعد» (elevator) held over from an Apartment search into a
  // Shop search, where the chip is not offered and the column is not populated.
  const held = out.amenities ?? [];
  if (held.length) {
    const rnplHeld = held.filter((t) => RNPL_TOKENS.has(t));
    const plainHeld = held.filter((t) => !RNPL_TOKENS.has(t));
    // rnpl is its OWN question with its own gate, so it must not be judged by the amenities gate:
    // partitionRequestedAmenities() returns [] for every token when `amenities` is uncertified,
    // which would wrongly drop a still-certified rnpl answer.
    const keepRnpl = cohortAllows(out, 'rnpl') ? rnplHeld : [];
    const keepPlain = plainHeld.length ? partitionRequestedAmenities(out, plainHeld).certified : [];
    const next = [...new Set([...keepPlain, ...keepRnpl])];
    if (next.length !== held.length) out = { ...out, amenities: next.length ? next : null };
  }

  return out;
}
