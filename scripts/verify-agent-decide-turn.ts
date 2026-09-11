// Regression + mutation guard for the SINGLE DECISION AUTHORITY (supabase/functions/agent/decide.ts),
// extracted from supabase/functions/agent/index.ts in the owner-approved architecture consolidation
// of 2026-08-30. Read decide.ts's file header before touching either.
//
// PER THE STANDING "NEVER TEST A COPY OF PRODUCTION CODE" RULE, this imports and EXECUTES the real
// decideAgentTurn()/hasEnoughToSearch()/wantsGuidedInterview() — never a hand-typed reimplementation.
//
//   node --experimental-strip-types scripts/verify-agent-decide-turn.ts   (auto-discovered by npm test)

import { decideAgentTurn, hasEnoughToSearch, wantsGuidedInterview, QUESTION_BUDGET_CEILING } from '../supabase/functions/agent/decide.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const empty = {
  location: null, type: null, price: null, detail: null, amenities: null, af: null, priorAskAbout: null,
} as const;

console.log('\n(0) ONE MAIN REQUEST + ONE LOCATION QUESTION (owner, 2026-09-11) — the new ceiling\n');
check('(0) QUESTION_BUDGET_CEILING is exactly 1 (was 2)', QUESTION_BUDGET_CEILING === 1);

// SUPERSEDED 2026-09-04 — read this before "fixing" a failure here.
// This block used to assert that ANY single signal, WITH NO LOCATION, searched immediately
// ("search anyway ... broad/nationwide if that's nothing at all", owner 2026-08-30). The owner
// removed nationwide from the product on 2026-09-04: a search with no city is the one search that
// cannot be scoped, and it was reaching production (39,055 listings, p_cities null). LOCATION IS
// NOW REQUIRED; the 2026-08-30 rule still governs every OPTIONAL field.
// The original intent — "real signal means search, don't interrogate" — is preserved and still
// asserted, now paired with a city.
console.log('\n(a) real signal + a real city, askCount=0 -> listings\n');
for (const [label, state] of [
  ['location', { ...empty, location: 'الرياض', type: 'Villa' }],
  ['type', { ...empty, location: 'الرياض', type: 'Villa' }],
  ['price', { ...empty, location: 'الرياض', type: 'Villa', price: '500000' }],
  ['detail', { ...empty, location: 'الرياض', type: 'Villa', detail: '3' }],
  ['amenities', { ...empty, location: 'الرياض', type: 'Villa', amenities: ['parking'] }],
  ['af', { ...empty, location: 'الرياض', type: 'Villa', af: { bathrooms: 2 } }],
] as const) {
  const r = decideAgentTurn({ rawText: 'شقة', locationAmbiguous: false, establishedState: state, askCount: 0 });
  check(`(a) ${label} + city -> listings`, r.kind === 'listings' && r.askCount === 0, JSON.stringify(r));
}

// SUPERSEDED 2026-09-11 (owner: "Never ask about... type/price/bedrooms/amenities — only location,
// and only once"). The 2026-09-06 "location + property type ⇒ ask" step is DELETED, not rebounded —
// a location with no type now searches every type at once, immediately, no question at all.
console.log('\n(a3) a location with NO property type NOW SEARCHES IMMEDIATELY — type is never asked about\n');
{
  const st = { ...empty, location: 'جدة' };
  check('(a3) location alone -> listings, no question (was: message asking for type)',
    decideAgentTurn({ rawText: 'ابغى عقار في جدة', locationAmbiguous: false, establishedState: st, askCount: 0 }).kind === 'listings');
  check('(a3) …at any askCount, still listings (there is no type-question ceiling left to hit)',
    decideAgentTurn({ rawText: 'x', locationAmbiguous: false, establishedState: st, askCount: 50 }).kind === 'listings');
  check('(a3) …and a type supplied changes nothing — still searches immediately',
    decideAgentTurn({ rawText: 'x', locationAmbiguous: false, establishedState: { ...st, type: 'Apartment' }, askCount: 0 }).kind === 'listings');
}

console.log('\n(a2) the SAME signal with NO usable location -> message (nationwide is not a scope)\n');
for (const [label, state] of [
  ['type', { ...empty, type: 'Villa' }],
  ['price', { ...empty, price: '500000' }],
  ['detail', { ...empty, detail: '3' }],
  ['amenities', { ...empty, amenities: ['parking'] }],
  ['af', { ...empty, af: { bathrooms: 2 } }],
  ['country-as-location', { ...empty, type: 'Villa', location: 'المملكة العربية السعودية' }],
  ['«كل مدن المملكة»', { ...empty, type: 'Apartment', location: 'كل مدن المملكة' }],
] as const) {
  const r = decideAgentTurn({ rawText: 'شقة', locationAmbiguous: false, establishedState: state, askCount: 0 });
  check(`(a2) ${label} without a real place -> message (the one location question)`, r.kind === 'message' && !r.unsearchable, JSON.stringify(r));
}

