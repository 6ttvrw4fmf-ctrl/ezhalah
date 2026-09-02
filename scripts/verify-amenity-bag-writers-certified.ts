// ONE BAG, THREE WRITERS: the shared amenity gate must know about all of them.
// Auto-discovered barrier (scripts/verify-*.ts), offline, executes the REAL gate.
//
// THE DEFECT THIS PINS (found 2026-09-02 by the property-type audit fleet, verified by executing
// the shipped gate over every cohort).
//
// `q.amenities` is a single array, and THREE Advanced Filter questions write into it:
//
//   • `amenities` — the chip card (kitchen / parking / elevator / …)
//   • `furnished` — its own question, whose chip the amenities card itself pushes
//                   (src/data/advancedFilters.ts: `if (cohortAllows(q,'furnished')) defs.push({key:'furnished'…})`,
//                   applied by addAmenities, i.e. straight into q.amenities)
//   • `rnpl`      — its own question, writing an 'rnpl' / 'rent_now_pay_later' token
//
// All three tokens are real: location_search_candidates_ar's p_amenities vocabulary lists
// 'furnished', 'rnpl' and 'rent_now_pay_later' next to the chips, each with its own conjunct
// (`… or s.furnished`, `… or s.rent_now_pay_later`). Read live from production 2026-09-02.
//
// But `certifiedAmenityKeys()` is the CHIP vocabulary — RESIDENTIAL_AMENITY_BASE + villa extras, or
// a COHORT_CHIPS list — and knows only the first writer. So `partitionRequestedAmenities()`, the
// shared gate the chat path certifies against, returned a user's own furnished answer as REJECTED
// on every cohort that certifies the question. `certifyAfOnMergedState()` step 4 then deleted the
// filter from the query AND announced it in `rejected` — telling the user their furnished filter
// was refused as uncertified, on a cohort that certifies it and a backend that supports it.
//
// Measured before the fix, by the sweep below: 10 (cohort × question) pairs, 7 of them `furnished`.
// Residential Building/RentAnnual is the sharpest case — it certifies `furnished` while certifying
// no amenity chips at all, so `certifiedAmenityKeys()` early-returns [] and the answer could never
// survive. RNPL happened to be shielded at ONE call site by an `isRnpl()` filter in afCertify.ts,
// which is why only the furnished half was user-visible; the gate itself was wrong for both.
//
// Same class as the two certification-gate divergences fixed the same day (property_age's second
// type→macro map; `bothDeals` certifying against one deal leg while searching both): two components
// holding their own opinion about one concept, with the disagreement invisible from any single
// search's results.
//
//   node --experimental-strip-types scripts/verify-amenity-bag-writers-certified.ts

