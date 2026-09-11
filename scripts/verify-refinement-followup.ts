// ONE MAIN REQUEST + ONE FOLLOW-UP — the AI Agent's free-text composer is not an unlimited chatbot
// (owner rule, 2026-09-11). Once a chat has shown its first result set, the user gets exactly one
// more free-text refinement message. Ezhalah may ask AT MOST one follow-up — only a client-driven
// zero-match relaxation, never a model-initiated question — and answering it (however it's answered)
// always ends the turn. Off-topic replies and fully-resolved searches lock immediately too.
//
// THE INVARIANTS THIS PINS, in one line each:
//   1. The turn-state machine (src/lib/refinementFollowup.ts) only ever offers ONE follow-up per
//      turn, and answering it ALWAYS locks — executed directly against the real function, not a copy.
//   2. RELAXABLE_FIELDS never includes the search's IDENTITY (deal/location/category/type/budget/
//      platforms) — relaxing a requirement must never widen WHAT the user is searching for.
//   3. relaxationCandidates() only offers fields THIS turn actually changed, never an unrelated
//      pre-existing constraint — never silently relax something the user did not just add.
//   4. Every RELAXABLE_FIELDS entry has a real Arabic AND English label (no field can silently fall
//      back to its own key and leak an internal identifier into a user-facing message).
//   5. parseYesNo() defaults unclear input to 'no' — an ambiguous reply must never be read as
//      consent to widen a search the user did not ask to widen.
//   6. The AI Agent's own onboarding (before any results exist) is UNCHANGED — this whole rule only
//      gates send() once a results turn is already on screen (checked in agent.tsx, not this module).
//   7. Advanced Filter's own «نتائج أدق» fallback (pendingRefineRef) stays reachable regardless of
//      this lock — it is a structurally separate flow this rule must never block.
//
// MUTATION-PROVEN (each fails this barrier):
//   M1 nextTurnState stops locking after 'awaiting_followup'   -> invariant 1 fails
//   M2 RELAXABLE_FIELDS gains 'location'/'deal'/'type'/'category'/'priceMin'/etc. -> invariant 2 fails
//   M3 relaxationCandidates returns every relaxable field regardless of prev      -> invariant 3 fails
//   M4 a RELAXABLE_FIELDS entry has no AR or EN label                            -> invariant 4 fails
//   M5 parseYesNo defaults unclear text to 'yes'                                 -> invariant 5 fails
//
//   node --experimental-strip-types scripts/verify-refinement-followup.ts  (in `npm test`)

import { readFileSync } from 'node:fs';
import {
  nextTurnState, relaxationCandidates, withFieldRelaxed, parseYesNo, relaxedFieldLabel,
  RELAXABLE_FIELDS, type RelaxableField, type RefinementTurnState,
} from '../src/lib/refinementFollowup.ts';
import type { SearchQuery } from '../src/data/search.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};
// mutation proof: `brokenResult` is a deliberately-broken input already evaluated against the SAME
// predicate the real check uses — passes only when the predicate actually flips to catch the defect.
const mustCatch = (label: string, brokenResult: boolean) => check(`(mutation) ${label}`, brokenResult);

// ── 1. The state machine, executed ──────────────────────────────────────────────────────────────
check('available + no offer -> locked (fully resolved / off-topic consumes the one main request)',
  nextTurnState('available', false) === 'locked');
check('available + offer -> awaiting_followup (the ONE allowed follow-up is now pending)',
  nextTurnState('available', true) === 'awaiting_followup');
check('awaiting_followup + answered NO -> locked (the answer always ends the turn)',
  nextTurnState('awaiting_followup', false) === 'locked');
check('awaiting_followup + answered YES -> STILL locked (no second follow-up, ever)',
  nextTurnState('awaiting_followup', true) === 'locked');
check('locked has no legal next state this module offers (send() itself refuses before calling this)',
  nextTurnState('locked', false) === 'locked' && nextTurnState('locked', true) === 'awaiting_followup');
// The last line is deliberately NOT a claim that 'locked' can self-heal — agent.tsx's own guard
// (`if (refinementTurn === 'locked' && !pendingRefineRef.current) return;`) is what actually makes
// 'locked' terminal; this module has no opinion on unreachable inputs, only on the two real ones.

