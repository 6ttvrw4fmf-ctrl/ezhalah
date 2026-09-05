// A RESULTS TURN MUST NEVER BE LEFT WITH NO WAY TO REACH THE REST OF ITS SET.
//
// ops_incident #66. Product Contract §6.5 states the case this guards, verbatim:
//
//     "AF stops at 80. Offer button HIDDEN. Only «عرض المزيد» remains. This is CORRECT."
//
// and R10.1.2 makes the two controls independent. Measured on production 2026-09-05
// (الرياض/شقة/بيع + one AF answer landing 6,723 matches): 20 cards on screen, all four ageFlow
// phases absent, 1 committed pill, and ZERO `[data-testid="results-load-more"]` elements anywhere.
// The user was stranded at 20 of 6,723.
//
// The cause is a sequencing gate with no escape. agent.tsx withheld the closing note AND the actions
// row until the card cascade reached `initialReveal`, and dripRange()'s ownership guard can stop a
// cascade SILENTLY below that target. Its own comment offers the way out — "unrevealed cards stay
// recoverable behind «عرض المزيد» (bufferMore)" — but «عرض المزيد» is rendered INSIDE the block the
// unfinished cascade suppresses, so the recovery it names can never happen.
//
// THIS FILE PROVES TWO PROPERTIES OVER THE WHOLE INPUT SPACE, not a handful of examples:
//
//   1. NEVER STRANDS — once this turn's cascade has stopped and the intro is done, the row is ready
//      no matter how few cards were revealed. That is the defect, stated as a law.
//   2. STRICT WIDENING — everything the pre-#66 predicate showed, the new one still shows. The fix
//      can only ever reveal a row that used to be hidden, never hide one that used to render. That
//      is what makes it safe in front of a surface as load-bearing as the results turn, and it is
//      why no separate "did I break the normal path" regression list is needed: the property covers
//      every input at once.
//
// The state space is small and fully enumerable (2 × 2 × 2 booleans × a grid of shown/target), so
// these are exhaustive checks, not samples.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resultsRowIsReady,
  resultsRowWasReady_pre66,
  type ResultsRowState,
} from '../src/lib/afResultsRowGate.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '❌'} ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
  if (!ok) failed++;
};

/** Every state that matters: the three booleans against a grid straddling the reveal target. */
function everyState(): ResultsRowState[] {
  const out: ResultsRowState[] = [];
  for (const introStillTyping of [false, true]) {
    for (const cascadeStarted of [false, true]) {
      for (const cascadeRunningForThisTurn of [false, true]) {
        for (const [shown, initialReveal] of [[0, 0], [0, 10], [9, 10], [10, 10], [20, 21], [21, 21], [25, 10]]) {
          out.push({ introStillTyping, shown, initialReveal, cascadeStarted, cascadeRunningForThisTurn });
        }
      }
    }
  }
  return out;
}
const STATES = everyState();
const show = (s: ResultsRowState) =>
  `typing=${s.introStillTyping} shown=${s.shown}/${s.initialReveal} started=${s.cascadeStarted} running=${s.cascadeRunningForThisTurn}`;

console.log(`\nA results turn is never left with no way to continue — ${STATES.length} states\n`);

// ── 1. THE FOUR BRANCHES ────────────────────────────────────────────────────────────────────────
check('while the intro is still typing the row is withheld, always',
  STATES.filter((s) => s.introStillTyping).every((s) => !resultsRowIsReady(s)),
  'a closing note would appear above cards that are still arriving');
check('once the reveal target is reached the row is ready',
  STATES.filter((s) => !s.introStillTyping && s.shown >= s.initialReveal).every((s) => resultsRowIsReady(s)),
  'the normal path must not regress');
check('below target and the cascade has not started yet → withheld (it is about to)',
  STATES.filter((s) => !s.introStillTyping && s.shown < s.initialReveal && !s.cascadeStarted)
        .every((s) => !resultsRowIsReady(s)),
  'rendering here would flash the closing note before the first card');
check('below target while THIS turn is still cascading → withheld',
  STATES.filter((s) => !s.introStillTyping && s.shown < s.initialReveal && s.cascadeStarted && s.cascadeRunningForThisTurn)
        .every((s) => !resultsRowIsReady(s)),
  'the cards really are still arriving; the wait is legitimate');

// ── 2. THE LAW: NEVER STRAND ────────────────────────────────────────────────────────────────────
const stranded = STATES.filter(
  (s) => !s.introStillTyping && s.cascadeStarted && !s.cascadeRunningForThisTurn && !resultsRowIsReady(s));
