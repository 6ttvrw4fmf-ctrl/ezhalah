// SHORT STAYS IS ONE COHORT — four questions in a fixed order, no property-type question, no rating
// question (owner, 2026-10-31; the locked four-question list 2026-11-01).
//
// «إقامات قصيرة» is Gathern + Aqar Monthly and nothing else (AGENTS.md «rent pools»), so a plain
// short-stays search is one pool whatever property group or type the user picked. Before this change
// the Advanced Filter intersected the certified questions across every type in scope, and a GROUP
// pick (شقق, فلل, شاليهات…) resolved to ZERO questions — Chalet, Camp, Rest House, Floor, Studio have
// no short-stays cohort of their own — so the interview never opened for the group a user picks.
// Then the one amenities card became the owner's locked cards: 🔑 comfort, 🏠 space & safety and ✨ fun,
// asked after 🚽 bathrooms, in that order. Each card offers the chips that already have a count path;
// the owner's remaining chips join one at a time once the free word reader and the count exist.
//
// What is pinned, EXECUTED against the real gates (afCohorts.ts / afPlan.ts are pure):
//   1. the scope predicate itself (plain Residential Rent/monthly only; 'both', Buy+Rent, Commercial out)
//   2. a group-only short-stays scope — and a scope with no group at all — certifies exactly
//      SHORT_STAYS_QUESTIONS (bathrooms, comfort, space, fun) plus the chat-only ids for a typed sentence
//   3. neither scope tier (group / type) is asked on short stays
//   4. the chat-only ids are never ASKED: their card eligibility carries `!isShortStaysScope(q)`, and
//      the three cards exist, write q.amenities, and inline the SAME keys afCohorts declares
//   5. yearly rent, Buy and the mixed period are byte-for-byte untouched
//   6. the amenity vocabulary for short stays is the three cards' chips, whatever type is in scope
//   7. the ask order is bathrooms → comfort → space → fun, and only on short stays
//
//   node --experimental-strip-types scripts/verify-short-stays-one-cohort.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cohortAllows, certifiedAmenityKeys, isShortStaysScope, shortStaysAsks, shortStaysAskTier,
  SHORT_STAYS_QUESTIONS, SHORT_STAYS_CHAT_ONLY, SHORT_STAYS_COMFORT_KEYS, SHORT_STAYS_SPACE_KEYS, SHORT_STAYS_FUN_KEYS,
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
const ALL_IDS = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype', 'comfort', 'space', 'fun'];
const allowed = (q: never) => ALL_IDS.filter((id) => cohortAllows(q, id)).sort().join(',');
const SHORT_STAYS_CERTIFIED = [...SHORT_STAYS_QUESTIONS, ...SHORT_STAYS_CHAT_ONLY].sort().join(',');
const CARDS = ['comfort', 'space', 'fun'] as const;

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
check('SHORT_STAYS_QUESTIONS is exactly bathrooms → comfort → space → fun, in that order (owner, locked 2026-11-01)',
  [...SHORT_STAYS_QUESTIONS].join(',') === 'bathrooms,comfort,space,fun');
check('amenities, rating and unit_subtype are chat-only: certified, never asked',
  [...SHORT_STAYS_CHAT_ONLY].sort().join(',') === 'amenities,rating,unit_subtype'
  && !shortStaysAsks('amenities') && !shortStaysAsks('rating') && !shortStaysAsks('unit_subtype')
  && shortStaysAsks('bathrooms') && CARDS.every((id) => shortStaysAsks(id)));
mustCatch('a Buy question leaking into short stays is detected',
  !cohortAllows(Q({}), 'property_age') && !cohortAllows(Q({}), 'rnpl') && !cohortAllows(Q({}), 'furnished'));
mustCatch('comfort / space / fun are certified NOWHERE but short stays',
  CARDS.every((id) =>
    !cohortAllows(Q({ rentPeriod: 'annual', types: ['Apartment'] }), id)
    && !cohortAllows(Q({ deal: 'Buy', rentPeriod: undefined, types: ['Apartment'] }), id)
    && !cohortAllows(Q({ rentPeriod: 'both', types: ['Apartment'] }), id)));