console.log('\n(b) truly nothing at all, askCount=0 -> message (the one location question)\n');
{
  const r = decideAgentTurn({ rawText: 'مرحبا', locationAmbiguous: false, establishedState: empty, askCount: 0 });
  check('(b) nothing established -> message, askCount+1, not unsearchable yet',
    r.kind === 'message' && r.askCount === 1 && !r.unsearchable, JSON.stringify(r));
}

console.log('\n(c) THE MANDATORY CASE — only ask_about=["size"], nothing else, askCount=0, NO CITY -> message\n');
{
  // This is the exact gap the dissenting reviewer found on PR #1382's ship (2026-08-30): the
  // bedroom-hallucination-without-word guard unconditionally injects ask_about=["size"], and with no
  // code-level check on whether the question budget was actually spent, a FIRST-TURN vague utterance
  // with nothing else set could trigger an immediate nationwide, type-less search instead of one
  // clarifying question. establishedState.priorAskAbout is deliberately fed as null here — this is
  // turn 1, so there is no PRIOR turn for it to have survived into yet. NO location either, so this
  // now hits step 1 (location unresolved) regardless of ask_about at all — the mandatory case's
  // real assertion (hasEnoughToSearch alone must not decide this) is pinned directly below.
  const state = { ...empty, priorAskAbout: null };
  const r = decideAgentTurn({ rawText: 'أبي بيت كبير', locationAmbiguous: false, establishedState: state, askCount: 0 });
  check('(c) fresh-turn-only ask_about=["size"], no city, askCount=0 -> message, NOT listings',
    r.kind === 'message' && r.askCount === 1,
    `got ${JSON.stringify(r)} — a first-turn vague size cue with no city must still ask for the city`);
  // hasEnoughToSearch() itself must also say false directly, since that is the actual function whose
  // gap this case exists to close.
  check('(c) hasEnoughToSearch() itself is false for fresh-only ask_about with nothing else',
    hasEnoughToSearch(state) === false);
  // With a city ALSO present, ask_about carried from a PRIOR turn is real signal (step 2, unchanged).
  const withCityAndCarried = decideAgentTurn({
    rawText: 'بيت كبير في الرياض', locationAmbiguous: false,
    establishedState: { ...empty, location: 'الرياض', priorAskAbout: ['size'] }, askCount: 1,
  });
  check('(c) PRIOR-turn ask_about + a city -> listings', withCityAndCarried.kind === 'listings', JSON.stringify(withCityAndCarried));
}

console.log('\n(e) askCount at the ceiling with EVERYTHING empty -> UNSEARCHABLE, never a nationwide search, never asks again\n');
{
  const r = decideAgentTurn({ rawText: 'ما ادري', locationAmbiguous: false, establishedState: empty, askCount: QUESTION_BUDGET_CEILING });
  check('(e) ceiling spent, no place named -> message, unsearchable, askCount UNCHANGED (not a question)',
    r.kind === 'message' && r.unsearchable === true && r.askCount === QUESTION_BUDGET_CEILING, JSON.stringify(r));
  const withCity = decideAgentTurn({ rawText: 'ما ادري', locationAmbiguous: false, establishedState: { ...empty, location: 'الرياض' }, askCount: QUESTION_BUDGET_CEILING });
  check('(e) ceiling spent WITH a city -> listings (a resolved location always searches)',
    withCity.kind === 'listings' && withCity.askCount === QUESTION_BUDGET_CEILING, JSON.stringify(withCity));
  // One below the ceiling, still nothing -> must still ask (the ceiling is a HARD boundary).
  const under = decideAgentTurn({ rawText: 'ما ادري', locationAmbiguous: false, establishedState: empty, askCount: QUESTION_BUDGET_CEILING - 1 });
  check('(e) one question short of the ceiling, nothing known -> still asks (not yet unsearchable)',
    under.kind === 'message' && !under.unsearchable);
  // Beyond the ceiling too — stays unsearchable, never flips back to asking.
  const wayOver = decideAgentTurn({ rawText: 'ما ادري', locationAmbiguous: false, establishedState: empty, askCount: 50 });
  check('(e) askCount=50, no place -> STILL unsearchable, not a loop', wayOver.kind === 'message' && wayOver.unsearchable === true);
}

console.log('\n(f) a DB-confirmed twin-city/region/district ambiguity -> message while budget remains\n');
{
  const withSignal = decideAgentTurn({
    rawText: 'الهفوف', locationAmbiguous: true,
    establishedState: { ...empty, location: 'الهفوف', type: 'Villa', price: '900000' }, askCount: 0,
  });
  check('(f) ambiguity wins even with real signal present, while budget remains',
    withSignal.kind === 'message' && withSignal.askCount === 1 && !withSignal.unsearchable, JSON.stringify(withSignal));
}

