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
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { liftSymbols } from './lib/liftSymbols.ts';
import { stripComments } from './lib/stripComments.ts';
import { sanitizeForFilterRestore, AF_PREDICATE_FIELDS, toggleGroup, setCategory } from '../src/lib/searchDefaults.ts';
import { reconcileCommittedAf, certifiedFacets, stripCommittedAf, withoutFacet } from '../src/lib/afCarry.ts';
import { COHORT_QUESTIONS, certifiedAmenityKeys, cohortAllows } from '../src/lib/afCohorts.ts';
import { CLEAN_MACRO, groupsOf } from '../src/data/propertyTypes.ts';
import type { SearchQuery } from '../src/data/search.ts';

const ROOT = join(import.meta.dirname, '..');
// EVERY source read here is comment-STRIPPED, at the reader, so no individual assertion can forget.
// Three of the shape assertions below rode a raw read and were therefore satisfiable by a comment —
// including the two that pin this PR's most load-bearing wiring, which stayed green (285/285) with
// the reconciliation disabled and the chip «×» turned into a no-op, each with the original line
// restored as a decoy comment. See scripts/lib/stripComments.ts.
const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

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
  // literals whose members are all lazily evaluated, so apply() needs no prelude at all.
  [{ header: 'function addAmenities' }, ...QUESTION_CONSTS.map((header) => ({ header: `const ${header}` }))],
  ['addAmenities', ...QUESTION_CONSTS],
  // §12 also CALLS AMENITIES_QUESTION.resolveOptions, to read the token set the card can offer from
  // the question itself rather than hand-listing it here. Its cohort logic is imported REAL; only
  // the count path is shimmed — counts decide how many offered options are worth SHOWING, never
  // which tokens may be offered, so the identity shim yields the superset (the fail-closed side).
  [
    `import { cohortAllows, scopeCleanTypes, intersectChips } from ${JSON.stringify(pathToFileURL(join(ROOT, 'src/lib/afCohorts.ts')).href)};`,
    'type GuidedCounts = Record<string, number>;',
    'const fetchApartmentGuidedCounts = async (_q: unknown) => ({} as GuidedCounts);',
    'const guidedOptions = (_c: unknown, defs: Array<{ key: string }>) => ({ options: defs.map((d) => ({ key: d.key })) });',
  ].join('\n'),
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
// THE SET IS DERIVED FROM THE BUILDER, NOT COUNTED OFF A FIXTURE. This used to be
// `Object.keys(loadedParams).length === 11` over the hand-written LOADED above, which only fires if
// whoever adds a 12th predicate also remembers to add it to that fixture — the "remembering" this
// repo's rules exist to delete. Proven blind: adding poolMin → p_pool_min to remote.ts and search.ts
// and leaving AF_PREDICATE_FIELDS alone kept BOTH barriers 100% green, while in production that
// field is dropped at the sanitizer's allowlist AND left stale by stripCommittedAf.
//
// rpcAdvancedFilterParams reads exactly one SearchQuery field per predicate it can send, so the set
// of fields it TOUCHES is the AF surface. A recording Proxy reports that set from the real builder
// at run time; a new predicate therefore enters this assertion the moment remote.ts learns to send
// it, with nothing to update by hand.
const touched = new Set<string>();
rpcAdvancedFilterParams(new Proxy({ ...LOADED } as Record<string, unknown>, {
  get(t, k) { if (typeof k === 'string') touched.add(k); return t[k]; },
}) as unknown as SearchQuery);
const listed = new Set<string>(AF_PREDICATE_FIELDS);
const unlisted = [...touched].filter((k) => !listed.has(k));
const stale = [...listed].filter((f) => !touched.has(f));
assert(touched.size > 0, `the recording probe actually reached the real builder (${touched.size} fields read)`);
assert(unlisted.length === 0,
  `AF_PREDICATE_FIELDS covers EVERY field rpcAdvancedFilterParams reads — unlisted: [${unlisted.join(', ')}]`);
assert(stale.length === 0,
  `…and lists nothing the builder no longer sends — stale: [${stale.join(', ')}]`);