console.log('\n── 3. no scope question on short stays ──');
check('no group, no type → no scope tier is asked', unresolvedScopeTiers(Q({})).length === 0);
check('group only → the type tier is NOT asked', unresolvedScopeTiers(Q({ typeGroups: ['Vacation & Rural'] })).length === 0);
mustCatch('the same group-only scope on YEARLY rent still asks the type tier (the rule is short-stays only)',
  unresolvedScopeTiers(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 1);

console.log('\n── 4. the cards: chat-only ids never asked; the three cards mirror afCohorts ──');
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
  const emojisIn = (b: string) => [...b.matchAll(/emoji: '([^']+)'/g)].map((m) => m[1]);
  const expectKeys: Record<string, readonly string[]> = {
    COMFORT_QUESTION: SHORT_STAYS_COMFORT_KEYS, SPACE_QUESTION: SHORT_STAYS_SPACE_KEYS, FUN_QUESTION: SHORT_STAYS_FUN_KEYS,
  };
  const ids: Record<string, string> = { COMFORT_QUESTION: 'comfort', SPACE_QUESTION: 'space', FUN_QUESTION: 'fun' };
  for (const name of Object.keys(expectKeys)) {
    const b = body(name);
    const id = ids[name];
    check(`${name} exists, id ${id}, gated on cohortAllows(q, '${id}'), writes q.amenities`,
      new RegExp(`id: '${id}'`).test(b) && new RegExp(`eligibility: \\(q\\) => cohortAllows\\(q, '${id}'\\)`).test(b) && /apply: addAmenities/.test(b));
    check(`${name} inlines exactly its afCohorts key list, in order`,
      keysIn(b).join(',') === [...expectKeys[name]].join(','), `${keysIn(b)} vs ${expectKeys[name]}`);
    check(`${name}: every chip carries its emoji (owner 2026-11-01)`, emojisIn(b).length === keysIn(b).length);
    mustCatch(`${name}: a chip key that is not a plain p_amenities slug would be caught`, keysIn(b).every((k) => !/[^a-z_]/.test(k)));
  }
  check('all three cards are in ADVANCED_QUESTIONS, in ask order', /COMFORT_QUESTION, SPACE_QUESTION, FUN_QUESTION,\n\];/.test(src));
  check('every card that writes the amenities bag is token-filtered on re-entry (AMENITY_BAG_QUESTION_IDS)',
    ['amenities', ...CARDS].every((id) => AMENITY_BAG_QUESTION_IDS.has(id)) && AMENITY_BAG_QUESTION_IDS.size === 4);
  check('rankQuestions sorts by shortStaysAskTier on short stays',
    /const tier = isShortStaysScope\(q\) \? shortStaysAskTier : askTier;/.test(src));
  const all = [...SHORT_STAYS_COMFORT_KEYS, ...SHORT_STAYS_SPACE_KEYS, ...SHORT_STAYS_FUN_KEYS];
  check('no chip key appears on two cards', new Set(all).size === all.length);
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

console.log('\n── 6. the amenity vocabulary on short stays = the three cards\' chips ──');
{
  const expected = [...SHORT_STAYS_COMFORT_KEYS, ...SHORT_STAYS_SPACE_KEYS, ...SHORT_STAYS_FUN_KEYS].sort().join(',');
  const keys = (q: never) => certifiedAmenityKeys(q).sort().join(',');
  check('no type → exactly the chips the three cards offer', keys(Q({})) === expected, keys(Q({})));
  check('«Vacation & Rural» group → the SAME chips (no Rest House ∩ Chalet = nothing)', keys(Q({ typeGroups: ['Vacation & Rural'] })) === expected);
  check('Villa alone → the same chips, no villa-only extras', keys(Q({ types: ['Villa'] })) === expected);
  check('no «furnished» chip on short stays (Gathern is 100 % furnished)', !expected.split(',').includes('furnished'));
  mustCatch('a chat token outside the cards (kitchen) is NOT certified on short stays — the chat must ask',
    !certifiedAmenityKeys(Q({})).includes('kitchen'));
  mustCatch('the yearly-rent Vacation & Rural group still offers no chip (the intersection rule is intact there)',
    certifiedAmenityKeys(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 0);
}

console.log('\n── 7. the ask order ──');
check('bathrooms > comfort > space > fun',
  shortStaysAskTier('bathrooms') > shortStaysAskTier('comfort') && shortStaysAskTier('comfort') > shortStaysAskTier('space')
  && shortStaysAskTier('space') > shortStaysAskTier('fun') && shortStaysAskTier('fun') > 0);
check('a question that is not asked on short stays has tier 0', shortStaysAskTier('amenities') === 0 && shortStaysAskTier('rnpl') === 0);
mustCatch('the executed sort puts the four in the owner\'s order whatever their contextual score',
  [...['fun', 'space', 'bathrooms', 'comfort']].sort((a, b) => shortStaysAskTier(b) - shortStaysAskTier(a)).join(',') === 'bathrooms,comfort,space,fun');

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ short stays is one cohort: bathrooms → comfort → space → fun, no type question, no rating question, same chips for every group');
process.exit(failed ? 1 : 0);