console.log('\n(f2) THE LOCATION QUESTION IS NOW BOUNDED TOO (owner, 2026-09-11) — one ask, then UNSEARCHABLE, never a loop, never nationwide\n');
{
  // SUPERSEDED 2026-09-05's "unbounded location question outranks the ceiling" ruling. That rule
  // existed to stop a DIFFERENT bug (falling back to a nationwide search once a bounded ceiling was
  // spent — see the production incident in decide.ts's own file comment). The 2026-09-11 owner rule
  // solves the SAME bug a different way: once the ceiling is spent, the ladder neither loops NOR
  // searches nationwide — it says plainly it can't narrow this down (`unsearchable`) and stops.
  const first = decideAgentTurn({ rawText: 'الهفوف', locationAmbiguous: true, establishedState: empty, askCount: 0 });
  check('(f2) askCount=0 (under the ceiling) -> still asks, not unsearchable yet',
    first.kind === 'message' && first.askCount === 1 && !first.unsearchable, JSON.stringify(first));
  for (const askCount of [QUESTION_BUDGET_CEILING, QUESTION_BUDGET_CEILING + 3, 50]) {
    const r = decideAgentTurn({ rawText: 'الهفوف', locationAmbiguous: true, establishedState: empty, askCount });
    check(`(f2) askCount=${askCount} -> unsearchable, never a second question, never nationwide`,
      r.kind === 'message' && r.unsearchable === true, JSON.stringify(r));
  }
  // THE EXIT — once the ambiguity IS resolved (the caller passes locationAmbiguous:false and a
  // concrete location), it searches immediately regardless of how high askCount climbed getting there.
  for (const askCount of [QUESTION_BUDGET_CEILING, 50]) {
    const r = decideAgentTurn({ rawText: 'مدينة الرياض', locationAmbiguous: false,
      establishedState: { ...empty, location: 'مدينة الرياض' }, askCount });
    check(`(f2) THE EXIT: once answered, askCount=${askCount} searches immediately`,
      r.kind === 'listings', JSON.stringify(r));
  }
}

console.log('\n(g) the interview phrase gate is deterministic, not a trusted model claim\n');
{
  check('(g) "guide me step by step" -> wantsGuidedInterview() true', wantsGuidedInterview('can you guide me step by step?'));
  check('(g) a matching phrase -> decideAgentTurn kind=interview',
    decideAgentTurn({ rawText: 'please walk me through it', locationAmbiguous: false, establishedState: empty, askCount: 0 }).kind === 'interview');
  // decideAgentTurn takes no modelOut/claimed-kind input at all — there is no parameter through
  // which a model's own kind="interview" claim could reach it. A non-matching text falls through to
  // the normal ladder regardless of what the model said elsewhere in index.ts (which never reads
  // out.kind again after this function is called — see index.ts's own comment at the import site).
  const fallthrough = decideAgentTurn({ rawText: 'ابي شقة في جدة', locationAmbiguous: false, establishedState: { ...empty, location: 'جدة', type: 'Apartment' }, askCount: 0 });
  check('(g) a non-matching text never falls into interview, regardless of any model claim', fallthrough.kind === 'listings', JSON.stringify(fallthrough));
  check('(g) a non-matching text is correctly NOT flagged by the deterministic gate', wantsGuidedInterview('ابي شقة في جدة') === false);
}

console.log('\nmutation proof — each guard above must actually be watched failing\n');
const mustCatch = (label: string, brokenResult: boolean) => check(`(mutation) ${label}`, brokenResult);
{
  // M1: a broken ladder that re-asks about TYPE (the deleted 2026-09-06 step) instead of searching.
  const brokenAsksType = (loc: string, type: string | null) => (!type ? 'message' : 'listings');
  mustCatch('M1 caught: a location with no type asking again (the deleted type-question) would be wrong',
    brokenAsksType('جدة', null) === 'message' &&
    decideAgentTurn({ rawText: 'x', locationAmbiguous: false, establishedState: { ...empty, location: 'جدة' }, askCount: 0 }).kind === 'listings');
  // M2: a ladder that keeps asking past the ceiling instead of going unsearchable.
  const brokenLoops = (askCount: number) => askCount < 999 ? 'message-question' : 'message-terminal';
  mustCatch('M2 caught: looping past the ceiling instead of terminating unsearchable',
    brokenLoops(50) === 'message-question' &&
    decideAgentTurn({ rawText: 'x', locationAmbiguous: false, establishedState: empty, askCount: 50 }).unsearchable === true);
  // M3: unsearchable wrongly incrementing askCount (would make it look like a live question).
  const r3 = decideAgentTurn({ rawText: 'x', locationAmbiguous: false, establishedState: empty, askCount: QUESTION_BUDGET_CEILING });
  mustCatch('M3 caught: unsearchable must NOT increment askCount (it is not a question)',
    r3.askCount === QUESTION_BUDGET_CEILING);
  // M4: the ceiling silently reverting to 2.
  mustCatch('M4 caught: QUESTION_BUDGET_CEILING must be exactly 1, not 2', QUESTION_BUDGET_CEILING === 1);
}

console.log(failures === 0
  ? '\n✅ verify-agent-decide-turn: all checks passed.\n'
  : `\n❌ verify-agent-decide-turn: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