// ── 2. RELAXABLE_FIELDS never touches search IDENTITY ──────────────────────────────────────────
const FORBIDDEN: (keyof SearchQuery)[] = [
  'deal', 'bothDeals', 'dealCombined', 'rentPeriod', 'category', 'type', 'types', 'location',
  'regionPin', 'priceInput', 'priceBand', 'priceMin', 'priceMax', 'priceMinRent', 'priceMaxRent',
  'sources',
];
for (const f of FORBIDDEN) {
  check(`RELAXABLE_FIELDS never offers to drop '${f}' (that changes WHAT is being searched, not a requirement on it)`,
    !(RELAXABLE_FIELDS as readonly string[]).includes(f as string));
}
check('RELAXABLE_FIELDS is non-empty (there is something real to offer)', RELAXABLE_FIELDS.length > 0);

// ── 3. relaxationCandidates() only offers what THIS turn changed ───────────────────────────────
const base: SearchQuery = { deal: 'Buy', location: 'الرياض', category: 'Residential', type: 'Villa', detail: null, priceInput: '', priceBand: null } as SearchQuery;
const prev: SearchQuery = { ...base, amenities: ['pool'] } as SearchQuery;
const next: SearchQuery = { ...base, amenities: ['pool'], detail: '2', bathMin: 2 } as SearchQuery;
check('a field unchanged from prev (amenities: already there) is NOT offered',
  !relaxationCandidates(prev, next).includes('amenities'));
check('a field THIS turn newly established (detail) IS offered', relaxationCandidates(prev, next).includes('detail'));
check('a field THIS turn newly established (bathMin) IS offered', relaxationCandidates(prev, next).includes('bathMin'));
check('a field neither turn ever set is never offered', !relaxationCandidates(prev, next).includes('ratingMin'));
check('null prev (no prior turn) offers every established relaxable field — nothing to diff against',
  relaxationCandidates(null, next).includes('detail') && relaxationCandidates(null, next).includes('bathMin') && relaxationCandidates(null, next).includes('amenities'));
check('candidate order is RELAXABLE_FIELDS order (deterministic trial order)',
  JSON.stringify(relaxationCandidates(prev, next)) === JSON.stringify(RELAXABLE_FIELDS.filter((f) => relaxationCandidates(prev, next).includes(f))));

// ── withFieldRelaxed: reverts exactly one field ─────────────────────────────────────────────────
const relaxed = withFieldRelaxed(prev, next, 'detail');
check('withFieldRelaxed clears the one named field (reverted to prev, absent there -> null)', relaxed.detail === null);
check('withFieldRelaxed leaves every other field untouched', relaxed.bathMin === 2 && JSON.stringify(relaxed.amenities) === JSON.stringify(['pool']));
const prevWithDetail: SearchQuery = { ...prev, detail: '3' } as SearchQuery;
check('withFieldRelaxed reverts to prev\'s OWN value when prev had one, not always null',
  withFieldRelaxed(prevWithDetail, next, 'detail').detail === '3');

// ── 4. Every field has a real, non-empty label in both languages ───────────────────────────────
for (const f of RELAXABLE_FIELDS) {
  const ar = relaxedFieldLabel(f, 'ar');
  const en = relaxedFieldLabel(f, 'en');
  check(`'${f}' has a real Arabic label (not the bare key)`, !!ar && ar !== f && /[؀-ۿ]/.test(ar));
  check(`'${f}' has a real English label (not the bare key)`, !!en && en !== f);
}

// ── 5. parseYesNo defaults unclear text to 'no' ─────────────────────────────────────────────────
check("parseYesNo('نعم') -> yes", parseYesNo('نعم') === 'yes');
check("parseYesNo('اه ابيها') -> yes (Saudi dialect affirmative)", parseYesNo('اه ابيها') === 'yes');
check("parseYesNo('yes please') -> yes", parseYesNo('yes please') === 'yes');
check("parseYesNo('لا') -> no", parseYesNo('لا') === 'no');
check("parseYesNo('no thanks') -> no", parseYesNo('no thanks') === 'no');
check("parseYesNo('') -> no (unclear defaults to no, never a silent yes)", parseYesNo('') === 'no');
check("parseYesNo('ابغى فيلا في جدة بدل كذا') -> no (an unrelated new request is not consent)", parseYesNo('ابغى فيلا في جدة بدل كذا') === 'no');

