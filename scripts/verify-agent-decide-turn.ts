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

console.log('\n(a) merged-state has real signal, askCount=0 -> listings\n');
for (const [label, state] of [
  ['location', { ...empty, location: 'الرياض' }],
  ['type', { ...empty, type: 'Villa' }],
  ['price', { ...empty, price: '500000' }],
  ['detail', { ...empty, detail: '3' }],
  ['amenities', { ...empty, amenities: ['parking'] }],
  ['af', { ...empty, af: { bathrooms: 2 } }],
] as const) {
  const r = decideAgentTurn({ rawText: 'شقة', locationAmbiguous: false, establishedState: state, askCount: 0 });
  check(`(a) ${label} alone -> listings`, r.kind === 'listings' && r.askCount === 0, JSON.stringify(r));
}

console.log('\n(b) truly nothing at all, askCount=0 -> message\n');
{
  const r = decideAgentTurn({ rawText: 'مرحبا', locationAmbiguous: false, establishedState: empty, askCount: 0 });
  check('(b) nothing established -> message, askCount+1', r.kind === 'message' && r.askCount === 1, JSON.stringify(r));
}

console.log('\n(c) THE MANDATORY NEW CASE — only ask_about=["size"], nothing else, askCount=0 -> message\n');
{
  // This is the exact gap the dissenting reviewer found on PR #1382's ship (2026-08-30): the
  // bedroom-hallucination-without-word guard unconditionally injects ask_about=["size"], and with no
  // code-level check on whether the question budget was actually spent, a FIRST-TURN vague utterance
  // with nothing else set could trigger an immediate nationwide, type-less search instead of one
  // clarifying question. establishedState.priorAskAbout is deliberately fed as null here — this is
  // turn 1, so there is no PRIOR turn for it to have survived into yet (see decide.ts's own doc on
  // EstablishedState.priorAskAbout for why THIS turn's fresh ask_about must not count on its own).
  const state = { ...empty, priorAskAbout: null };
  const r = decideAgentTurn({ rawText: 'أبي بيت كبير', locationAmbiguous: false, establishedState: state, askCount: 0 });
  check('(c) fresh-turn-only ask_about=["size"], askCount=0 -> message, NOT listings',
    r.kind === 'message' && r.askCount === 1,
    `got ${JSON.stringify(r)} — a first-turn vague size cue must still cost one clarifying question`);
  // hasEnoughToSearch() itself must also say false directly, since that is the actual function whose
  // gap this case exists to close.
  check('(c) hasEnoughToSearch() itself is false for fresh-only ask_about with nothing else',
    hasEnoughToSearch(state) === false);
}

console.log('\n(d) ask_about=["size"] present, askCount=2 (budget exhausted) -> listings (PR #1382\'s fix stays fixed)\n');
{
  // Once ask_about has SURVIVED a turn (i.e. it is now the PRIOR established state — what
  // mergeConversationState carried in), it becomes real signal for step 2 too. Test both paths that
  // reach listings here: via step 3 (budget exhausted) regardless of priorAskAbout, AND via step 2
  // once priorAskAbout is populated even before the budget is spent.
  const viaBudget = decideAgentTurn({
    rawText: 'بيت كبير', locationAmbiguous: false,
    establishedState: { ...empty, priorAskAbout: null }, askCount: QUESTION_BUDGET_CEILING,
  });
  check('(d) askCount at the ceiling -> listings regardless of ask_about provenance',
    viaBudget.kind === 'listings' && viaBudget.askCount === QUESTION_BUDGET_CEILING, JSON.stringify(viaBudget));

  const viaCarried = decideAgentTurn({
    rawText: 'بيت كبير', locationAmbiguous: false,
    establishedState: { ...empty, priorAskAbout: ['size'] }, askCount: 1,
  });
  check('(d) ask_about carried from a PRIOR turn -> listings even before the ceiling',
    viaCarried.kind === 'listings' && viaCarried.askCount === 1, JSON.stringify(viaCarried));
}

console.log('\n(e) askCount at the ceiling with EVERYTHING empty too -> listings anyway, broad/nationwide\n');
{
  const r = decideAgentTurn({ rawText: 'ما ادري', locationAmbiguous: false, establishedState: empty, askCount: QUESTION_BUDGET_CEILING });
  check('(e) budget exhausted, nothing known -> listings ("missing optional information must not block it")',
    r.kind === 'listings' && r.askCount === QUESTION_BUDGET_CEILING, JSON.stringify(r));
  // One below the ceiling, still nothing -> must still ask (the ceiling is a HARD boundary, not "close").
  const under = decideAgentTurn({ rawText: 'ما ادري', locationAmbiguous: false, establishedState: empty, askCount: QUESTION_BUDGET_CEILING - 1 });
  check('(e) one question short of the ceiling, nothing known -> still asks', under.kind === 'message');
}

console.log('\n(f) a DB-confirmed twin-city/region/district ambiguity -> message while budget remains\n');
{
  const withSignal = decideAgentTurn({
    rawText: 'الهفوف', locationAmbiguous: true,
    establishedState: { ...empty, location: 'الهفوف', type: 'Villa', price: '900000' }, askCount: 0,
  });
  check('(f) ambiguity wins even with real signal present, while budget remains', withSignal.kind === 'message' && withSignal.askCount === 1, JSON.stringify(withSignal));
}

console.log('\n(f2) UNBOUNDED LOCATION-AMBIGUITY LOOP (round 2 fix) — the ambiguity must respect the SAME budget ceiling every other clarification does, not ask forever\n');
{
  // Round 1 proved this returned kind="message" at askCount 0, 1, 2, 5, AND 50 — unbounded. The fix:
  // once askCount reaches the ceiling, an unresolved ambiguity falls through to steps 2/3 like any
  // other missing field, converging on "listings" instead of asking forever. (index.ts's own
  // buildTurnDecision() — scripts/verify-agent-turn-wiring.ts — is what then treats the STILL-
  // unresolved location term as absent rather than guessing it; this decide.ts-level test only
  // proves the ladder itself converges.)
  for (const askCount of [0, 1]) {
    const r = decideAgentTurn({ rawText: 'الهفوف', locationAmbiguous: true, establishedState: empty, askCount });
    check(`(f2) askCount=${askCount} (under the ceiling) -> still asks`, r.kind === 'message' && r.askCount === askCount + 1, JSON.stringify(r));
  }
  for (const askCount of [QUESTION_BUDGET_CEILING, QUESTION_BUDGET_CEILING + 3, 50]) {
    const r = decideAgentTurn({ rawText: 'الهفوف', locationAmbiguous: true, establishedState: empty, askCount });
    check(`(f2) askCount=${askCount} (at/past the ceiling) -> converges to listings, not an infinite ask`,
      r.kind === 'listings' && r.askCount === askCount, JSON.stringify(r));
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
  const fallthrough = decideAgentTurn({ rawText: 'ابي شقة في جدة', locationAmbiguous: false, establishedState: { ...empty, location: 'جدة' }, askCount: 0 });
  check('(g) a non-matching text never falls into interview, regardless of any model claim', fallthrough.kind === 'listings', JSON.stringify(fallthrough));
  check('(g) a non-matching text is correctly NOT flagged by the deterministic gate', wantsGuidedInterview('ابي شقة في جدة') === false);
}

console.log(failures === 0
  ? '\n✅ verify-agent-decide-turn: all checks passed.\n'
  : `\n❌ verify-agent-decide-turn: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
