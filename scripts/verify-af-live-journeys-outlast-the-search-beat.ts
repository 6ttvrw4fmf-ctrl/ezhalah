// A POST-SEARCH READ MUST OUTLAST THE SEARCHING BEAT — AND NOBODY MAY TYPE THE BEAT.
//
// THE INCIDENT THIS EXISTS TO PREVENT (2026-09-06). The owner raised the searching beat that
// morning — "let the user wait 10 seconds … make sure all the platforms in the animation show
// clearly, cuz doing it quick will make them lost" (agent.tsx SEARCH_MIN_MS 2,200 → 10,000, plus
// LOADER_EXIT_MS 450). The beat HOLDS THE PREVIOUS SCREEN while it plays and the loader sits on top
// of it, intercepting pointer events. Within hours SEVEN steps across FIVE live checks went red on
// the AF backend-truth workflow, and every one of them accused production of a product defect:
//
//   verify-af-card-evidence-live      read at a fixed +4,000ms → 0 cards, 0 «مطابق لطلبك» strips
//                                     → «§12A is not honest on the live card» (R12A/R13.12)
//   verify-combined-budget-live       quiesced on the FILTER FORM's own «ر.س» label (stably 1)
//                                     → «RENT cards are on screen — the Buy floor did not delete
//                                       them», i.e. the pre-2026-09-02 rent-deletion defect
//   verify-af-agent-cta-live          sampled 30s for a card that arrives behind a ~40s LLM turn
//                                     → «the offer gate and the round gate disagree» (R4.4.2/R13.10)
//   verify-af-pill-removal-live       walked the round on fixed 3,500/3,800ms sleeps → clicked into
//                                     the loader («subtree intercepts pointer events»), too few
//                                     pills to remove
//
// Not one of those was true. Production was correct the whole time; re-run with the arrival
// OBSERVED, the same checks pass. This is the class scripts/lib/afJourneyPacing.ts was already
// written about — "never assert on a state that never arrived" — applied one screen further on,
// to the results turn a committed answer produces.
//
// WHY A BARRIER AND NOT JUST THE FIX. The defect was not any one number. It was that the harness
// kept a PRIVATE COPY of a product constant it does not own, in five places, none of which had any
// way to learn the constant had moved. Raising each number would rebuild the same trap for whoever
// changes the beat next. So the floor is now DERIVED from agent.tsx (readSearchBeatMs) and this
// file proves three things that together make the trap unbuildable:
//
//   1. the derivation is LIVE — it reads the real product source, and FAILS CLOSED if it cannot;
//   2. the pacing helpers genuinely OBSERVE arrival, proven by executing them, not by reading them;
//   3. any journey that still TYPES a beat-sized wait is registered, with a reason, and must be
//      provably ≥ the live beat — so the next time the beat rises, this goes red and names the
//      files, instead of five journeys filing product defects at 3am.
//
// Offline and deterministic: no network, no browser, no production. Safe inside `npm test`.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readSearchBeatMs, SEARCH_BEAT_MS, POST_SEARCH_BUDGET_MS,
  awaitResultsTurn, awaitAfStep, AGENT_TURN_MS,
} from './lib/afJourneyPacing.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nA post-search read must outlast the searching beat, and nobody may type the beat\n');

// ── 1. THE DERIVATION IS LIVE ───────────────────────────────────────────────────────────────────
const beat = readSearchBeatMs();
check('the beat is READ from the product (src/app/agent.tsx), not typed into the harness',
  Number.isFinite(beat.floorMs) && beat.floorMs > 0 && Number.isFinite(beat.exitMs) && beat.exitMs >= 0,
  `SEARCH_MIN_MS=${beat.floorMs} LOADER_EXIT_MS=${beat.exitMs}`);
check('SEARCH_BEAT_MS is exactly the product\'s floor + exit (no margin baked into the constant)',
  SEARCH_BEAT_MS === beat.floorMs + beat.exitMs, `${SEARCH_BEAT_MS} vs ${beat.floorMs} + ${beat.exitMs}`);
check('a post-search budget leaves room for the agent turn that follows the beat',
  POST_SEARCH_BUDGET_MS >= SEARCH_BEAT_MS + AGENT_TURN_MS,
  `${POST_SEARCH_BUDGET_MS}ms budget vs ${SEARCH_BEAT_MS}ms beat + ${AGENT_TURN_MS}ms turn`);
check('the beat currently honours the owner\'s ten seconds (2026-09-06)',
  beat.floorMs >= 10_000, `SEARCH_MIN_MS=${beat.floorMs}`);

// ── 2. THE HELPERS ACTUALLY OBSERVE — EXECUTED, NOT READ ────────────────────────────────────────
// A virtual clock: `sleep` advances time without spending it, so the beat is exercised in full at
// no wall-clock cost. Executing beats grepping — every barrier that missed a defect on this surface
// missed it by reading source text.
const virtualClock = () => {
  let now = 0;
  const sleep = async (ms: number) => { now += ms; };
  return { sleep, at: () => now };
};

