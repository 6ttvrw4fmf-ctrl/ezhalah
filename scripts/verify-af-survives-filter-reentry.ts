// A COMMITTED ADVANCED FILTER MUST SURVIVE A RETURN TO THE FILTER SCREEN — Trending included.
//
// THE DEFECT (owner P0, reproduced live on production 2026-09-01, six ways out of six):
//   الرياض / إيجار / سنوي / تجاري / محل  →  566 listings
//   «خلّنا نحدد الطلب أكثر» → «كم عمر العقار؟» → «جديد»  →  243
//   back to «تصفية», press «بحث»  →  566 again, and the captured request body differs from the
//   committed one by EXACTLY one key: `p_is_new_construction` is simply gone.
// It reproduced through a Trending city card, a Trending district card, a Trending card for a
// DIFFERENT city, and with Trending never touched at all — so it was never a Trending bug: every
// path off the results screen rebuilt the search from a shared store that had never been told what
// the interview committed. Trending's own row counts came from that same store, so the numbers it
// advertised were the numbers it delivered — consistently, silently, 2.4x too many. With amenities
// instead of property_age: 248 → 566. The owner also measured the type widening back out to its
// group (2,265) and its category (3,191).
//
// THE OWNER'S BAR, VERBATIM: «Make Trending preserve the exact current: property type, Normal Filter
// state, every committed Advanced Filter predicate, counts, eligible result set. No widening. No
// dropped filters. No stale state.»
//
// WHAT THIS BARRIER EXECUTES. The REAL production functions, never a copy (a stale verbatim copy
// passes while production breaks — 2026-08-29, extractPrice):
//   • sanitizeForFilterRestore   imported from src/lib/searchDefaults.ts
//   • reconcileCommittedAf / certifiedFacets / stripCommittedAf  from src/lib/afCarry.ts
//   • cohortAllows               reached through afCarry, unmocked
//   • every question's apply()   LIFTED out of src/data/advancedFilters.ts (it imports ./remote, so
//                                Node cannot import it; liftSymbols runs the real declarations)
//   • rpcAdvancedFilterParams    lifted out of src/data/remote.ts — the actual RPC shape, so
//                                "no dropped filter" is asserted where the request is built, not on
//                                a rendered string. A UI-text assertion would pass on a page that
//                                merely re-rendered a stale number.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';
import { sanitizeForFilterRestore, AF_PREDICATE_FIELDS } from '../src/lib/searchDefaults.ts';
import { reconcileCommittedAf, certifiedFacets, stripCommittedAf } from '../src/lib/afCarry.ts';
import { COHORT_QUESTIONS } from '../src/lib/afCohorts.ts';
import { CLEAN_MACRO, groupsOf } from '../src/data/propertyTypes.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failed = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ❌ FAIL  ${msg}`); failed++; }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── the real code, lifted ────────────────────────────────────────────────────────────────────────
const QUESTION_CONSTS = [
  'RNPL_QUESTION', 'AGE_QUESTION', 'AMENITIES_QUESTION', 'BATHROOMS_QUESTION', 'FURNISHED_QUESTION',
  'STREET_WIDTH_QUESTION', 'DIRECTION_QUESTION', 'RATING_QUESTION', 'UNIT_SUBTYPE_QUESTION',
];
const lifted = await liftSymbols(
  join(ROOT, 'src/data/advancedFilters.ts'),
  // addAmenities is a plain function two questions use as their whole apply(); the rest are object
  // literals whose members are all lazily evaluated, so they lift with no prelude at all.
  [{ header: 'function addAmenities' }, ...QUESTION_CONSTS.map((header) => ({ header: `const ${header}` }))],
  ['addAmenities', ...QUESTION_CONSTS],
);
type Applier = { id: string; apply: (q: SearchQuery, keys: string[]) => SearchQuery };
const ADVANCED = QUESTION_CONSTS.map((n) => lifted[n] as Applier);
// The SCOPE tier is imported outright — afPlan is pure by design so barriers can execute it.
const { applyScopeAnswer, SCOPE_GROUP_ID, SCOPE_TYPE_ID } = await import('../src/lib/afPlan.ts');
const SCOPE: Applier[] = [
  { id: SCOPE_GROUP_ID, apply: (q, keys) => applyScopeAnswer(SCOPE_GROUP_ID, q, keys) },
  { id: SCOPE_TYPE_ID, apply: (q, keys) => applyScopeAnswer(SCOPE_TYPE_ID, q, keys) },
];
const ALL: Applier[] = [...ADVANCED, ...SCOPE];

const { rpcAdvancedFilterParams } = await liftSymbols(
  join(ROOT, 'src/data/remote.ts'), [{ header: 'export function rpcAdvancedFilterParams' }], ['rpcAdvancedFilterParams'],
) as { rpcAdvancedFilterParams: (q: SearchQuery) => Record<string, unknown> };