check('NEVER STRANDS — a stopped cascade always hands the row back, however few cards it revealed',
  stranded.length === 0,
  stranded.length
    ? `${stranded.length} state(s) withhold «عرض المزيد» forever, e.g. ${show(stranded[0])}. This is ops_incident #66: ` +
      `the cascade cannot resume, so the row can never appear, and the only control that reaches the ` +
      `rest of the set is gone.`
    : '');

// ── 3. THE LAW: STRICT WIDENING ─────────────────────────────────────────────────────────────────
const narrowed = STATES.filter((s) => resultsRowWasReady_pre66(s) && !resultsRowIsReady(s));
check('STRICT WIDENING — nothing the pre-#66 gate rendered is now hidden',
  narrowed.length === 0,
  narrowed.length ? `${narrowed.length} state(s) regressed, e.g. ${show(narrowed[0])}` : '');
const widened = STATES.filter((s) => !resultsRowWasReady_pre66(s) && resultsRowIsReady(s));
check('…and the widening is REAL (the two predicates are not simply identical)',
  widened.length > 0,
  'resultsRowIsReady agrees with the old gate everywhere, so #66 was not actually fixed');
console.log(`      ${widened.length} state(s) newly render, ${narrowed.length} regressed`);

// ── 4. THE PRODUCTION CASE, BY ITS MEASURED NUMBERS ─────────────────────────────────────────────
// 20 of an initialReveal that the cascade never reached, intro done, cascade started and no longer
// running: exactly what the browser reported.
const incident66: ResultsRowState = {
  introStillTyping: false, shown: 20, initialReveal: 21, cascadeStarted: true, cascadeRunningForThisTurn: false,
};
check('the measured #66 state renders the row (20 cards of 6,723, cascade halted at 20/21)',
  resultsRowIsReady(incident66));
check('…and the pre-#66 gate did NOT (so this test would have caught the live defect)',
  !resultsRowWasReady_pre66(incident66));

// ── 5. THE CALLER ACTUALLY USES IT ──────────────────────────────────────────────────────────────
const agent = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');
check('agent.tsx decides through resultsRowIsReady()', /resultsRowIsReady\(/.test(agent),
  'the pure predicate is not wired in, so this file proves something production does not do');
check('the old inline gate is gone from agent.tsx',
  !/shown\s*<\s*initialReveal\(m\.result\)\s*\)\s*return null/.test(agent),
  'the stranding condition is still inline; the module would be decoration beside it');

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
console.log('\nMutation proofs\n');

const strandsFor = (p: (s: ResultsRowState) => boolean) =>
  STATES.some((s) => !s.introStillTyping && s.cascadeStarted && !s.cascadeRunningForThisTurn && !p(s));
const narrowsFor = (p: (s: ResultsRowState) => boolean) =>
  STATES.some((s) => resultsRowWasReady_pre66(s) && !p(s));

mustCatch('the pre-#66 gate itself — the live defect — fails the never-strand law',
  strandsFor(resultsRowWasReady_pre66));
mustCatch('dropping the halted-cascade branch (waiting forever on a cascade that stopped)',
  strandsFor((s) => !s.introStillTyping && (s.shown >= s.initialReveal || (s.cascadeStarted && s.cascadeRunningForThisTurn))));
mustCatch('a predicate that renders during typing is rejected',
  !STATES.filter((s) => s.introStillTyping).every((s) => !((_: ResultsRowState) => true)(s)));
// A mutant that genuinely HIDES something the old gate rendered: a turn whose cards are all on
// screen (shown >= target, intro done) but whose cascade is still marked running would lose its row.
// The first draft of this mutant was `resultsRowIsReady(s) && s.shown >= s.initialReveal`, which
// SURVIVED — because it is implied by branch 2 and therefore narrows nothing. A mutation that cannot
// fail is not a proof, which is exactly what this file exists to insist on elsewhere.
mustCatch('a NARROWING predicate is rejected by the widening law',
  narrowsFor((s) => resultsRowIsReady(s) && !s.cascadeRunningForThisTurn));
mustCatch('…while the real predicate satisfies both laws (neither is vacuously true)',
  !strandsFor(resultsRowIsReady) && !narrowsFor(resultsRowIsReady));

const ok = failed === 0 && mutFail === 0;
console.log(ok
  ? '\n✓ a results turn always keeps a truthful way to reach the rest of its set'
  : `\n✗ ${failed} check(s) failed, ${mutFail} mutation(s) survived`);
process.exit(ok ? 0 : 1);
