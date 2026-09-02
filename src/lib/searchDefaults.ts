// Pure, zero-dependency SearchQuery defaults + the home/filter screen's "does any filter differ from
// default" check. Kept free of src/data/search.ts's heavy runtime imports (locations.ts → JSON +
// @/lib/supabase) so this module's real behavior can be executed and asserted by a plain Node test
// (mirrors src/lib/arabicText.ts's design). Only a TYPE is imported from search.ts — erased at
// compile time, so it adds no runtime dependency. src/data/search.ts re-exports `emptyQuery` from
// here so every existing `import { emptyQuery } from '@/data/search'` call site keeps working
// unchanged; this file is simply where the one definition now lives.

import type { SearchQuery } from '@/data/search';
import type { Deal } from '@/data/taxonomy';
import { groupsMembers, groupsOf, pruneTypesToGroups } from '../data/propertyTypes.ts';

// EVERY SearchQuery field an Advanced Filter answer can write. ONE list, used by both halves of the
// carry: this module copies exactly these into the Filter store (and nothing else), and
// @/lib/afCarry clears exactly these before re-applying the still-certified facets. A per-question
// inverse would be the hand-written drift the repo forbids; kept honest by
// verify-af-survives-filter-reentry.ts, which fails if this set diverges from the AF params
// rpcAdvancedFilterParams() actually sends.
//
// Scope-tier fields (typeGroups/types/type) are deliberately ABSENT: they are Normal-tier fields the
// Filter home renders as its own group/type rows and already ride the allowlist below. Clearing them
// with the AF would widen a specific property type back out to its group — the one direction the
// owner's rule forbids outright.
export const AF_PREDICATE_FIELDS = [
  'ageMin', 'ageMax', 'isNewConstruction', 'amenities', 'bathMin',
  'ratingMin', 'reviewsMin', 'unitSubtypes', 'furnishedPref', 'streetWidthMin', 'directions',
] as const;

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

// ── CATEGORY → GROUP(S) → TYPE(S) (owner decision 2026-08-20) ───────────────────────────────────
// The property scope is chosen in that order, and BOTH the group and the type dimension are
// multi-select. Semantics, permanently:
//   • several groups  = OR  (a listing belongs to one group; AND would always return nothing)
//   • several types   = OR
//   • every OTHER dimension (deal, period, location, price, area, AF answers) stays AND
//
// `typeGroups` REPLACED the old single `typeGroup` string outright — there is no second live field
// and no mirror to drift. Data written before the change (saved searches in storage, a `?filter=`
// URL in flight) still carries the scalar, so it is migrated ON READ by migrateGroups() below, at
// the boundaries where old data can enter (history hydration in store.tsx, the `?filter=` parse in
// agent.tsx, sanitizeForFilterRestore). Everything inside the app sees only `typeGroups`.

// The selected groups as a list. The twin of effectiveTypes(): one code path covers none/one/many,
// so no call site has to branch on arity.
export function effectiveGroups(q: SearchQuery): string[] {
  return q.typeGroups && q.typeGroups.length ? q.typeGroups : [];
}

// The selected clean types as a list: the filter's multi-select (`q.types`), else the single
// `q.type` (agent path) as a 1-element list, else empty. Moved here from src/data/search.ts so the
// pure scope helpers (and their barriers) can execute without that module's runtime import chain;
// search.ts re-exports it, so every existing import keeps working. (2026-08-20)
export function effectiveTypes(q: SearchQuery): string[] {
  if (q.types && q.types.length) return q.types;
  return q.type ? [q.type] : [];
}

// ONE-WAY MIGRATION for data written before typeGroups existed. Old saved searches and old
// `?filter=` payloads carry `typeGroup: 'Villas & Houses'`; without this they would restore with the
// group silently absent — and because the type row is gated on having a selected group, any saved
// `types` would come back as an ACTIVE filter with no visible control to remove it. Accepts the
// legacy shape structurally (the field no longer exists on SearchQuery) and never writes it back.
export function migrateGroups<T extends Partial<SearchQuery>>(raw: T): T {
  const legacy = (raw as { typeGroup?: unknown }).typeGroup;
  const out = { ...raw } as T & { typeGroup?: unknown; typeGroups?: string[] | null };
  delete out.typeGroup;                                   // never carried forward — one field only
  // The two REQUIRED string fields every reader dereferences (`q.location.trim()`,
  // `q.priceInput.match(...)` — 9 sites in src/data/search.ts alone). A payload persisted before a
  // field existed simply lacks the key, and reopening such a saved chat crashed openStatic →
  // filterToChat (2026-08-23). '' is exactly what "absent" means for both (countrywide / no typed
  // price), so filling it cannot change what a replayed search does. Do NOT default any OTHER field
  // here: filling e.g. rentPeriod or category would silently CHANGE a replayed legacy search
  // (verify-legacy-query-defaults.ts pins both directions).
  out.location ??= '';
  out.priceInput ??= '';
  if (out.typeGroups && out.typeGroups.length) return out as T;
  out.typeGroups = typeof legacy === 'string' && legacy ? [legacy] : null;
  return out as T;
}