assert(Object.keys(loadedParams).length === AF_PREDICATE_FIELDS.length,
  `every listed AF predicate reaches the RPC (${Object.keys(loadedParams).length} params for ${AF_PREDICATE_FIELDS.length} fields)`);
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
const scopeStore = sanitizeForFilterRestore({ ...scopeCommitted, afFacets: scopeFacet });
const scopeReentry = reconcileCommittedAf({ ...scopeStore, location: 'جدة' }, ALL);
assert(same(scopeReentry.types, ['Shop']), 'an AF-committed property type survives the Filter re-entry as a hard predicate');

// …AND THE USER'S OWN SCOPE EDIT MUST WIN. This is the direction no barrier moved: every fixture
// above changes the cohort BEFORE reconciling, never while a scope facet rides. Both AF barriers
// printed «all checks passed» on the head where this was broken AND on the head where it was fixed —
// «a green barrier may be asserting the bug», so the mirror of the remove-the-last-chip case is
// asserted here: EDIT the scope with a scope facet committed, and the edit must survive the reader.
//
// A facet is a RECEIPT — it licenses a predicate the Filter UI has no control for. applyScopeAnswer
// writes only typeGroups/types/type, all Normal-tier fields the sanitizer already carries under the
// group boxes and the type boxes, so a scope receipt licenses nothing and re-applying it overwrote
// the user: the boxes render from the reconciled query while their onPress writes the RAW store, so
// deselecting «محل» was a NO-OP, picking another type discarded the pick, and a group facet folded a
// specific type back into its group — the widening this file exists to forbid, with the type row
// dead in the user's hands. certifiedFacets drops scope facets for that reason; these execute it.
assert(scopeReentry.afFacets?.length === 0,
  'a SCOPE facet is not carried as a receipt at all — the type row IS its control, and a second writer over a live control is what made that control dead');
assert(certifiedFacets({ ...SHOP, types: ['Shop'], typeGroups: groupsOf(['Shop']) }, scopeFacet).length === 0,
  'certifiedFacets drops it even on the cohort that committed it (executed, not grepped)');
// The three edits the Filter screen's own group/type boxes perform, each written onto the RAW store
// exactly as index.tsx writes them, then read back through the reconciliation the screen renders.
assert(reconcileCommittedAf({ ...scopeStore, types: null }, ALL).types === null,
  'deselecting the committed type really deselects it (was: the facet put it straight back — the tap was a no-op)');
assert(same(reconcileCommittedAf({ ...scopeStore, types: ['Office'] }, ALL).types, ['Office']),
  'picking a DIFFERENT type keeps the user\'s pick (was: silently replaced by the committed one)');
const groupDropped = reconcileCommittedAf(toggleGroup(scopeStore, groupsOf(['Shop'])[0]), ALL);
assert(!groupDropped.typeGroups?.length && !groupDropped.types?.length,
  'deselecting the GROUP takes its type with it, as it does with no facet riding');
const catSwitched = reconcileCommittedAf(setCategory(scopeStore, 'Residential'), ALL);
assert(!catSwitched.typeGroups?.length && !catSwitched.types?.length,
  'switching فئة leaves no group or type behind — a Commercial type must never be searched under سكني (or the reverse)');
// A GROUP facet must not fold a specific type back into its group — invariant (f), the exact
// widening the owner measured (566 → 2,265).
const groupFacetStore = sanitizeForFilterRestore({
  ...SHOP, afFacets: [{ id: SCOPE_GROUP_ID, keys: groupsOf(['Shop']), labels: ['تجزئة'] }],
});
const pickedInside = reconcileCommittedAf({ ...groupFacetStore, types: ['Office'] }, ALL);
assert(same(pickedInside.types, ['Office']),
  'with a GROUP facet committed, a specific type picked afterwards is never folded back into the group');
// …while the ADVANCED half of the same round is untouched by all of this: the carry still carries.
const mixedRound = sanitizeForFilterRestore({
  ...ageQ.apply(scopeCommitted, ['new']),
  afFacets: [...scopeFacet, { id: 'property_age', keys: ['new'], labels: ['جديد'] }],
});
const mixedBack = reconcileCommittedAf({ ...mixedRound, location: 'جدة' }, ALL);
assert(rpcAdvancedFilterParams(mixedBack).p_is_new_construction === true,
  'a round that answered BOTH a scope question and an advanced one still carries the advanced predicate');
