// SHORT STAYS IS ONE COHORT — no property-type question, no rating question (owner, 2026-10-31).
//
// «إقامات قصيرة» is Gathern + Aqar Monthly and nothing else (AGENTS.md «rent pools»), so a plain
// short-stays search is one pool whatever property group or type the user picked. Before this change
// the Advanced Filter intersected the certified questions across every type in scope, and a GROUP
// pick (شقق, فلل, شاليهات…) resolved to ZERO questions — Chalet, Camp, Rest House, Floor, Studio have
// no short-stays cohort of their own — so the interview never opened for the group a user picks.
//
// What is pinned, EXECUTED against the real gates (afCohorts.ts / afPlan.ts are pure):
//   1. the scope predicate itself (plain Residential Rent/monthly only; 'both', Buy+Rent, Commercial out)
//   2. a group-only short-stays scope — and a scope with no group at all — certifies exactly
//      SHORT_STAYS_QUESTIONS (bathrooms, amenities), plus the two chat-only ids for a typed sentence
//   3. neither scope tier (group / type) is asked on short stays
//   4. the two chat-only ids are never ASKED: their card eligibility carries `!isShortStaysScope(q)`
//   5. yearly rent, Buy and the mixed period are byte-for-byte untouched
//   6. the amenity vocabulary for short stays is the residential base, whatever type is in scope
//
//   node --experimental-strip-types scripts/verify-short-stays-one-cohort.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cohortAllows, certifiedAmenityKeys, isShortStaysScope, shortStaysAsks,
  SHORT_STAYS_QUESTIONS, SHORT_STAYS_CHAT_ONLY,
} from '../src/lib/afCohorts.ts';
import { unresolvedScopeTiers } from '../src/lib/afPlan.ts';
import { groupsFor } from '../src/data/propertyTypes.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) ${label}`, caught);

const Q = (extra: Record<string, unknown>) =>
  ({ category: 'Residential', deal: 'Rent', rentPeriod: 'monthly', cities: ['الرياض'], ...extra }) as never;
const ALL_IDS = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype'];
const allowed = (q: never) => ALL_IDS.filter((id) => cohortAllows(q, id)).sort().join(',');
const SHORT_STAYS_CERTIFIED = [...SHORT_STAYS_QUESTIONS, ...SHORT_STAYS_CHAT_ONLY].sort().join(',');

console.log('\n── 1. the scope predicate ──');
check('plain Residential Rent/monthly IS short stays', isShortStaysScope(Q({})));
check("rentPeriod 'both' is NOT (it spans yearly inventory)", !isShortStaysScope(Q({ rentPeriod: 'both' })));
check('Buy+Rent combined is NOT', !isShortStaysScope(Q({ dealCombined: true })) && !isShortStaysScope(Q({ bothDeals: true })));
check('Commercial is NOT (halls are not the pool)', !isShortStaysScope(Q({ category: 'Commercial' })));
check('yearly rent is NOT', !isShortStaysScope(Q({ rentPeriod: 'annual' })) && !isShortStaysScope(Q({ rentPeriod: undefined })));
check('Buy is NOT', !isShortStaysScope(Q({ deal: 'Buy', rentPeriod: undefined })));

console.log('\n── 2. one pool: the same questions whatever group or type is in scope ──');
check('no group, no type → the short-stays set (the user picked Short stays, that is enough)',
  allowed(Q({})) === SHORT_STAYS_CERTIFIED, allowed(Q({})));
for (const g of groupsFor('Residential')) {
  check(`group «${g.group}» alone → the short-stays set`,
    allowed(Q({ typeGroups: [g.group] })) === SHORT_STAYS_CERTIFIED, allowed(Q({ typeGroups: [g.group] })));
}
check('a typed «chalet» still works: Chalet alone → the short-stays set (it has no cohort of its own)',
  allowed(Q({ types: ['Chalet'] })) === SHORT_STAYS_CERTIFIED);
check('Apartment + Chalet together → the short-stays set (no intersection on short stays)',
  allowed(Q({ types: ['Apartment', 'Chalet'] })) === SHORT_STAYS_CERTIFIED);
