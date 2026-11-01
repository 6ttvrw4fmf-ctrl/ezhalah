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
//      the three cards exist, write q.amenities, and resolve their chips from COHORT_CARDS via cardKeys()
//      (since 2026-11-01 no card inlines a key list: the plan on a short-stays scope IS the three lists)
//   5. yearly rent, Buy and the mixed period are byte-for-byte untouched
//   6. the amenity vocabulary for short stays is the three cards' chips, whatever type is in scope
//   7. the ask order is bathrooms → comfort → space → fun, and only on short stays
//
//   node --experimental-strip-types scripts/verify-short-stays-one-cohort.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cohortAllows, certifiedAmenityKeys, isShortStaysScope, shortStaysAsks, shortStaysAskTier, cardPlan,
  SHORT_STAYS_QUESTIONS, SHORT_STAYS_CHAT_ONLY, SHORT_STAYS_COMFORT_KEYS, SHORT_STAYS_SPACE_KEYS, SHORT_STAYS_FUN_KEYS,
  AMENITY_BAG_QUESTION_IDS, CARD_IDS, COHORT_CARDS,
} from '../src/lib/afCohorts.ts';
import { CHIP_DEFS } from '../src/lib/afChips.ts';
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
// Every question id the pool knows, the ten themed cards and the two Residential Building ladders included
// (owner 2026-10-31): on short stays only the three short-stays cards may clear.
const ALL_IDS = ['rnpl', 'property_age', 'amenities', 'bathrooms', 'furnished', 'street_width', 'direction', 'rating', 'unit_subtype', ...CARD_IDS, 'apartments', 'shops'];
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
// Since 2026-11-01 comfort / space / fun are ALSO certified on yearly rent and Buy (the Apartments & Co-living
// lists); what stays short-stays-only is the PLAN: exactly the three short-stays lists, nothing of the yearly cards.
const ids = (q: never) => cardPlan(q).map((c) => c.id).join(',');
check('the short-stays plan is exactly comfort → space → fun, for the bare scope and for every group',
  ids(Q({})) === 'comfort,space,fun' && groupsFor('Residential').every((g) => ids(Q({ typeGroups: [g.group] })) === 'comfort,space,fun'));
mustCatch('a yearly-only card (safety, perks, build, extras, who, features, services) or ladder (apartments, shops) leaking into short stays is detected',
  ['safety', 'perks', 'build', 'extras', 'who', 'features', 'services', 'apartments', 'shops'].every((id) => !cohortAllows(Q({}), id) && !cohortAllows(Q({ typeGroups: ['Apartments & Co-living'] }), id)));
mustCatch('the yearly cards still certify on yearly rent (the rule is a plan, not a ban)',
  cohortAllows(Q({ rentPeriod: 'annual', types: ['Apartment'] }), 'safety') && cohortAllows(Q({ deal: 'Buy', rentPeriod: undefined, types: ['Apartment'] }), 'build'));

console.log('\n── 3. no scope question on short stays ──');
check('no group, no type → no scope tier is asked', unresolvedScopeTiers(Q({})).length === 0);
check('group only → the type tier is NOT asked', unresolvedScopeTiers(Q({ typeGroups: ['Vacation & Rural'] })).length === 0);
mustCatch('the same group-only scope on YEARLY rent still asks the type tier (the rule is short-stays only)',
  unresolvedScopeTiers(Q({ rentPeriod: 'annual', typeGroups: ['Vacation & Rural'] })).length === 1);

