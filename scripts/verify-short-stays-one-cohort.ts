// SHORT STAYS IS ONE COHORT — three questions in a fixed order, no property-type question, no rating
// question (owner, 2026-10-31).
//
// «إقامات قصيرة» is Gathern + Aqar Monthly and nothing else (AGENTS.md «rent pools»), so a plain
// short-stays search is one pool whatever property group or type the user picked. Before this change
// the Advanced Filter intersected the certified questions across every type in scope, and a GROUP
// pick (شقق, فلل, شاليهات…) resolved to ZERO questions — Chalet, Camp, Rest House, Floor, Studio have
// no short-stays cohort of their own — so the interview never opened for the group a user picks.
// Then (same owner order) the one amenities card became two: 🔑 comfort and 🏊 fun & outdoors, asked
// after 🚽 bathrooms, in that order.
//
// What is pinned, EXECUTED against the real gates (afCohorts.ts / afPlan.ts are pure):
//   1. the scope predicate itself (plain Residential Rent/monthly only; 'both', Buy+Rent, Commercial out)
//   2. a group-only short-stays scope — and a scope with no group at all — certifies exactly
//      SHORT_STAYS_QUESTIONS (bathrooms, comfort, outdoors) plus the chat-only ids for a typed sentence
//   3. neither scope tier (group / type) is asked on short stays
//   4. the chat-only ids are never ASKED: their card eligibility carries `!isShortStaysScope(q)`, and
//      the two new cards exist, write q.amenities, and inline the SAME keys afCohorts declares
//   5. yearly rent, Buy and the mixed period are byte-for-byte untouched
//   6. the amenity vocabulary for short stays is the two cards' chips, whatever type is in scope
//   7. the ask order is bathrooms → comfort → outdoors, and only on short stays
//
//   node --experimental-strip-types scripts/verify-short-stays-one-cohort.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cohortAllows, certifiedAmenityKeys, isShortStaysScope, shortStaysAsks, shortStaysAskTier,
  SHORT_STAYS_QUESTIONS, SHORT_STAYS_CHAT_ONLY, SHORT_STAYS_COMFORT_KEYS, SHORT_STAYS_OUTDOORS_KEYS,
  AMENITY_BAG_QUESTION_IDS,
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
const ALL_IDS = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype', 'comfort', 'outdoors'];
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
check('SHORT_STAYS_QUESTIONS is exactly bathrooms → comfort → outdoors, in that order (owner decisions 1-3)',
  [...SHORT_STAYS_QUESTIONS].join(',') === 'bathrooms,comfort,outdoors');
check('amenities, rating and unit_subtype are chat-only: certified, never asked',
  [...SHORT_STAYS_CHAT_ONLY].sort().join(',') === 'amenities,rating,unit_subtype'
  && !shortStaysAsks('amenities') && !shortStaysAsks('rating') && !shortStaysAsks('unit_subtype')
  && shortStaysAsks('bathrooms') && shortStaysAsks('comfort') && shortStaysAsks('outdoors'));
mustCatch('a Buy question leaking into short stays is detected',
  !cohortAllows(Q({}), 'property_age') && !cohortAllows(Q({}), 'rnpl') && !cohortAllows(Q({}), 'furnished'));
mustCatch('comfort / outdoors are certified NOWHERE but short stays',
  !cohortAllows(Q({ rentPeriod: 'annual', types: ['Apartment'] }), 'comfort')
  && !cohortAllows(Q({ deal: 'Buy', rentPeriod: undefined, types: ['Apartment'] }), 'outdoors')
  && !cohortAllows(Q({ rentPeriod: 'both', types: ['Apartment'] }), 'comfort'));