// ── the owner's exact scope ──────────────────────────────────────────────────────────────────────
const SHOP: SearchQuery = {
  deal: 'Rent', location: 'الرياض', category: 'Commercial', type: null, detail: null,
  priceInput: '', priceBand: null, rentPeriod: 'annual',
  typeGroups: groupsOf(['Shop']), types: ['Shop'],   // clean keys, exactly as the Filter home sets them
};

console.log('\n── 1. AF_PREDICATE_FIELDS is the WHOLE Advanced Filter surface ──────────────────');
// The carry clears exactly these fields before re-applying the surviving facets. If SearchQuery grows
// a twelfth AF predicate and remote.ts learns to send it but this list does not learn about it, the
// carry would leave a stale predicate behind that no facet justifies — an invisible filter again, by
// omission. Executed against the REAL param builder, so the two cannot drift silently.
const LOADED: SearchQuery = {
  ...SHOP,
  ageMin: 3, ageMax: 5, isNewConstruction: true, amenities: ['elevator', 'parking'], bathMin: 3,
  ratingMin: 9, reviewsMin: 10, unitSubtypes: ['استديو'], furnishedPref: false,
  streetWidthMin: 20, directions: ['شمال', 'غرب'],
};
const loadedParams = rpcAdvancedFilterParams(LOADED);
assert(Object.keys(loadedParams).length === 11, `every AF predicate reaches the RPC (${Object.keys(loadedParams).length} params)`);
assert(same(rpcAdvancedFilterParams(stripCommittedAf(LOADED)), {}),
  'stripCommittedAf() removes EVERY field rpcAdvancedFilterParams can send — no AF predicate outlives the strip');
// furnishedPref:false is a REAL answer (confirmed unfurnished). A strip/carry that only handled
// truthy values would turn it into "no preference" — UNKNOWN manufactured out of a stated No.
assert(loadedParams.p_furnished === false, 'furnishedPref:false is carried as an ANSWER, never collapsed to "no preference"');

console.log('\n── 2. THE OWNER\'S JOURNEY: commit «جديد», return to the Filter screen, search ────');
// The interview commits through the question's OWN apply(), exactly as agent.tsx does.
const ageQ = ADVANCED.find((x) => x.id === 'property_age')!;
const facets = [{ id: 'property_age', keys: ['new'], labels: ['جديد'] }];
const committed = ageQ.apply(SHOP, ['new']);
assert(committed.isNewConstruction === true, 'the interview really committed «جديد» (isNewConstruction:true)');

// agent.tsx's store write: the committed query PLUS the facet receipt that licenses the carry.
const stored = sanitizeForFilterRestore({ ...committed, afFacets: facets });
// The Trending city card writes ONE field and nothing else (index.tsx cityOnPress).
const afterTrendingTap: SearchQuery = { ...stored, location: 'جدة' };
// The Filter screen derives everything it counts, shows and searches from this one call.
const reentry = reconcileCommittedAf(afterTrendingTap, ALL);

assert(same(rpcAdvancedFilterParams(reentry), rpcAdvancedFilterParams(committed)),
  'after a Trending tap the AF params are IDENTICAL to the committed search — p_is_new_construction is not dropped');
assert(reentry.isNewConstruction === true, 'the committed «جديد» predicate is still live');
assert(same(reentry.types, ['Shop']), 'the specific property type is still محل — never folded into its group');
assert(same(reentry.typeGroups, groupsOf(['Shop'])), 'the group is unchanged');
assert(reentry.deal === 'Rent' && reentry.rentPeriod === 'annual' && reentry.category === 'Commercial',
  'the Normal Filter state (deal, period, category) round-trips untouched');
assert(reentry.location === 'جدة', 'the Trending tap itself still takes effect (city changed)');
assert(reentry.afFacets?.length === 1, 'the receipt survives, so the chip stays on screen to remove it');