assert(same(mixedBack.types, ['Shop']), '…and still keeps the specific type it committed');
assert(mixedBack.afFacets?.length === 1 && mixedBack.afFacets[0].id === 'property_age',
  '…with exactly one chip: the advanced answer. Chip index i is facet index i, so the «×» can hand i straight to withoutFacet()');

console.log('\n── 7. ONE CONSTRUCTION SITE: counts and results cannot disagree ─────────────────');
// The Trending counts, the district live counts and «بحث» must all be built from the SAME reconciled
// object. This is the rule that makes «counts» and «eligible result set» one requirement instead of
// two — index.tsx binds `query` to the reconciled value once and every consumer reads that name.
const indexTsx = read('src/app/index.tsx');
// The dependency array is part of the derivation, not decoration: narrowing it to `[storeQuery.afFacets]`
// (a plausible "we only need to recompute when the facets change" performance edit) FREEZES `query`
// at the first render, and every Normal-Filter control on this screen stops moving what is counted
// and searched while still looking as though it moved. Asserted in the same expression as the call.
assert(/const query = useMemo\(\s*\(\) => reconcileCommittedAf\(storeQuery, AF_ALL_QUESTIONS\),\s*\[storeQuery\],\s*\)/.test(indexTsx),
  'index.tsx derives ONE reconciled `query` from the WHOLE store value and binds it before any consumer');