console.log('\n── 3. no scope question on short stays ──');
check('no group, no type → no scope tier is asked', unresolvedScopeTiers(Q({})).length === 0);
check('group only → the type tier is NOT asked', unresolvedScopeTiers(Q({ typeGroups: ['Vacation & Rural'] })).length === 0);
mustCatch('the same group-only scope on YEARLY rent still asks the type tier (the rule is short-stays only)',
  unresolvedScopeTiers(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 1);

console.log('\n── 4. the cards: chat-only ids never asked; the two new cards mirror afCohorts ──');
{
  const src = readFileSync(join(import.meta.dirname, '..', 'src/data/advancedFilters.ts'), 'utf8');
  const gate = (id: string) => new RegExp(`eligibility: \\(q\\) => cohortAllows\\(q, '${id}'\\) && !isShortStaysScope\\(q\\)`).test(src);
  check('AMENITIES_QUESTION eligibility carries !isShortStaysScope(q)', gate('amenities'));
  check('RATING_QUESTION eligibility carries !isShortStaysScope(q)', gate('rating'));
  check('UNIT_SUBTYPE_QUESTION eligibility carries !isShortStaysScope(q)', gate('unit_subtype'));
  const body = (name: string) => {
    const m = new RegExp(`const ${name}: AdvancedQuestion = \\{([\\s\\S]*?)\\n\\};`).exec(src);
    return m ? m[1] : '';
  };
  const keysIn = (b: string) => [...b.matchAll(/\{ key: '([a-z_]+)'/g)].map((m) => m[1]);
  const comfort = body('COMFORT_QUESTION');
  const outdoors = body('OUTDOORS_QUESTION');
  check('COMFORT_QUESTION exists, id comfort, gated on cohortAllows(q, \'comfort\'), writes q.amenities',
    /id: 'comfort'/.test(comfort) && /eligibility: \(q\) => cohortAllows\(q, 'comfort'\)/.test(comfort) && /apply: addAmenities/.test(comfort));
  check('OUTDOORS_QUESTION exists, id outdoors, gated on cohortAllows(q, \'outdoors\'), writes q.amenities',
    /id: 'outdoors'/.test(outdoors) && /eligibility: \(q\) => cohortAllows\(q, 'outdoors'\)/.test(outdoors) && /apply: addAmenities/.test(outdoors));
  check('the comfort card inlines exactly SHORT_STAYS_COMFORT_KEYS, in order',
    keysIn(comfort).join(',') === [...SHORT_STAYS_COMFORT_KEYS].join(','), `${keysIn(comfort)} vs ${SHORT_STAYS_COMFORT_KEYS}`);
  check('the outdoors card inlines exactly SHORT_STAYS_OUTDOORS_KEYS, in order',
    keysIn(outdoors).join(',') === [...SHORT_STAYS_OUTDOORS_KEYS].join(','), `${keysIn(outdoors)} vs ${SHORT_STAYS_OUTDOORS_KEYS}`);
  check('both cards are in ADVANCED_QUESTIONS', /COMFORT_QUESTION, OUTDOORS_QUESTION,\n\];/.test(src));
  check('every card that writes the amenities bag is token-filtered on re-entry (AMENITY_BAG_QUESTION_IDS)',
    ['amenities', 'comfort', 'outdoors'].every((id) => AMENITY_BAG_QUESTION_IDS.has(id)) && AMENITY_BAG_QUESTION_IDS.size === 3);
  check('rankQuestions sorts by shortStaysAskTier on short stays',
    /const tier = isShortStaysScope\(q\) \? shortStaysAskTier : askTier;/.test(src));
  const nokeys = (b: string) => keysIn(b).every((k) => !/[^a-z_]/.test(k));
  mustCatch('a chip key that is not a plain p_amenities slug would be caught', nokeys(comfort) && nokeys(outdoors));
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

console.log('\n── 6. the amenity vocabulary on short stays = the two cards\' chips ──');
{
  const expected = [...SHORT_STAYS_COMFORT_KEYS, ...SHORT_STAYS_OUTDOORS_KEYS].sort().join(',');
  const keys = (q: never) => certifiedAmenityKeys(q).sort().join(',');
  check('no type → exactly the chips the two cards offer', keys(Q({})) === expected, keys(Q({})));
  check('«Vacation & Rural» group → the SAME chips (no Rest House ∩ Chalet = nothing)', keys(Q({ typeGroups: ['Vacation & Rural'] })) === expected);
  check('Villa alone → the same chips, no villa-only extras', keys(Q({ types: ['Villa'] })) === expected);
  check('no «furnished» chip on short stays (Gathern is 100 % furnished)', !expected.split(',').includes('furnished'));
  mustCatch('a chat token outside the two cards (kitchen) is NOT certified on short stays — the chat must ask',
    !certifiedAmenityKeys(Q({})).includes('kitchen'));
  mustCatch('the yearly-rent Vacation & Rural group still offers no chip (the intersection rule is intact there)',
    certifiedAmenityKeys(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 0);
}

console.log('\n── 7. the ask order ──');
check('bathrooms outranks comfort outranks outdoors',
  shortStaysAskTier('bathrooms') > shortStaysAskTier('comfort') && shortStaysAskTier('comfort') > shortStaysAskTier('outdoors') && shortStaysAskTier('outdoors') > 0);
check('a question that is not asked on short stays has tier 0', shortStaysAskTier('amenities') === 0 && shortStaysAskTier('rnpl') === 0);
mustCatch('the executed sort puts the three in the owner\'s order whatever their contextual score',
  [...['outdoors', 'bathrooms', 'comfort']].sort((a, b) => shortStaysAskTier(b) - shortStaysAskTier(a)).join(',') === 'bathrooms,comfort,outdoors');

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ short stays is one cohort: bathrooms → comfort → outdoors, no type question, no rating question, same chips for every group');
process.exit(failed ? 1 : 0);