console.log('\n── 3. EVERY question, on a cohort the registry itself certifies ─────────────────');
// The 2026-09-01 production repro only exercised property_age and amenities. The mechanism is
// field-agnostic — nothing in the store write distinguished one predicate from another — so the
// barrier must be too, or the next question added would be uncovered by construction.
//
// The cohort for each question is DERIVED from COHORT_QUESTIONS, not hand-written: a question is
// tested on a scope the certification registry actually allows it on, so this cannot silently start
// asserting "dropped correctly" the way a wrong fixture would (it did, one revision ago — the first
// draft used the Arabic display name «محل» where the code holds the clean key `Shop`, so
// cohortAllows() refused everything and eight of these checks failed for the wrong reason).
const ANSWER_KEYS: Record<string, string[]> = {
  property_age: ['3_5'], amenities: ['elevator'], rnpl: ['rnpl'], bathrooms: ['3'],
  furnished: ['no'], street_width: ['20'], direction: ['شمال'], rating: ['9.0_rc10'], unit_subtype: ['استديو'],
};
const LEGS = {
  Buy: { deal: 'Buy' as const, rentPeriod: 'annual' as const },
  RentAnnual: { deal: 'Rent' as const, rentPeriod: 'annual' as const },
  RentMonthly: { deal: 'Rent' as const, rentPeriod: 'monthly' as const },
};
/** The first (type, deal-leg) the registry certifies this question for. */
function certifiedScopeFor(id: string): SearchQuery | null {
  for (const [type, cfg] of Object.entries(COHORT_QUESTIONS)) {
    for (const leg of ['RentAnnual', 'Buy', 'RentMonthly'] as const) {
      if (!(cfg[leg] ?? []).includes(id)) continue;
      return {
        ...SHOP, ...LEGS[leg],
        category: (CLEAN_MACRO[type] ?? 'Residential') as SearchQuery['category'],
        typeGroups: groupsOf([type]), types: [type],
      };
    }
  }
  return null;
}
for (const q of ADVANCED) {
  const scope = certifiedScopeFor(q.id);
  if (!scope) { assert(false, `a certified cohort exists for "${q.id}"`); continue; }
  const facet = [{ id: q.id, keys: ANSWER_KEYS[q.id], labels: ['x'] }];
  const answered = q.apply(scope, ANSWER_KEYS[q.id]);
  const wanted = rpcAdvancedFilterParams(answered);
  assert(Object.keys(wanted).length > 0, `"${q.id}" really commits a predicate on its certified cohort`);
  // Re-entry with the cohort UNCHANGED — only the city moved, exactly the Trending city tap.
  const back = reconcileCommittedAf(
    { ...sanitizeForFilterRestore({ ...answered, afFacets: facet }), location: 'جدة' }, ALL);
  assert(same(rpcAdvancedFilterParams(back), wanted),
    `"${q.id}" survives a Trending re-entry with its RPC params byte-identical`);
  // …and no OTHER predicate appeared. A re-entry that invented one would be a filter the user never
  // asked for, which is the same class of lie as dropping one.
  assert(Object.keys(rpcAdvancedFilterParams(back)).length === Object.keys(wanted).length,
    `"${q.id}" re-entry adds nothing the user did not commit`);
  assert(same(back.types, scope.types) && same(back.typeGroups, scope.typeGroups),
    `"${q.id}" re-entry leaves the property type and group exactly as committed`);
}

console.log('\n── 4. AF MAY ONLY EVER NARROW — never widen, never invent ───────────────────────');
// With NO facets, reconcile is the identity. Nothing in the app changes shape until an interview has
// actually committed something.
const plain: SearchQuery = { ...SHOP };
assert(same(reconcileCommittedAf(plain, ALL), plain), 'a query with no committed facets is returned untouched');
assert(same(rpcAdvancedFilterParams(reconcileCommittedAf(plain, ALL)), {}), 'and it sends no AF predicate at all');

console.log('\n── 5. UNKNOWN NEVER BECOMES No: the carry is re-certified, not replayed ─────────');
// The Filter screen can move the cohort under a carried answer. The AF's SQL predicates are
// strict-NULL-excluding, so replaying an answer the NEW cohort never certified deletes every row
// that did not state the attribute. `rating` is Gathern/Monthly-only and is certified for no
// Commercial-Rent-Annual cohort; carrying it onto محل must drop it rather than zero the results.
const ratingFacet = [{ id: 'rating', keys: ['9.0'], labels: ['٩.٠+'] }];
const ratingOnShop = reconcileCommittedAf(
  { ...ALL.find((x) => x.id === 'rating')!.apply(SHOP, ['9.0']), afFacets: ratingFacet }, ALL);
assert(certifiedFacets(SHOP, ratingFacet).length === 0, 'cohortAllows() refuses «rating» for Commercial / Rent-Annual / محل');
assert(ratingOnShop.ratingMin === undefined, 'so the carried ratingMin is DROPPED, not replayed onto an uncertified cohort');
assert(ratingOnShop.afFacets?.length === 0, 'and its chip goes with it — no predicate without a control, no control without a predicate');
// The same answer on the cohort it WAS certified for must survive: a blanket drop would be a
// different bug wearing this fix as a disguise.
const MONTHLY_APT: SearchQuery = { ...SHOP, category: 'Residential', typeGroups: ['Apartments & Units'], types: ['Apartment'], rentPeriod: 'monthly' };
assert(certifiedFacets(MONTHLY_APT, ratingFacet).length === 1, 'the same «rating» answer IS certified for Monthly-Rent Apartment and survives there');