// Group box tap — add or remove one group, then drop any selected type that no longer belongs to a
// remaining group (owner: "when a group is removed, automatically remove any selected property types
// that are no longer valid"). Pure, so the exact tap sequences are executable in a Node barrier.
//
// What it deliberately does NOT clear: price and area. Those are user-typed and type-independent, and
// with groups now ADDITIVE, wiping a typed price because the user reached for a second group would
// destroy work they never asked to lose. Type-DERIVED state (the single `type`, `detail`, the bedroom
// context) is cleared, because those are only meaningful against a specific type selection.
export function toggleGroup(q: SearchQuery, group: string): SearchQuery {
  const cur = effectiveGroups(q);
  const next = cur.includes(group) ? cur.filter((g) => g !== group) : [...cur, group];
  return {
    ...q,
    typeGroups: next.length ? next : null,
    types: pruneTypesToGroups(q.types, next),
    type: null,
    detail: null,
    contextBeds: null,
    contextBedsList: null,
    contextSize: null,
  };
}

// Category tap. Groups and types belong to ONE category (owner §1: "every group and property type
// shown afterward must belong to that category"), so switching it clears the whole scope below it.
// Pure + exported so a barrier can prove the clear actually happens — the old inline handler wrote
// `typeGroup: null`, which silently became a no-op the moment that field was replaced by typeGroups,
// and the compiler could not catch it through an object spread. (owner 2026-08-20)
export function setCategory(q: SearchQuery, category: string | null): SearchQuery {
  // A SEARCH ALWAYS LANDS ON EXACTLY ONE CATEGORY (owner ruling 2026-08-30). Re-tapping the active
  // category used to DESELECT it (`q.category === category ? null : category`), so the UI could sit
  // in a no-category state. Two reasons that is wrong, one product and one data:
  //
  //   Product: the user asked for a category switch, not a category toggle. Residential and
  //   Commercial are the two worlds the catalogue is divided into; "neither" is not a search anyone
  //   means to run.
  //
  //   Data: that exact null state caused a measured production leak on 2026-07-17 — deselecting sent
  //   p_category:null, which turned the RPC's purity predicate `(p_category IS NULL OR …)` into a
  //   no-op AND short-circuited matchesType() client-side, so BOTH isolation layers were off at once
  //   and 1,202 Commercial-macro rows leaked into a realistic Residential search
  //   (scripts/verify-null-category-purity.ts). impliedCategory() was added to defend against it;
  //   this removes the way to reach it. Defence in depth stays — that barrier is untouched.
  //
  // Re-tap is now a NO-OP rather than a re-select, so an accidental second tap cannot silently wipe
  // the group/type/price scope the user has already built underneath it.
  if (category !== null && q.category === category) return q;
  return {
    ...q,
    category: category as SearchQuery['category'],
    typeGroups: null,
    type: null,
    types: null,
    detail: null,
    contextBeds: null,
    contextBedsList: null,
    contextSize: null,
    areaMin: null,
    areaMax: null,
    priceMin: null,
    priceMax: null,
    priceInput: '',
    priceBand: null,
  };
}