console.log('\n── 4. the cards: chat-only ids never asked; the three cards resolve from COHORT_CARDS ──');
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
  // The cards no longer inline a key list (2026-11-01): each resolves cardOptions(q, id), which reads cardKeys(q, id)
  // from COHORT_CARDS — so the short-stays lists live in ONE place and the plan below is the executed truth.
  const ids: Record<string, string> = { COMFORT_QUESTION: 'comfort', SPACE_QUESTION: 'space', FUN_QUESTION: 'fun' };
  for (const name of Object.keys(ids)) {
    const b = body(name);
    const id = ids[name];
    check(`${name} exists, id ${id}, gated on cohortAllows(q, '${id}'), writes q.amenities`,
      new RegExp(`id: '${id}'`).test(b) && new RegExp(`eligibility: \\(q\\) => cohortAllows\\(q, '${id}'\\)`).test(b) && /apply: addAmenities/.test(b));
    check(`${name} resolves its chips through cardOptions(q, '${id}') — never an inlined key list`,
      new RegExp(`resolveOptions\\(q\\) \\{ return cardOptions\\(q, '${id}'\\); \\}`).test(b) && !/\{ key: '/.test(b), b.slice(0, 200));
  }
  check("SPACE_QUESTION is the short-stays «space & safety» wording (eligibility && isShortStaysScope(q)); SPACE_YEARLY_QUESTION is its complement",
    /eligibility: \(q\) => cohortAllows\(q, 'space'\) && isShortStaysScope\(q\)/.test(body('SPACE_QUESTION'))
    && /eligibility: \(q\) => cohortAllows\(q, 'space'\) && !isShortStaysScope\(q\)/.test(body('SPACE_YEARLY_QUESTION')));
  check('cardOptions reads cardKeys(q, id) and CHIP_DEFS (the one voice per token)',
    /async function cardOptions\(q: SearchQuery, id: string\)/.test(src) && /cardKeys\(q, id\)\.map/.test(src) && /CHIP_DEFS\[key\]/.test(src));
  const plan = cardPlan(Q({}));
  const planKeys = (id: string) => plan.find((c) => c.id === id)?.keys ?? [];
  check('the executed short-stays plan carries the afCohorts short-stays lists, in order',
    planKeys('comfort').join(',') === [...SHORT_STAYS_COMFORT_KEYS].join(',') && planKeys('space').join(',') === [...SHORT_STAYS_SPACE_KEYS].join(',')
    && planKeys('fun').join(',') === [...SHORT_STAYS_FUN_KEYS].join(','));
  check('the short-stays lists are derived from COHORT_CARDS.Apartment.RentMonthly (one source)',
    SHORT_STAYS_COMFORT_KEYS === COHORT_CARDS.Apartment.RentMonthly!.comfort && SHORT_STAYS_FUN_KEYS === COHORT_CARDS.Apartment.RentMonthly!.fun);
  const all = [...SHORT_STAYS_COMFORT_KEYS, ...SHORT_STAYS_SPACE_KEYS, ...SHORT_STAYS_FUN_KEYS];
  check('every short-stays chip has a CHIP_DEFS entry with its emoji (owner 2026-11-01)', all.every((k) => !!CHIP_DEFS[k]?.emoji && !!CHIP_DEFS[k]?.labelKey));
  check('every chip key in CHIP_DEFS carries an emoji and is a plain p_amenities slug',
    Object.entries(CHIP_DEFS).every(([k, d]) => /^[a-z_0-9]+$/.test(k) && d.emoji.length > 0));
  mustCatch('a chip key that is not a plain p_amenities slug would be caught', all.every((k) => !/[^a-z_]/.test(k)));
  check('the pool ends with the cards, fun last (…SERVICES_QUESTION, FUN_QUESTION)', /SERVICES_QUESTION, FUN_QUESTION,\n\];/.test(src)
    && /COMFORT_QUESTION, SPACE_QUESTION, SPACE_YEARLY_QUESTION,/.test(src));
  check('every question that writes the amenities bag is token-filtered on re-entry (AMENITY_BAG_QUESTION_IDS = amenities + 10 cards + apartments + shops = 13)',
    ['amenities', ...CARD_IDS, 'apartments', 'shops'].every((id) => AMENITY_BAG_QUESTION_IDS.has(id)) && AMENITY_BAG_QUESTION_IDS.size === 13);
  check('rankQuestions sorts by shortStaysAskTier on short stays (and by groupAskTier where cards exist)',
    /const tier = isShortStaysScope\(q\) \? shortStaysAskTier : hasCards\(q\) \? groupAskTierFor\(q\) : askTier;/.test(src));
  check('no chip key appears on two short-stays cards', new Set(all).size === all.length);
}

console.log('\n── 5. everything else is untouched ──');
// Yearly rent / 'both' now carry the Apartments & Co-living cards (owner 2026-10-31; verify-af-apartments-group-cards.ts
// pins the lists). What this section pins is that the short-stays rule did not leak: the yearly scope still asks its
// own questions, and the mixed period is still an intersection (Annual ∩ Monthly: no rnpl, no age, no fun, no perks).
check('Apartment / yearly rent keeps its questions (installments, bathrooms, age, furnished, amenities + its four cards)',
  allowed(Q({ rentPeriod: 'annual', types: ['Apartment'] })) === 'amenities,bathrooms,comfort,furnished,perks,property_age,rnpl,safety,space',
  allowed(Q({ rentPeriod: 'annual', types: ['Apartment'] })));
check("Apartment / 'both' keeps the Annual ∩ Monthly intersection (the surviving chips pool into comfort · space · extras)",
  allowed(Q({ rentPeriod: 'both', types: ['Apartment'] })) === 'amenities,bathrooms,comfort,extras,space', allowed(Q({ rentPeriod: 'both', types: ['Apartment'] })));
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