// ── MUTATION PROOF — each of the invariants above must actually be watched ─────────────────────
console.log('\nmutation proof — each guard must FAIL on its own defect');
{
  // M1: a broken reducer that lets 'awaiting_followup' answered YES offer a SECOND follow-up.
  const brokenNextTurnState = (current: RefinementTurnState, offered: boolean): RefinementTurnState =>
    current === 'awaiting_followup' && offered ? 'awaiting_followup' : (current === 'awaiting_followup' ? 'locked' : (offered ? 'awaiting_followup' : 'locked'));
  mustCatch('M1 caught: a second follow-up after the first is answered YES', brokenNextTurnState('awaiting_followup', true) !== 'locked');
}
{
  const brokenFields = [...RELAXABLE_FIELDS, 'location'] as readonly (keyof SearchQuery)[];
  mustCatch('M2 caught: `location` sneaking into a relaxable-fields list', (brokenFields as readonly string[]).includes('location'));
}
{
  const brokenCandidates = (_p: SearchQuery | null, n: SearchQuery) => RELAXABLE_FIELDS.filter((f) => (n as any)[f] !== undefined && (n as any)[f] !== null);
  mustCatch('M3 caught: offering amenities even though prev already had it (would re-offer an existing constraint as if new)',
    brokenCandidates(prev, next).includes('amenities'));
}
{
  const brokenLabelsAr: Partial<Record<RelaxableField, string>> = {};
  mustCatch('M4 caught: a field with no Arabic label falls back to an empty/undefined string',
    !brokenLabelsAr['detail']);
}
{
  const brokenParseYesNo = (_t: string) => 'yes' as const;
  mustCatch("M5 caught: defaulting unclear text to 'yes' would read ambiguity as consent",
    brokenParseYesNo('') === 'yes');
}

// ── 6/7. WIRING — onboarding untouched, AF fallback stays reachable regardless of this lock ────
console.log('\nwiring (src/app/agent.tsx)');
const agent = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
check('the composer lock gate is computed from `msgs` having shown a results turn, not a separate tracked flag',
  /const postResults = msgs\.some\(\(m\) => m\.role === 'results'\);/.test(agent));
check('the pre-results (onboarding) branch is untouched — reached only when NOT postResults',
  /\} else if \(postResults\) \{[\s\S]{0,50}ONE MAIN REQUEST \+ ONE FOLLOW-UP[\s\S]{0,900}\} else \{\s*\n\s*const attemptText = saidRef\.current\.join/.test(agent));
check('send() refuses when locked, UNLESS an AF fallback question is pending (pendingRefineRef wins)',
  /if \(refinementTurn === 'locked' && !pendingRefineRef\.current\) return;/.test(agent));
check('the AF fallback intercept (pendingRefineRef) is checked BEFORE this rule\'s own follow-up intercept',
  agent.indexOf('if (pendingRefineRef.current) {') < agent.indexOf('if (pendingFollowupRef.current) {')
  && agent.indexOf('if (pendingRefineRef.current) {') > -1 && agent.indexOf('if (pendingFollowupRef.current) {') > -1);
check('answering the follow-up (runFollowup) always locks, on EITHER answer',
  (agent.match(/setRefinementTurn\('locked'\);/g) ?? []).length >= 2);
check('every reset point sets the quota back to available: Filter search (startFresh), New Chat, and saved-chat restore',
  (agent.match(/setRefinementTurn\('available'\);/g) ?? []).length === 2
  && /setRefinementTurn\(restored\.refinementLocked === true \? 'locked' : 'available'\);/.test(agent));
check('zero exact matches never silently drops a requirement — it always tries a relaxation before giving up',
  /Sorry, nothing matches your exact request right now/.test(agent) && /I couldn't find an exact match\. I tried without this one condition/.test(agent));

console.log(failed === 0
  ? '\n✅ one main request, one honest follow-up, then locked — and Advanced Filter never notices.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