{
  // (a) the arrival is LATE — behind the full beat. The helper must keep polling and still catch it.
  const clock = virtualClock();
  const cards = () => Promise.resolve(clock.at() >= SEARCH_BEAT_MS ? 12 : 0);
  const r = await awaitResultsTurn(cards, clock.sleep);
  check('awaitResultsTurn waits THROUGH the beat and still sees a late results turn',
    r.settled && r.cards === 12 && clock.at() >= SEARCH_BEAT_MS,
    `settled=${r.settled} cards=${r.cards} observed at ${clock.at()}ms (beat ${SEARCH_BEAT_MS}ms)`);
}
{
  // (b) nothing ever arrives — the caller MUST be told, never handed a screen to judge.
  const clock = virtualClock();
  const r = await awaitResultsTurn(() => Promise.resolve(0), clock.sleep);
  check('awaitResultsTurn reports settled=false when the results turn never arrives',
    r.settled === false && r.cards === 0, `settled=${r.settled} cards=${r.cards}`);
}
{
  // (c) already on screen — a fast run must not be taxed by the large budget.
  const clock = virtualClock();
  const r = await awaitResultsTurn(() => Promise.resolve(5), clock.sleep);
  check('awaitResultsTurn returns immediately when the turn is already rendered (no artificial hold)',
    r.settled && clock.at() === 0, `observed at ${clock.at()}ms`);
}
{
  const mk = <T,>(v: T) => async () => v;
  const clock = virtualClock();
  let polls = 0;
  const late = await awaitAfStep(
    async () => (++polls > 3 ? ['af-option-x'] : []), mk(true), mk(false), clock.sleep);
  const ended = await awaitAfStep(mk([]), mk(true), mk(true), clock.sleep);
  const gone = await awaitAfStep(mk([]), mk(false), mk(false), clock.sleep);
  const never = await awaitAfStep(mk([]), mk(true), mk(false), virtualClock().sleep, 20);
  check('awaitAfStep distinguishes all four outcomes it exists to distinguish',
    late.outcome === 'options' && late.options[0] === 'af-option-x'
    && ended.outcome === 'ended' && gone.outcome === 'ended' && never.outcome === 'timeout',
    `late=${late.outcome} searchFired=${ended.outcome} cardGone=${gone.outcome} never=${never.outcome}`);
}

// ── 3. NOBODY KEEPS A PRIVATE COPY OF THE BEAT ──────────────────────────────────────────────────
// A literal wait this large is someone standing in for the searching beat with a typed number. Each
// one must be REGISTERED with a reason, and (unless its reason says it is not a post-search read)
// must be provably ≥ the live beat. Discovery means a NEW one is red until a human thinks about it.
const BEAT_SIZED_MS = 8_000;

type Registered = { file: string; ms: number; postSearchRead: boolean; why: string };
const BEAT_WAITS: Registered[] = [
  { file: 'verify-af-live-truth.ts', ms: 14000, postSearchRead: true,
    why: 'settle after «بحث» before reading the results turn — must outlast the beat' },
  { file: 'verify-af-pill-removal-live.ts', ms: 14000, postSearchRead: true,
    why: 'settle after the baseline «بحث» before the first pill read — must outlast the beat' },
  { file: 'verify-af-stale-predicate-live.ts', ms: 14000, postSearchRead: true,
    why: 'two baseline searches, each read from the DOM afterwards — must outlast the beat' },
  { file: 'verify-trending-live-four-way-truth.ts', ms: 14000, postSearchRead: true,
    why: 'three searches whose Trending rows are read from the DOM — must outlast the beat' },
  { file: 'verify-web-runtime-smoke.mjs', ms: 12000, postSearchRead: true,
    why: 'SEARCH_BEAT_FLOOR_MS, hand-typed as 12000 in a .mjs that cannot import this .ts contract. '
       + 'Currently ≥ the live beat, so it is correct today — registered precisely so that the next '
       + 'rise in the beat turns this barrier red instead of turning that journey into a false '
       + 'accusation. It is the one remaining private copy of the beat in the tree.' },
  { file: 'verify-af-scope-change-live.ts', ms: 8000, postSearchRead: false,
    why: 'a UI settle after searchAndCapture(); the assertion that follows reads the CAPTURED '
       + 'REQUEST, not the screen, so it is not gated on the beat. Kept registered because the '
       + 'next UI interaction after it can still land on the loader if the beat ever grows past it.' },
];