import { readFileSync } from 'node:fs';
import {
  COHORT_QUESTIONS, cohortAllows, certifiedAmenityKeys, partitionRequestedAmenities,
} from '../src/lib/afCohorts.ts';
import { CLEAN_MACRO } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const eq = (label: string, a: unknown, b: unknown) =>
  check(label, JSON.stringify(a) === JSON.stringify(b), `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// The bag's writers, and the tokens each one puts in it. Derived from the shipped question set, not
// hand-maintained: a question that writes to q.amenities but is missing here would be caught by §3,
// which reads advancedFilters.ts for chips applied via addAmenities.
const BAG_WRITERS: Array<[string, string[]]> = [
  ['furnished', ['furnished']],
  ['rnpl', ['rnpl', 'rent_now_pay_later']],
];
const LEGS: Array<[string, Record<string, unknown>]> = [
  ['Buy', { deal: 'Buy' }],
  ['RentAnnual', { deal: 'Rent', rentPeriod: 'annual' }],
  ['RentMonthly', { deal: 'Rent', rentPeriod: 'monthly' }],
];
const cells = (): Array<{ label: string; q: never }> => {
  const out: Array<{ label: string; q: never }> = [];
  for (const type of Object.keys(COHORT_QUESTIONS)) {
    const category = (CLEAN_MACRO as Record<string, string>)[type] ?? 'Residential';
    for (const [leg, extra] of LEGS) out.push({ label: `${type}/${leg}`, q: { type, category, ...extra } as never });
  }
  return out;
};

// ── 1. THE DEFECT: a certified bag-writer's token must survive the shared gate ────────────────────
console.log('── every cohort × every question that writes into q.amenities ──');
const stripped: string[] = [];
for (const { label, q } of cells()) {
  for (const [id, tokens] of BAG_WRITERS) {
    if (!cohortAllows(q, id)) continue;                 // uncertified here — rejection is CORRECT
    const { rejected } = partitionRequestedAmenities(q, tokens);
    if (rejected.length) stripped.push(`${label} certifies '${id}' but the gate rejects ${JSON.stringify(rejected)}`);
  }
}
check('no cohort has its own certified answer stripped by the shared amenity gate',
  stripped.length === 0, stripped.join('\n      '));

// The two sharpest instances, named so a regression says WHICH shape came back.
const aptAnnual = { type: 'Apartment', category: 'Residential', deal: 'Rent', rentPeriod: 'annual' } as never;
eq('Apartment/RentAnnual: a furnished answer is certified, not refused',
  partitionRequestedAmenities(aptAnnual, ['furnished']), { certified: ['furnished'], rejected: [] });
const rbAnnual = { type: 'Residential Building', category: 'Residential', deal: 'Rent', rentPeriod: 'annual' } as never;
check('Residential Building/RentAnnual certifies furnished while certifying NO amenity chips',
  cohortAllows(rbAnnual, 'furnished') && !cohortAllows(rbAnnual, 'amenities')
  && certifiedAmenityKeys(rbAnnual).length === 0);
eq('...and its furnished answer still survives the gate (the early-return case)',
  partitionRequestedAmenities(rbAnnual, ['furnished']), { certified: ['furnished'], rejected: [] });

// ── 2. THE OPPOSITE ERROR, which is worse: no token may ride the WRONG question's certification ───
// rnpl certifies on 3 cohorts, amenities on 24. Gating rnpl on 'amenities' would let it through
// wherever generic amenities happen to be allowed — what verify-agent-af-intent-coverage.ts §3
// forbids. Each writer must be gated on its OWN id, so an uncertified one is still refused.
console.log('\n── each writer gated on its OWN id, never on the amenities gate ──');
const aptBuy = { type: 'Apartment', category: 'Residential', deal: 'Buy' } as never;
check('Apartment/Buy certifies amenities...', cohortAllows(aptBuy, 'amenities'));
check('...but NOT rnpl', !cohortAllows(aptBuy, 'rnpl'));
eq('...so an rnpl token is still REFUSED there, amenities notwithstanding',
  partitionRequestedAmenities(aptBuy, ['rnpl']), { certified: [], rejected: ['rnpl'] });
check('...and NOT furnished either (Buy furnished is ~2%; owner: no Furnished filter on Buy)',
  !cohortAllows(aptBuy, 'furnished'));
eq('...so a furnished token is refused on Buy',
  partitionRequestedAmenities(aptBuy, ['furnished']), { certified: [], rejected: ['furnished'] });
// Count it across the whole matrix rather than on one example: an uncertified writer must NEVER pass.
const leaked: string[] = [];
for (const { label, q } of cells()) {
  for (const [id, tokens] of BAG_WRITERS) {
    if (cohortAllows(q, id)) continue;
    const { certified } = partitionRequestedAmenities(q, tokens);
    if (certified.length) leaked.push(`${label} does NOT certify '${id}' yet the gate admitted ${JSON.stringify(certified)}`);
  }
}
check('an UNcertified bag-writer is refused on every cohort (no widening)',
  leaked.length === 0, leaked.join('\n      '));

// ── 3. THE ROSTER CANNOT ROT: a fourth writer must not appear unnoticed ───────────────────────────
// The list above is only correct while it is complete. Chips applied by `addAmenities` land in
// q.amenities, so any chip key the amenities card pushes under a cohortAllows() guard for a
// DIFFERENT question id is a bag writer. Read them out of the shipped card.
console.log('\n── the roster of bag writers is complete ──');
const adv = readFileSync(new URL('../src/data/advancedFilters.ts', import.meta.url), 'utf8');
const guardedChips = [...adv.matchAll(/if \(cohortAllows\(q, '([a-z_]+)'\)\) defs\.push\(\{ key: '([a-z_]+)'/g)]
  .map((m) => ({ questionId: m[1], chipKey: m[2] }));
check('the amenities card pushes at least one chip guarded by another question\'s certification',
  guardedChips.length > 0, 'the extraction regex found nothing — advancedFilters.ts may have been reshaped');
const known = new Set(BAG_WRITERS.map(([id]) => id));
const unknown = guardedChips.filter((g) => !known.has(g.questionId));
check('every such chip belongs to a question this file already knows writes into the bag',
  unknown.length === 0,
  `unrostered: ${JSON.stringify(unknown)} — add it to BAG_WRITERS here AND to AMENITY_BAG_WRITERS in `
  + 'src/lib/afCohorts.ts, or its answers will be stripped and announced as uncertified');
// The shipped gate must actually consult the roster, per-id.
const coh = readFileSync(new URL('../src/lib/afCohorts.ts', import.meta.url), 'utf8');
check('partitionRequestedAmenities() widens its allow-set from the bag-writer roster',
  /for \(const \[id, tokens\] of AMENITY_BAG_WRITERS\) \{\s*\n\s*if \(cohortAllows\(q, id\)\)/.test(coh),
  'the gate must add each writer\'s tokens under that writer\'s OWN cohortAllows(q, id)');
check('certifiedAmenityKeys() itself is UNCHANGED — it stays the chip vocabulary',
  !/AMENITY_BAG_WRITERS/.test(coh.slice(coh.indexOf('export function certifiedAmenityKeys'),
    coh.indexOf('const AMENITY_BAG_WRITERS'))),
  'scripts/verify-frontend-bundle-matches-source-live.ts pins certifiedAmenityKeys() as the ordered '
  + 'CHIP token sequence compiled into the deployed bundle; widening it there would break that check '
  + 'for a reason that has nothing to do with the bundle');

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — the shared amenity gate disagrees with a question's own certification`);
  process.exit(1);
}
console.log('\nOK — every question that writes into q.amenities is certified by its own gate, and only its own');