assert(/const \{ query: storeQuery,/.test(indexTsx),
  'the raw store value is renamed, so a consumer cannot reach the un-reconciled query by accident');
// …and renaming is only half of it. The raw name may appear exactly THREE times — the destructure
// that creates it, the reconciliation that consumes it, and that useMemo's dependency array. A
// FOURTH is a consumer reading the store directly, which is how counts and results start disagreeing
// again. COUNTED, not shape-matched: a shape regex is satisfied by the correct line still being
// present ALONGSIDE the bad one, which is exactly how `rpcAllNarrowingParams(storeQuery)` with the
// original left as a trailing decoy comment survived every barrier in the repo.
const storeQueryUses = (indexTsx.match(/\bstoreQuery\b/g) ?? []).length;
assert(storeQueryUses === 3,
  `the raw store has exactly ONE consumer — the reconciliation (storeQuery appears ${storeQueryUses}x; expected 3: destructure, reconcile, memo dep)`);
assert(/rpcAllNarrowingParams\(query\)/.test(indexTsx), 'the Trending city counts read the reconciled query');
assert(/const districtNarrowingSig = JSON\.stringify\(\[query\./.test(indexTsx), 'the district live counts read the reconciled query');
// …and they must read ALL of it. The AF half of that signature used to be 11 hand-typed `query.x`
// entries, so a 12th predicate would silently stop invalidating the cached district counts — the
// «advertised count disagrees with the delivered set» class this screen keeps closing, re-opened by
// omission. Iterating the one list is what makes the fix above load-bearing for every future field.
assert(/districtNarrowingSig[\s\S]{0,900}\.\.\.AF_PREDICATE_FIELDS\.map\(\(f\) => query\[f\]\)/.test(indexTsx),
  'the district signature ITERATES AF_PREDICATE_FIELDS instead of re-typing the AF fields');
assert(/const buildFilterBaseQuery[\s\S]{0,400}\.\.\.query,/.test(indexTsx), '«بحث» is built from the reconciled query');
// THE CHIP ROW MAPS THE FACET LIST ITSELF, so the index it renders is the index withoutFacet() takes.
// It used to map with a `null` hole for scope facets, and the obvious tidy-up — filter first, then
// map — silently re-indexed: tapping the «×» on «جديد» deleted a DIFFERENT facet while the chip and
// its predicate stayed. The hole is gone because scope facets are no longer carried at all (§6), so
// there is nothing to skip; this pins that the row still renders the list one-to-one.
assert(/query\.afFacets\.map\(\(f, i\) =>/.test(indexTsx),
  'the chip row maps query.afFacets one-to-one, so chip index i IS facet index i');
// rpcAllNarrowingParams is what turns that object into the Trending request; it must keep spreading
// the AF half, or the reconciliation above would be feeding a builder that throws the answers away.
assert(/rpcAllNarrowingParams[\s\S]{0,1400}rpcAdvancedFilterParams\(q\)/.test(read('src/data/remote.ts')),
  'rpcAllNarrowingParams still spreads rpcAdvancedFilterParams — the Trending request carries the AF half');

console.log('\n── 8. THE WRITE THAT WAS MISSING ────────────────────────────────────────────────');
// The whole defect was that agent.tsx never told the store what the interview committed. The write
// must stay attached to the guided branch — the one place every answer, Skip and pill removal funnels
// through — and it must carry the facets, because without them sanitizeForFilterRestore correctly
// drops every predicate and the fix silently reverts to the bug.
const agentTsx = read('src/app/agent.tsx');
assert(/if \(opts\?\.guided\) \{[\s\S]{0,1600}writeFilterStore\(\{ \.\.\.refined, afFacets: opts\.guided\.facets \}\)/.test(agentTsx),
  'runRefine writes the committed query AND its facet receipt into the shared store');
assert((agentTsx.match(/setQuery\(/g) ?? []).length === 1,
  'agent.tsx still has exactly ONE store writer (writeFilterStore), so a second unsanitized one cannot creep back');
assert(/afCarryRef\.current = null;/.test(agentTsx),
  'a new search clears the interview carry — a stale one would outrank the receipt describing THIS search');
assert(/if \(!afCarryRef\.current\?\.facets\.length && inboundAf\.length\)/.test(agentTsx),
  'a Filter search arriving WITH committed answers seeds the round from them (so they are not re-asked, lost from the pills, or unremovable)');

// …AND NEITHER OF THOSE TWO STATEMENTS MAY BE GUARDED. Both regexes above match on PRESENCE, and a
// guard in front of a present statement is the most plausible edit there is — «don't write an empty
// round», «only clear the carry when we're not arriving from the Filter». Each was built and each
// passed the whole 286-check suite:
//   `if (opts.guided.facets.length) writeFilterStore(…)` — removing the LAST pill in the chat IS the
//   zero-facet round, so the store keeps the previous round's facets: «تصفية» then shows a chip for
//   an answer the user just deleted and «بحث» re-applies its predicate. That is the same transition
//   to zero the last-chip fix closed inside reconcileCommittedAf, re-opened one call site upstream.
//   `if (!filter) afCarryRef.current = null;` — a Filter search always HAS `filter`, so the carry is
//   never cleared and a NEW conversation inherits the previous chat's facets, asked-set and pill
//   origin; because the seeding below only fills an EMPTY carry, the stale carry then BEATS the
//   receipt that describes this search. Verbatim what the comment above that line says it prevents.
// A statement is unguarded when nothing but whitespace separates it from the end of the previous
// statement (`;`) or the end of the previous block (`}`) — an `if (…)` or an `if (…) {` in between
// is exactly what this refuses. Comments are already stripped by read(), so a decoy cannot pad it.
const unguarded = (src: string, stmt: string) => {
  const at = src.indexOf(stmt);
  if (at < 0) return false;
  const before = src.slice(0, at);
  const prev = Math.max(before.lastIndexOf(';'), before.lastIndexOf('}'));
  return /^\s*$/.test(before.slice(prev + 1));
};
assert(unguarded(agentTsx, 'writeFilterStore({ ...refined, afFacets: opts.guided.facets })'),
  'the store write is UNCONDITIONAL inside the guided branch — a round that ends with zero facets must clear the store, not leave the previous round in it');
assert(unguarded(agentTsx, 'afCarryRef.current = null;'),
  'the carry clear is UNCONDITIONAL in startFresh — a guard would let a new conversation inherit the previous chat\'s answers');

// THE SEEDING BODY, not just its condition. The `if` above was the only thing asserted, so both
// mutations inside it survived the full suite:
//   `originQ: q` instead of `originQ: stripCommittedAf(q)` — stripCommittedAf has exactly one call
//   site, so a lint-driven "unused after refactor" cleanup produces it. guided.baseQ becomes a query
//   that ALREADY contains the carried predicates, and removeGuidedFacet rebuilds from that base, so
//   removing a carried pill re-runs a search still filtering on it with no pill left to say so —
//   verbatim the failure the comment above that line describes.
//   `asked: [...carry.asked]` dropping the inbound ids — rankQuestions filters on !askedIds.has(id)
//   and AGE_QUESTION has no already-answered guard of its own, so a Filter search arriving with
//   «جديد» committed re-asks «كم عمر العقار؟» with its options counted INSIDE the narrowed set: the
//   advertised-0-that-widens inversion the sibling barrier pins for `direction`.
// COUNTED as well as shaped: a count cannot be satisfied by the correct line surviving alongside a
// bad one, which is how a trailing-decoy mutant evaded every barrier in this repo on 2026-09-01.
assert(/originQ: stripCommittedAf\(q\)/.test(agentTsx) && (agentTsx.match(/\bstripCommittedAf\b/g) ?? []).length === 2,
  'the seeded pill ORIGIN is stripCommittedAf(q) — the true pre-AF query, so removing a carried pill actually removes its predicate');
assert(/asked: \[\.\.\.new Set\(\[\.\.\.\(afCarryRef\.current\?\.asked \?\? \[\]\), \.\.\.inboundAf\.map\(\(f\) => f\.id\)\]\)\]/.test(agentTsx)
  && (agentTsx.match(/\binboundAf\b/g) ?? []).length === 4,
  'the seeded ASKED set unions the inbound facet ids, so an already-committed question is not re-asked against its own narrowed set');

console.log('\n── 9. REMOVING A CHIP REALLY REMOVES ITS PREDICATE — the LAST one included ──────');
// withoutFacet() is the entire legal basis for the carry: the reason a carried predicate is allowed
// past sanitizeForFilterRestore's allowlist at all is that it is VISIBLE and REMOVABLE. It had zero
// executed coverage — the only assertion anywhere was that the identifier `withoutFacet(` appears in
// index.tsx, which stayed green when the index arithmetic was mutated to delete somebody else's chip.
// It is pure and exported, so it is EXECUTED here, on every arity that matters.
const ageFacet = { id: 'property_age', keys: ['new'], labels: ['جديد'] };
const rnplFacet = { id: 'rnpl', keys: ['rnpl'], labels: ['أقساط'] };
const rnplQ = ADVANCED.find((x) => x.id === 'rnpl')!;
// A cohort that certifies BOTH, so neither chip can be dropped for a cohort reason mid-test.
const TWO_SCOPE = certifiedScopeFor('rnpl')!;
assert(certifiedFacets(TWO_SCOPE, [ageFacet, rnplFacet]).length === 2,
  'the two-chip fixture is certified for both answers (so any drop below is the removal, not the cohort)');
const twoUp = reconcileCommittedAf(
  { ...rnplQ.apply(ageQ.apply(TWO_SCOPE, ['new']), ['rnpl']), afFacets: [ageFacet, rnplFacet] }, ALL);
const twoParams = rpcAdvancedFilterParams(twoUp);
assert(Object.keys(twoParams).length === 2, `both answers are live before any removal (${JSON.stringify(twoParams)})`);

// (a) REMOVE THE FIRST OF TWO — the one that already worked. Kept so a fix for (b) that broke this
//     cannot pass: the two must behave identically, which is the whole point.
const afterFirst = withoutFacet(twoUp, 0, ALL);
assert(afterFirst.afFacets?.length === 1 && afterFirst.afFacets[0].id === 'rnpl',
  'removing an intermediate chip leaves exactly the OTHER chip (index arithmetic removes the tapped one)');
assert(afterFirst.isNewConstruction === undefined, 'and the removed answer\'s predicate is gone');
assert(same(rpcAdvancedFilterParams(afterFirst), rpcAdvancedFilterParams(rnplQ.apply(TWO_SCOPE, ['rnpl']))),
  'while the surviving answer still sends exactly its own predicate');

// (b) REMOVE THE LAST CHIP — the transition to ZERO facets. This is the case that was broken:
//     reconcileCommittedAf's `if (!facets.length) return q` shortcut skipped the branch that runs
//     stripCommittedAf, so the store kept { afFacets: [], isNewConstruction: true } — an ACTIVE
//     predicate with no chip left to see or clear it, verbatim the invisible-filter P1 the sanitizer
//     exists to prevent, and it survived a Trending tap. Every previous barrier was green because
//     none of them ever removed the last chip.
const afterLast = withoutFacet(afterFirst, 0, ALL);
assert(afterLast.afFacets?.length === 0, 'removing the last chip leaves no chip on screen');
assert(same(rpcAdvancedFilterParams(afterLast), {}),
  `…and NO predicate either — the cleared answer really dies (sent: ${JSON.stringify(rpcAdvancedFilterParams(afterLast))})`);
const stillSet = AF_PREDICATE_FIELDS.filter((f) => (afterLast as Record<string, unknown>)[f] !== undefined);
assert(stillSet.length === 0,
  `every AF_PREDICATE_FIELD is cleared when the last chip goes — still set: [${stillSet.join(', ')}]`);
// …and it stays dead across the store round-trip a Trending tap performs.
assert(same(rpcAdvancedFilterParams(reconcileCommittedAf({ ...sanitizeForFilterRestore(afterLast), location: 'جدة' }, ALL)), {}),
  'the cleared predicate does not come back through a Trending tap');
// One-chip case directly, not only via the two-chip chain.
const oneUp = reconcileCommittedAf({ ...ageQ.apply(TWO_SCOPE, ['new']), afFacets: [ageFacet] }, ALL);
assert(rpcAdvancedFilterParams(oneUp).p_is_new_construction === true, 'a single committed chip is live');
assert(same(rpcAdvancedFilterParams(withoutFacet(oneUp, 0, ALL)), {}), 'clearing the ONLY chip clears its predicate');

// THE COUNTER-CASE the shortcut existed for: a query that NEVER had an AF round must be returned
// untouched, so a plain Normal-Filter search is not forced through a strip that could disturb it.
// "Never had one" is afFacets ABSENT; "had answers, has none now" is afFacets EMPTY. Both directions
// are asserted, or a fix for (b) could be "delete the shortcut" and quietly rewrite normal searches.
const normalOnly: SearchQuery = { ...SHOP, priceMin: 500000, contextBeds: 3, areaMin: 120 };
assert(reconcileCommittedAf(normalOnly, ALL) === normalOnly,
  'a query that never had an AF round is returned by IDENTITY — the Normal Filter is not rewritten');
assert(same(reconcileCommittedAf({ ...normalOnly, afFacets: [] }, ALL).priceMin, 500000),
  'and an emptied-out AF query keeps its Normal Filter state while losing only the AF predicates');

console.log('\n── 10. THE AGENT SHAPE: a chat writes `type`, never `types` ─────────────────────');
// Every fixture above is the FILTER shape (`types: [...]`). src/data/agent.ts queryFromBackend is the
// only property-type writer on the free-text chat path and it sets the SINGULAR `q.type`; afPlan's
// unresolvedScopeTiers() returns [] once effectiveTypes(q) is non-empty, so such a chat never mints a
// scope facet to rescue it either. Reading only `q.types` at the store boundary stored
// type=null types=null typeGroups=null, cohortAllows refused the carried answer on that type-less
// query, and the predicate AND its chip were dropped while «شقة» widened to the whole سكني category.
// The barrier could not see it because it never constructed this shape.
for (const q of ADVANCED) {
  const scope = certifiedScopeFor(q.id);
  if (!scope) continue;
  // Same cohort, expressed the way the chat expresses it: one singular type, no plural, no group.
  const agentShape: SearchQuery = { ...scope, type: scope.types![0], types: null, typeGroups: null };
  const keys = ANSWER_KEYS[q.id];
  const facet = [{ id: q.id, keys, labels: ['x'] }];
  const wanted = rpcAdvancedFilterParams(q.apply(agentShape, keys));
  const back = reconcileCommittedAf(
    { ...sanitizeForFilterRestore({ ...q.apply(agentShape, keys), afFacets: facet }), location: 'جدة' }, ALL);
  assert(same(rpcAdvancedFilterParams(back), wanted), `"${q.id}" survives re-entry from the AGENT shape (\`type\`, not \`types\`)`);
  assert(same(back.types, scope.types), `"${q.id}" agent-shape re-entry keeps the SPECIFIC type — never widened to its group`);
  assert(back.afFacets?.length === 1, `"${q.id}" agent-shape re-entry keeps its chip, so the answer is still removable`);
}

console.log('\n── 11. AMENITIES ARE CERTIFIED PER TOKEN, NOT PER QUESTION ──────────────────────');
// cohortAllows(q,'amenities') answers "may this cohort be asked about amenities", not "is THIS token
// certified here". The Filter screen can move the type under a carried answer, and the shared SQL
// predicate is strict-NULL-excluding — so replaying a Villa-only token onto شقة deletes every
// Apartment row that never stated it: UNKNOWN turned into No, on a screen that still shows the chip.
const amenQ = ADVANCED.find((x) => x.id === 'amenities')!;
const VILLA: SearchQuery = { ...SHOP, deal: 'Buy', category: 'Residential', typeGroups: groupsOf(['Villa']), types: ['Villa'] };
const APT: SearchQuery = { ...VILLA, typeGroups: groupsOf(['Apartment']), types: ['Apartment'] };
assert(certifiedAmenityKeys(VILLA).includes('car_entrance'), '«مدخل سيارة» IS certified for فيلا (so committing it there is legitimate)');
assert(!certifiedAmenityKeys(APT).includes('car_entrance'), '…and is NOT certified for شقة');
assert(cohortAllows(APT, 'amenities'), '…while the amenities QUESTION itself still is — which is why a question-level gate cannot catch this');
const villaOnly = [{ id: 'amenities', keys: ['car_entrance'], labels: ['مدخل سيارة'] }];
const movedType = reconcileCommittedAf({ ...amenQ.apply(VILLA, ['car_entrance']), ...APT, afFacets: villaOnly }, ALL);
assert(same(rpcAdvancedFilterParams(movedType), {}), 'the Villa-only token is DROPPED when the type moves to شقة, not replayed');
assert(movedType.afFacets?.length === 0, 'and its chip goes with it — no control without a predicate');
// A MIXED facet must lose only the uncertified token; dropping the certified one too would widen.
const mixed = [{ id: 'amenities', keys: ['elevator', 'car_entrance'], labels: ['مصعد', 'مدخل سيارة'] }];
const split = reconcileCommittedAf({ ...amenQ.apply(VILLA, ['elevator', 'car_entrance']), ...APT, afFacets: mixed }, ALL);
assert(same(split.amenities, ['elevator']), 'a mixed answer keeps the token شقة DOES certify — the carry narrows, never widens');
assert(same(split.afFacets?.[0]?.labels, ['مصعد']), 'and the chip is re-labelled to exactly what is still being filtered');
// The cohort that certified it must be untouched: a blanket drop would be a different bug in disguise.
assert(same(reconcileCommittedAf({ ...amenQ.apply(VILLA, ['car_entrance']), afFacets: villaOnly }, ALL).amenities, ['car_entrance']),
  'the same answer on فيلا itself still survives — only the token the NEW cohort refuses is removed');
// DRIFT GUARD for the "only the amenities question is token-filtered" decision. rnpl writes an
// amenity token too but is deliberately NOT run through certifiedAmenityKeys(): «rnpl» is not in that
// list, so filtering it would drop a certified answer and WIDEN. Its own 1:1 question gate is its
// per-token gate. A THIRD question learning to write `amenities` must force that decision again,
// so the writers are discovered by EXECUTING every apply(), never assumed.
const amenityWriters = ADVANCED.filter((q) => {
  const probe: SearchQuery = { ...SHOP };
  return !same(q.apply(probe, ANSWER_KEYS[q.id]).amenities, probe.amenities);
}).map((q) => q.id).sort();
assert(same(amenityWriters, ['amenities', 'rnpl']),
  `exactly two questions write amenity tokens, and afCarry handles both by name (found: ${amenityWriters.join(', ')})`);
assert(!certifiedAmenityKeys(certifiedScopeFor('rnpl')!).includes('rnpl'),
  '«rnpl» is deliberately absent from certifiedAmenityKeys — token-filtering it would drop a certified answer');
assert(certifiedFacets(certifiedScopeFor('rnpl')!, [rnplFacet]).length === 1,
  'so an rnpl answer survives the carry on the cohort that certified it');

console.log('\n── 12. EVERY TOKEN THE CARD CAN OFFER MUST SURVIVE THE CARRY ────────────────────');
// §11 pins the carry against certifiedAmenityKeys(). That is only half the invariant: the OTHER
// half is that certifiedAmenityKeys() covers everything AMENITIES_QUESTION can actually put on the
// card. It did not. `resolveOptions` pushes a SIXTEENTH token — `{ key: 'furnished' }`, on
// `cohortAllows(q,'furnished')` — that the key list never contained, so on الرياض/إيجار/سنوي/شقة,
// a cohort that never moves, «مفروشة» was offered, committed, stored, and then DELETED by the carry:
// {"p_amenities":["furnished"]} → {} with the chip gone. A mixed answer was silently rewritten
// (["elevator","furnished"] → ["elevator"], chip re-labelled to «مصعد» alone). 5 of 5 offering
// cohorts. §11's own drift guard could not see it: it pins which QUESTIONS write amenity tokens,
// not which TOKENS the amenities question offers — a different axis.
//
// So the offered set is DERIVED from the question's own resolveOptions (lifted above, real cohort
// logic, shimmed counts), never hand-listed here.
const resolveAmenityOptions = (lifted.AMENITIES_QUESTION as {
  resolveOptions: (q: SearchQuery) => Promise<{ options: Array<{ key: string }> }>;
}).resolveOptions;
const offeredKeys = async (q: SearchQuery) => (await resolveAmenityOptions(q)).options.map((o) => o.key);
assert((await offeredKeys(APT)).length > 0, 'the lifted resolveOptions really produced the card\'s option keys');

let offerCohorts = 0;
for (const [type, cfg] of Object.entries(COHORT_QUESTIONS)) {
  for (const leg of ['RentAnnual', 'Buy', 'RentMonthly'] as const) {
    if (!(cfg[leg] ?? []).includes('amenities')) continue;
    const scope: SearchQuery = {
      ...SHOP, ...LEGS[leg],
      category: (CLEAN_MACRO[type] ?? 'Residential') as SearchQuery['category'],
      typeGroups: groupsOf([type]), types: [type],
    };
    const offered = await offeredKeys(scope);
    const certified = new Set(certifiedAmenityKeys(scope));
    const orphans = offered.filter((k) => !certified.has(k));
    assert(orphans.length === 0,
      `${type}/${leg}: every token the amenities card can OFFER is certified for that same cohort — orphans: [${orphans.join(', ')}]`);
    if (!offered.length) continue;
    offerCohorts++;
    // …and executed end to end, not just set-compared: commit the whole offered list on the card,
    // write it through the real sanitizer, re-enter the Filter screen. A dropped token here is a
    // dropped filter on a cohort that never moved — the owner's own bullet.
    const committed = amenQ.apply(scope, offered);
    const facet = [{ id: 'amenities', keys: [...offered], labels: offered.map((k) => `#${k}`) }];
    const back = reconcileCommittedAf(sanitizeForFilterRestore({ ...committed, afFacets: facet }), ALL);
    assert(same(rpcAdvancedFilterParams(back), rpcAdvancedFilterParams(committed)),
      `${type}/${leg}: committing every offered token and returning to the Filter screen sends the SAME params`);
    assert(same(back.afFacets?.[0]?.keys, offered),
      `${type}/${leg}: …and the chip still names every token, so nothing is filtered without a control`);
  }
}
assert(offerCohorts > 0, `the sweep actually exercised offering cohorts (${offerCohorts})`);

console.log(failed === 0
  ? '\n✅ verify-af-survives-filter-reentry: all checks passed.'
  : `\n❌ verify-af-survives-filter-reentry: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