check('SHORT_STAYS_QUESTIONS is exactly bathrooms + amenities (owner decisions 1-3)',
  [...SHORT_STAYS_QUESTIONS].sort().join(',') === 'amenities,bathrooms');
check('rating and unit_subtype are chat-only: certified, never asked',
  [...SHORT_STAYS_CHAT_ONLY].sort().join(',') === 'rating,unit_subtype'
  && !shortStaysAsks('rating') && !shortStaysAsks('unit_subtype') && shortStaysAsks('bathrooms') && shortStaysAsks('amenities'));
mustCatch('a Buy question leaking into short stays is detected',
  !cohortAllows(Q({}), 'property_age') && !cohortAllows(Q({}), 'rnpl') && !cohortAllows(Q({}), 'furnished'));

console.log('\n── 3. no scope question on short stays ──');
check('no group, no type → no scope tier is asked', unresolvedScopeTiers(Q({})).length === 0);
check('group only → the type tier is NOT asked', unresolvedScopeTiers(Q({ typeGroups: ['Vacation & Rural'] })).length === 0);
mustCatch('the same group-only scope on YEARLY rent still asks the type tier (the rule is short-stays only)',
  unresolvedScopeTiers(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 1);

console.log('\n── 4. the two chat-only questions are never asked on the card ──');
{
  const src = readFileSync(join(import.meta.dirname, '..', 'src/data/advancedFilters.ts'), 'utf8');
  const gate = (id: string) => new RegExp(`eligibility: \\(q\\) => cohortAllows\\(q, '${id}'\\) && !isShortStaysScope\\(q\\)`).test(src);
  check('RATING_QUESTION eligibility carries !isShortStaysScope(q)', gate('rating'));
  check('UNIT_SUBTYPE_QUESTION eligibility carries !isShortStaysScope(q)', gate('unit_subtype'));
  check('AMENITIES_QUESTION has the short-stays branch (residential chips for the whole pool)',
    /if \(isShortStaysScope\(q\)\) return guidedOptions\(await fetchApartmentGuidedCounts\(q\), defs/.test(src));
}

console.log('\n── 5. everything else is untouched ──');
check('Apartment / yearly rent keeps its five questions',
  allowed(Q({ rentPeriod: 'annual', types: ['Apartment'] })) === 'amenities,bathrooms,furnished,property_age,rnpl');
check("Apartment / 'both' keeps the Annual ∩ Monthly intersection",
  allowed(Q({ rentPeriod: 'both', types: ['Apartment'] })) === 'amenities,bathrooms');
check('a GROUP on yearly rent still intersects across its members (Vacation & Rural → nothing)',
  allowed(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })) === '');
check('Commercial / monthly is unchanged (no cohort → nothing)',
  allowed(Q({ category: 'Commercial', types: ['Office'] })) === '');
mustCatch('an empty scope on yearly rent is still refused (short stays is the only no-type cohort)',
  allowed(Q({ rentPeriod: 'annual' })) === '');

console.log('\n── 6. the amenity vocabulary on short stays ──');
{
  const base = certifiedAmenityKeys(Q({})).sort().join(',');
  check('no type → the residential base chips', base.includes('parking') && base.includes('elevator') && base.includes('pool'));
  check('«Vacation & Rural» group → the SAME chips (no Rest House ∩ Chalet = nothing)',
    certifiedAmenityKeys(Q({ typeGroups: ['Vacation & Rural'] })).sort().join(',') === base);
  check('Villa alone → the same chips, no villa-only extras', certifiedAmenityKeys(Q({ types: ['Villa'] })).sort().join(',') === base);
  check('no «furnished» chip on short stays (Gathern is 100 % furnished)', !base.split(',').includes('furnished'));
  mustCatch('the yearly-rent Vacation & Rural group still offers no chip (the intersection rule is intact there)',
    certifiedAmenityKeys(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 0);
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ short stays is one cohort: no type question, no rating question, same chips for every group');
process.exit(failed ? 1 : 0);