// The type boxes to show for the current group selection: the UNION of every selected group's members.
export function typesForGroups(q: SearchQuery): string[] {
  return groupsMembers(effectiveGroups(q));
}

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
export function sanitizeForFilterRestore(raw: SearchQuery): SearchQuery {
  const base = HOME_DEFAULT_QUERY();
  // Entries saved before typeGroups existed carry the legacy scalar — migrate before reading it, or
  // the group (and therefore the visible type row) would silently vanish on reopen.
  const q = migrateGroups(raw);
  // BACKFILL THE GROUP BEFORE PRUNING THE TYPE (owner P0 2026-09-01). pruneTypesToGroups returns
  // null when no group survives (propertyTypes.ts), so a payload carrying `types: ['محل']` and no
  // typeGroups had its type SILENTLY DELETED here — and the next «بحث» widened from the محل family
  // (566 live) to the whole التجزئة والمكاتب group (2,265) or the whole تجاري category (3,191),
  // exactly the numbers the owner reported. The rule this line enforces is "no type without its
  // visible group box"; deriving the group the types already imply SATISFIES that rule, where
  // deleting the type satisfied its letter by widening the search instead. groupsOf() is the same
  // backfill applyScopeAnswer() already performs, for the same reason.
  // …and read the type through effectiveTypes(), not `q.types` alone. The AI-chat path never writes
  // `q.types`: src/data/agent.ts queryFromBackend is its ONLY property-type writer and it sets the
  // SINGULAR `q.type` (verified — zero `types:` assignments in agent.ts or agent.tsx). Reading only
  // the plural meant every guided round started from a free-text chat stored type=null types=null
  // typeGroups=null — cohortAllows() then refused the carried answer on that type-less query, the
  // predicate AND its chip were both dropped (so the loss was invisible), and «شقة» widened to the
  // whole سكني category. That widening is reachable ONLY through the store write this change added,
  // so it had to be closed here. effectiveTypes() is the existing one-line union of the two fields.
  const typesIn = effectiveTypes(q);
  const groups = q.typeGroups?.length ? q.typeGroups : groupsOf(typesIn);
  // THE ADVANCED FILTER RIDES IF AND ONLY IF ITS FACETS RIDE (owner P0 2026-09-01). The facets are
  // what the Filter home renders as removable chips, so a carried predicate always has a control on
  // screen to see and clear it — the rule this whole allowlist exists for, satisfied rather than
  // bypassed. Without them (a sidebar restore of a foreign conversation, an agent-parsed query) every
  // AF field still resets to default, which is the measured ratingMin ⇒ 0-of-11,552 leak this
  // allowlist was written to stop. @/lib/afCarry then re-checks each carried facet against the
  // CURRENT cohort before it is allowed to narrow anything.
  const af: Partial<SearchQuery> = {};
  if (q.afFacets?.length) {
    af.afFacets = q.afFacets;
    for (const f of AF_PREDICATE_FIELDS) {
      if (q[f] !== undefined) (af as Record<string, unknown>)[f] = q[f];
    }
  }
  return {
    ...base,
    deal: q.deal ?? base.deal,                    // visible: شراء/إيجار toggle (bothDeals is NOT restored)
    location: q.location ?? base.location,        // visible: city field
    locationMatch: q.locationMatch,
    districts: q.districts,                       // visible: district field
    districtLabel: q.districtLabel,
    category: q.category ?? base.category,        // visible: سكني/تجاري
    typeGroups: groups.length ? groups : null,    // visible: group boxes (multi-select)
    // Never restore a type whose group is not also restored — it would be an invisible active filter.
    types: pruneTypesToGroups(typesIn, groups),
    contextBeds: q.contextBeds,                   // visible: bedroom chips
    contextBedsList: q.contextBedsList,
    contextSize: q.contextSize,                   // visible: area context
    areaMin: q.areaMin,                           // visible: area من/إلى
    areaMax: q.areaMax,
    priceMin: q.priceMin,                         // visible: price من/إلى
    priceMax: q.priceMax,
    rentPeriod: validRentPeriod(q.rentPeriod) ?? base.rentPeriod,  // visible: شهري/سنوي
    // Buy+Rent combined multi-select (owner 2026-08-20): visible: شراء/إيجار BOTH-selected state.
    // Unlike bothDeals (deliberately excluded above), dealCombined IS a Filter-UI field the toggle
    // buttons visibly represent, so — unlike bothDeals — it belongs in this allowlist. priceMinRent/
    // priceMaxRent are the Rent-side budget box that only renders (and only means anything) when
    // dealCombined is true; restoring them harmlessly no-ops otherwise.
    dealCombined: !!q.dealCombined,
    priceMinRent: q.priceMinRent,
    priceMaxRent: q.priceMaxRent,
    ...af,                                        // visible: the removable Advanced Filter chips
  };
}

// Owner invariant (2026-08-19): the two period buttons can reach exactly {سنوي}, {شهري}, or
// {سنوي+شهري} — NEVER an empty/neither state. That invariant is enforced at the button-tap level in
// togglePeriodButton() below, but "everywhere this selection state can originate" also means a
// restored/rehydrated query (this function), not just a direct tap — an unvalidated value read back
// from storage/history could otherwise carry something that isn't one of the three valid tokens and
// leave both buttons rendering unselected. Mirrors the same validation `src/data/agent.ts` already
// applies before ever assigning an LLM-parsed rentPeriod (`b.rentPeriod === 'monthly' || ... `).
export function validRentPeriod(v: unknown): 'monthly' | 'annual' | 'both' | undefined {
  return v === 'monthly' || v === 'annual' || v === 'both' ? v : undefined;
}

