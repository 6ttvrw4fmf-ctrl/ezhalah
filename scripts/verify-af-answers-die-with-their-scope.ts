// NO ADVANCED-FILTER ANSWER MAY SURVIVE A SCOPE THAT DOES NOT CERTIFY IT.
//
// ── THE DEFECT (found 2026-09-01, owner property-type audit) ────────────────────────────────────
//
// SearchQuery carries 11 AF answer fields. NOTHING cleared any of them on a scope change:
// `setCategory()` (src/lib/searchDefaults.ts) resets 13 fields and none of the 11, even though
// R1.1.1 says a category switch "CLEARS everything beneath it"; the type toggle
// (src/app/index.tsx ~1580) resets types/type/detail/priceBand/contextBeds* and none of the 11.
//
// Worked example, the one the owner named: answer bathrooms ≥ 3 on an Apartment search, switch to
// Commercial, pick أرض تجارية. `bathMin: 3` rides along. Land rows have NULL bathrooms and the
// shared clause is strict-NULL-EXCLUDING, so the result set is silently amputated — and the Filter
// home shows no AF pill for that scope, because that scope cannot offer the question at all.
//
// ── WHAT THIS PINS ───────────────────────────────────────────────────────────────────────────────
//
// Executes pruneUncertifiedAdvanced() over every transition the owner listed, plus a generated
// sweep of EVERY (from-cohort → to-cohort) pair, and asserts two properties:
//
//   SAFETY   — after the transition, no surviving answer belongs to a question the new scope does
//              not certify (afQuestionAllowed === false).
//   LIVENESS — an answer whose question IS still certified must NOT be dropped. A prune that
//              clears everything would satisfy safety and destroy the product.
//
// Both matter. Only checking safety would let "return HOME_DEFAULT_QUERY" pass.
//
//   node --experimental-strip-types scripts/verify-af-answers-die-with-their-scope.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pruneUncertifiedAdvanced } from '../src/lib/afPrune.ts';
import { afQuestionAllowed } from '../src/lib/afCohorts.ts';
import { CLEAN_MACRO } from '../src/data/propertyTypes.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nverify-af-answers-die-with-their-scope: a stale AF answer must never reach the RPC.\n');

// Every AF answer field, with the question that owns it and a concrete answered value.
const FIELD_OF: { id: string; field: string; value: unknown }[] = [
  { id: 'property_age', field: 'ageMax', value: 5 },
  { id: 'property_age', field: 'ageMin', value: 1 },
  { id: 'property_age', field: 'isNewConstruction', value: true },
  { id: 'bathrooms', field: 'bathMin', value: 3 },
  { id: 'furnished', field: 'furnishedPref', value: true },
  { id: 'street_width', field: 'streetWidthMin', value: 15 },
  { id: 'direction', field: 'directions', value: ['شمال'] },
  { id: 'rating', field: 'ratingMin', value: 4 },
  { id: 'rating', field: 'reviewsMin', value: 10 },
  { id: 'unit_subtype', field: 'unitSubtypes', value: ['شقة'] },
];

const scope = (cleanType: string, leg: 'Buy' | 'RentAnnual' | 'RentMonthly'): any => ({
  category: CLEAN_MACRO[cleanType],
  types: [cleanType],
  deal: leg === 'Buy' ? 'Buy' : 'Rent',
  rentPeriod: leg === 'Buy' ? null : (leg === 'RentMonthly' ? 'monthly' : 'annual'),
});

// ── 1. the transitions the owner named, by name ──────────────────────────────────────────────────
const NAMED: [string, any, any][] = [
  ['Apartment → Villa', scope('Apartment', 'Buy'), scope('Villa', 'Buy')],
  ['Villa → Land', scope('Villa', 'Buy'), scope('Residential Land', 'Buy')],
  ['Shop → Office', scope('Shop', 'RentAnnual'), scope('Office', 'RentAnnual')],
  ['Apartment → Commercial Land (category switch)', scope('Apartment', 'Buy'), scope('Commercial Land', 'Buy')],
  ['Buy → Rent (Apartment)', scope('Apartment', 'Buy'), scope('Apartment', 'RentAnnual')],
  ['Annual → Monthly (Apartment)', scope('Apartment', 'RentAnnual'), scope('Apartment', 'RentMonthly')],
  ['single → multi type (Apartment → Apartment+Villa)', scope('Apartment', 'Buy'),
    { ...scope('Apartment', 'Buy'), types: ['Apartment', 'Villa'] }],
  ['multi → remove one (Apartment+Villa → Villa)', { ...scope('Apartment', 'Buy'), types: ['Apartment', 'Villa'] },
    scope('Villa', 'Buy')],
];