console.log('\n── 6. A SPECIFIC TYPE IS NEVER FOLDED BACK INTO ITS GROUP ───────────────────────');
// The owner measured 566 → 2,265 (whole group) and → 3,191 (whole category). Both come from one
// line: pruneTypesToGroups(q.types, q.typeGroups ?? []) returns null when no group survives, so a
// payload carrying a type and no group had the type silently DELETED at the store boundary.
const typeNoGroup = sanitizeForFilterRestore({ ...SHOP, typeGroups: null });
assert(same(typeNoGroup.types, ['Shop']), 'a type arriving WITHOUT its group survives the store write (was: silently deleted → widened to the category)');
assert(!!typeNoGroup.typeGroups?.length, 'and its group is BACKFILLED from the type, so the type row has its visible control');
// A scope answer committed by the interview is a Normal-tier field with its own control; the carry
// must never clear it, in either direction.
const scopeCommitted = applyScopeAnswer(SCOPE_TYPE_ID, { ...SHOP, types: null, typeGroups: null }, ['Shop']);
const scopeFacet = [{ id: SCOPE_TYPE_ID, keys: ['Shop'], labels: ['محل'] }];
const scopeReentry = reconcileCommittedAf({ ...sanitizeForFilterRestore({ ...scopeCommitted, afFacets: scopeFacet }), location: 'جدة' }, ALL);
assert(same(scopeReentry.types, ['Shop']), 'an AF-committed property type survives the Filter re-entry as a hard predicate');
assert(certifiedFacets({ ...SHOP, category: 'Residential', types: ['Apartment'], typeGroups: ['Apartments & Units'] }, scopeFacet).length === 1,
  'a SCOPE facet is never dropped by cohort re-certification — dropping one would widen past anything the user asked for');

console.log('\n── 7. ONE CONSTRUCTION SITE: counts and results cannot disagree ─────────────────');
// The Trending counts, the district live counts and «بحث» must all be built from the SAME reconciled
// object. This is the rule that makes «counts» and «eligible result set» one requirement instead of
// two — index.tsx binds `query` to the reconciled value once and every consumer reads that name.
const indexTsx = read('src/app/index.tsx');
assert(/const query = useMemo\(\s*\(\) => reconcileCommittedAf\(storeQuery, AF_ALL_QUESTIONS\)/.test(indexTsx),
  'index.tsx derives ONE reconciled `query` and binds it before any consumer');
assert(/const \{ query: storeQuery,/.test(indexTsx),
  'the raw store value is renamed, so a consumer cannot reach the un-reconciled query by accident');
assert(/rpcAllNarrowingParams\(query\)/.test(indexTsx), 'the Trending city counts read the reconciled query');
assert(/const districtNarrowingSig = JSON\.stringify\(\[query\./.test(indexTsx), 'the district live counts read the reconciled query');
assert(/const buildFilterBaseQuery[\s\S]{0,400}\.\.\.query,/.test(indexTsx), '«بحث» is built from the reconciled query');
// rpcAllNarrowingParams is what turns that object into the Trending request; it must keep spreading
// the AF half, or the reconciliation above would be feeding a builder that throws the answers away.
assert(/rpcAllNarrowingParams[\s\S]{0,1400}rpcAdvancedFilterParams\(q\)/.test(read('src/data/remote.ts')),
  'rpcAllNarrowingParams still spreads rpcAdvancedFilterParams — the Trending request carries the AF half');

console.log('\n── 8. THE WRITE THAT WAS MISSING ────────────────────────────────────────────────');
// The whole defect was that agent.tsx never told the store what the interview committed. The write
// must stay attached to the guided branch — the one place every answer, Skip and pill removal funnels
// through — and it must carry the facets, because without them sanitizeForFilterRestore correctly
// drops every predicate and the fix silently reverts to the bug.
const agentTsx = read('src/app/agent.tsx').replace(/^\s*\/\/.*$/gm, '');
assert(/if \(opts\?\.guided\) \{[\s\S]{0,1600}writeFilterStore\(\{ \.\.\.refined, afFacets: opts\.guided\.facets \}\)/.test(agentTsx),
  'runRefine writes the committed query AND its facet receipt into the shared store');
assert((agentTsx.match(/setQuery\(/g) ?? []).length === 1,
  'agent.tsx still has exactly ONE store writer (writeFilterStore), so a second unsanitized one cannot creep back');
assert(/afCarryRef\.current = null;/.test(agentTsx),
  'a new search clears the interview carry — a stale one would outrank the receipt describing THIS search');
assert(/if \(!afCarryRef\.current\?\.facets\.length && inboundAf\.length\)/.test(agentTsx),
  'a Filter search arriving WITH committed answers seeds the round from them (so they are not re-asked, lost from the pills, or unremovable)');

console.log(failed === 0
  ? '\n✅ verify-af-survives-filter-reentry: all checks passed.'
  : `\n❌ verify-af-survives-filter-reentry: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