// Rent-period toggle logic (owner feature 2026-08-19): the UI shows only two independent buttons,
// سنوي (annual) and شهري (monthly) — no third «كلاهما» button — but selecting BOTH must still reach
// the exact same 'both' query value the backend's already-proven كلاهما architecture expects
// (docs/ARCHITECTURE.md §17). Pure/zero-dependency so the exact transition table the owner asked to
// be tested (annual→monthly, monthly→annual, annual→both, monthly→both, both→annual, both→monthly)
// can be asserted directly by a plain Node test, no react-native import chain required.
//
// INVARIANT: at least one of the two buttons must always stay selected — tapping the only currently-
// active one is a no-op (mirrors every other exactly-one-or-more selector in this app; there is no
// valid "no period" state for a Rent search once a period control exists at all).
export function togglePeriodButton(
  current: 'monthly' | 'annual' | 'both',
  which: 'annual' | 'monthly',
): 'monthly' | 'annual' | 'both' {
  const annualOn = current === 'annual' || current === 'both';
  const monthlyOn = current === 'monthly' || current === 'both';
  if (which === 'annual') {
    if (annualOn && monthlyOn) return 'monthly';   // turn سنوي off — شهري stays
    if (annualOn) return current;                  // سنوي is the only one on — no-op, can't reach zero
    return 'both';                                 // سنوي was off (شهري-only) — turn it on
  }
  if (monthlyOn && annualOn) return 'annual';       // turn شهري off — سنوي stays
  if (monthlyOn) return current;                   // شهري is the only one on — no-op
  return 'both';                                    // شهري was off (سنوي-only) — turn it on
}

// Deal toggle logic (owner feature 2026-08-20): mirrors togglePeriodButton exactly, but Deal has no
// spare "both" string value the way rentPeriod does — every existing consumer of q.deal (dozens,
// across search.ts/remote.ts/locations.ts/index.tsx) expects a concrete 'Buy'|'Rent', so combined
// state is carried on the ORTHOGONAL dealCombined flag instead of widening Deal itself. current/next
// are expressed as the same 3-token shape ('Buy'|'Rent'|'Both') the period toggle uses, purely for
// this function's own input/output — dealSelectionFromQuery/ToQuery below convert to and from the
// two real SearchQuery fields it actually populates.
//
// INVARIANT: at least one button always stays selected — tapping the only currently-active one is a
// no-op (same "can't reach zero" rule togglePeriodButton enforces).
export type DealSelection = 'Buy' | 'Rent' | 'Both';

export function toggleDealButton(current: DealSelection, which: 'Buy' | 'Rent'): DealSelection {
  const buyOn = current === 'Buy' || current === 'Both';
  const rentOn = current === 'Rent' || current === 'Both';
  if (which === 'Buy') {
    if (buyOn && rentOn) return 'Rent';   // turn شراء off — إيجار stays
    if (buyOn) return current;            // شراء is the only one on — no-op, can't reach zero
    return 'Both';                        // شراء was off (إيجار-only) — turn it on
  }
  if (rentOn && buyOn) return 'Buy';      // turn إيجار off — شراء stays
  if (rentOn) return current;             // إيجار is the only one on — no-op
  return 'Both';                          // إيجار was off (شراء-only) — turn it on
}

// current selection → the two SearchQuery fields. `deal` stays a concrete Buy/Rent (never 'Both')
// for every existing consumer; dealCombined is the new orthogonal modifier those consumers must
// check FIRST. `keepDeal` (the query's current concrete deal) is the tie-break when selection is
// 'Both' — so toggling one button back OFF restores exactly the button that was still on, not a
// fixed default.
export function dealSelectionToQuery(sel: DealSelection, keepDeal: Deal): { deal: Deal; dealCombined: boolean } {
  return sel === 'Both' ? { deal: keepDeal, dealCombined: true } : { deal: sel, dealCombined: false };
}

export function dealSelectionFromQuery(q: { deal: Deal; dealCombined?: boolean }): DealSelection {
  return q.dealCombined ? 'Both' : q.deal;
}

export function hasActiveFilters(q: SearchQuery): boolean {
  const d = HOME_DEFAULT_QUERY();
  return (
    q.location.trim() !== d.location ||
    q.deal !== d.deal ||
    !!q.dealCombined ||
    !!q.priceMinRent ||
    !!q.priceMaxRent ||
    q.category !== d.category ||
    !!(q.typeGroups && q.typeGroups.length) ||
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
    (q.rentPeriod ?? 'annual') !== d.rentPeriod ||
    // A carried Advanced Filter answer is an active filter like any other (owner P0 2026-09-01):
    // without this, a search narrowed ONLY by the interview came back to the Filter screen with its
    // chips on screen and «مسح الكل» hidden — an active predicate with no way to clear all of it,
    // which is the very state this whole allowlist exists to make impossible.
    !!(q.afFacets && q.afFacets.length)
  );
}