for (const [name, from, to] of NAMED) {
  // Answer everything the FROM scope certifies, then move to TO and prune.
  let answered: any = { ...from };
  const carried: string[] = [];
  for (const { id, field, value } of FIELD_OF) {
    if (!afQuestionAllowed(from, id)) continue;
    answered[field] = value;
    carried.push(field);
  }
  if (afQuestionAllowed(from, 'amenities')) answered.amenities = ['elevator'];
  const moved = { ...answered, ...to };
  const pruned: any = pruneUncertifiedAdvanced(moved);

  const survivors = FIELD_OF.filter(({ field }) => pruned[field] !== undefined && pruned[field] !== null);
  const illegal = survivors.filter(({ id }) => !afQuestionAllowed(pruned, id));
  const amenityIllegal = (pruned.amenities ?? []).length > 0 && !afQuestionAllowed(pruned, 'amenities')
    && !(pruned.amenities ?? []).every((t: string) => t === 'rnpl' || t === 'rent_now_pay_later');

  check(`${name} — no uncertified answer survives`,
    illegal.length === 0 && !amenityIllegal,
    `carried in: ${carried.join(', ') || '(none)'}\n      ` +
    `illegally survived: ${illegal.map((x) => `${x.field} (${x.id})`).join(', ')}` +
    (amenityIllegal ? ` amenities=${JSON.stringify(pruned.amenities)}` : ''));
}

// ── 2. LIVENESS — a still-certified answer must be KEPT ──────────────────────────────────────────
{
  const from = scope('Apartment', 'Buy');
  const to = scope('Villa', 'Buy');
  // bathrooms is certified for BOTH Apartment/Buy and Villa/Buy.
  const pruned: any = pruneUncertifiedAdvanced({ ...from, bathMin: 3, ...to });
  check('an answer the NEW scope still certifies is kept (bathMin survives Apartment→Villa on Buy)',
    pruned.bathMin === 3,
    `bathMin became ${JSON.stringify(pruned.bathMin)} — a prune that drops everything is not a fix`);
}
{
  const q: any = { ...scope('Apartment', 'Buy'), bathMin: 2, ageMax: 5 };
  const same = pruneUncertifiedAdvanced(q);
  check('a query with nothing stale is returned UNCHANGED (identity, no needless re-render)', same === q);
}

// ── 3. the full generated sweep — every cohort pair, not just the named ones ─────────────────────
const TYPES = Object.keys(CLEAN_MACRO);
const LEGS: ('Buy' | 'RentAnnual' | 'RentMonthly')[] = ['Buy', 'RentAnnual', 'RentMonthly'];
let pairs = 0;
const leaks: string[] = [];
for (const ft of TYPES) for (const fl of LEGS) {
  const from = scope(ft, fl);
  let answered: any = { ...from };
  let any = false;
  for (const { id, field, value } of FIELD_OF) {
    if (!afQuestionAllowed(from, id)) continue;
    answered[field] = value; any = true;
  }
  if (afQuestionAllowed(from, 'amenities')) { answered.amenities = ['elevator']; any = true; }
  if (!any) continue;                       // nothing certified here — nothing to carry
  for (const tt of TYPES) for (const tl of LEGS) {
    if (tt === ft && tl === fl) continue;
    pairs++;
    const pruned: any = pruneUncertifiedAdvanced({ ...answered, ...scope(tt, tl) });
    for (const { id, field } of FIELD_OF) {
      if (pruned[field] === undefined || pruned[field] === null) continue;
      if (!afQuestionAllowed(pruned, id)) leaks.push(`${ft}/${fl} → ${tt}/${tl}: ${field} (${id})`);
    }
    for (const tok of (pruned.amenities ?? [])) {
      const gate = (tok === 'rnpl' || tok === 'rent_now_pay_later') ? 'rnpl' : 'amenities';
      if (!afQuestionAllowed(pruned, gate)) leaks.push(`${ft}/${fl} → ${tt}/${tl}: amenity '${tok}'`);
    }
  }
}
check(`every generated cohort transition is clean (${pairs} ordered pairs swept)`,
  leaks.length === 0,
  `${leaks.length} leak(s), first few:\n      ${leaks.slice(0, 6).join('\n      ')}`);

// ── 4. the prune is actually WIRED at the request boundary ───────────────────────────────────────
const remote = readFileSync(join(ROOT, 'src/data/remote.ts'), 'utf8');
check('rpcFilterParams() prunes before building the search request',
  /function rpcFilterParams\(qRaw: SearchQuery\) \{[\s\S]{0,900}?const q = pruneUncertifiedAdvanced\(qRaw\);/.test(remote),
  'the search path must prune, or a stale answer reaches the RPC from whichever surface set it');
check('rpcCountFilterParams() prunes too (counts and results must agree)',
  /function rpcCountFilterParams\(qRaw: SearchQuery\) \{[\s\S]{0,400}?const q = pruneUncertifiedAdvanced\(qRaw\);/.test(remote),
  'a count over a predicate the search will not apply is the count-vs-results lie the contract forbids');

console.log(failures
  ? `\n✗ verify-af-answers-die-with-their-scope: ${failures} check(s) failed.\n`
  : '\n✅ verify-af-answers-die-with-their-scope: stale AF answers cannot reach the RPC.\n');
process.exit(failures ? 1 : 0);