// THE SUBJECT IS JOURNEYS THAT DRIVE A BROWSER, NOT BARRIERS THAT READ SOURCE. A source-scanning
// barrier legitimately contains `waitForTimeout(14000)` inside a mutation fixture or a quoted
// example — verify-live-journeys-wait-for-results.ts (the sibling barrier that pins the STRUCTURE
// of a readiness wait, where this pins its RELATIONSHIP TO THE PRODUCT'S BEAT) does exactly that,
// and so does this file. Requiring a real Playwright import is what separates "types a wait" from
// "writes about one", without needing an exemption list that would rot.
const journeyFiles = readdirSync(SCRIPTS)
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f))
  .filter((f) => {
    const src = readFileSync(join(SCRIPTS, f), 'utf8');
    return src.includes('waitForTimeout(') && /from ['"]playwright['"]/.test(src);
  });

/** Every literal `waitForTimeout(N)` with N >= BEAT_SIZED_MS, per file. Comments stripped first so
 *  a number quoted in prose (this file is full of them) is never mistaken for code. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const beatWaitsIn = (src: string): number[] =>
  [...stripComments(src).matchAll(/waitForTimeout\(\s*(\d{4,})\s*\)/g)]
    .map((m) => Number(m[1])).filter((n) => n >= BEAT_SIZED_MS);

const found = new Map<string, number[]>();
for (const f of journeyFiles) {
  const ns = beatWaitsIn(readFileSync(join(SCRIPTS, f), 'utf8'));
  if (ns.length) found.set(f, ns);
}

const registeredFiles = new Set(BEAT_WAITS.map((r) => r.file));
const unregistered = [...found.keys()].filter((f) => !registeredFiles.has(f));
check('every beat-sized literal wait in a live journey is REGISTERED above',
  unregistered.length === 0,
  unregistered.map((f) => `${f} types ${found.get(f)!.join('/')}ms and is not in BEAT_WAITS`).join('; '));

const tooShort = BEAT_WAITS.filter((r) => r.postSearchRead && r.ms < SEARCH_BEAT_MS);
check(`every registered post-search wait still outlasts the live beat (${SEARCH_BEAT_MS}ms)`,
  tooShort.length === 0,
  tooShort.map((r) => `${r.file} waits ${r.ms}ms < ${SEARCH_BEAT_MS}ms — it will read the held screen`).join('; '));

const stale = BEAT_WAITS.filter((r) => !found.has(r.file) || !found.get(r.file)!.includes(r.ms));
check('no registry entry describes a wait that is no longer there (the registry cannot rot)',
  stale.length === 0,
  stale.map((r) => `${r.file} no longer types ${r.ms}ms — remove or update its entry`).join('; '));

// ── 4. THE JOURNEYS THAT WERE FIXED STAY FIXED ──────────────────────────────────────────────────
// Each of these judged a screen it had not observed on 2026-09-06. Pin the shared pacing import so
// a future edit cannot quietly return them to a fixed sleep.
const MUST_PACE = [
  'verify-af-card-evidence-live.ts',
  'verify-af-pill-removal-live.ts',
  'verify-af-agent-cta-live.ts',
  'verify-combined-budget-live.ts',
];
const unpaced = MUST_PACE.filter((f) => !readFileSync(join(SCRIPTS, f), 'utf8').includes('afJourneyPacing'));
check('every journey corrected on 2026-09-06 still imports the shared pacing contract',
  unpaced.length === 0, unpaced.join(', '));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the same predicates, against the defects they exist to catch\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-1: the derivation goes blind — agent.tsx no longer carries the constant. MUST throw, never
// fall back to a default. A harness that guesses the beat is how the false accusations got written.
mustCatch('a product source the beat cannot be read from (must fail closed, not default)', (() => {
  try { readSearchBeatMs('const SOMETHING_ELSE = 3;\n'); return false; } catch { return true; }
})());

// M-2: the exact 2026-09-06 defect — a fixed sleep shorter than the beat, read as a post-search
// state. Expressed as the registry predicate: a registered post-search wait below the live beat.
mustCatch('a post-search wait shorter than the beat (the 2026-09-06 defect itself)',
  [{ file: 'x.ts', ms: 4000, postSearchRead: true, why: '' }]
    .filter((r) => r.postSearchRead && r.ms < SEARCH_BEAT_MS).length > 0);

// M-3: a NEW journey that types its own beat-sized wait and never registers it.
mustCatch('an unregistered beat-sized wait in a new journey',
  beatWaitsIn('await page.waitForTimeout(12000);\n').length > 0);

// M-4: the scan must not be fooled by a number that only appears in PROSE — otherwise this file's
// own commentary would fail it, and the fix would be to stop explaining the defect.
mustCatch('a beat-sized number in a comment is NOT read as code',
  beatWaitsIn('// it used to be waitForTimeout(14000) here\nawait page.waitForTimeout(500);\n').length === 0);

// M-5: a journey returned to a fixed sleep by dropping the shared import.
mustCatch('a corrected journey that drops the shared pacing contract',
  ['a.ts'].filter(() => !'await page.waitForTimeout(4000);'.includes('afJourneyPacing')).length > 0);

// M-6: and a genuinely clean journey must NOT be reported as broken.
mustCatch('a clean journey is not flagged',
  beatWaitsIn('await page.waitForTimeout(700);\n').length === 0
  && ['a.ts'].filter(() => !'import { awaitResultsTurn } from "./lib/afJourneyPacing.ts";'.includes('afJourneyPacing')).length === 0);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? `\n✅ the beat is derived from the product (${SEARCH_BEAT_MS}ms), the helpers observe arrival, and no journey keeps a private copy.\n`
    : `\n❌ ${failed} check(s) failed — a live journey can judge a screen it never observed.\n`);
process.exit(failed === 0 ? 0 : 1);
