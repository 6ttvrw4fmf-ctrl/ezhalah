// ── EVERY PLATFORM GETS ITS MOMENT (owner, 2026-09-06) ───────────────────────────────────────────
//
//   "when user uses the filter the animation pops up, let the user wait 10 seconds ok, and make sure
//    all the platforms in the animation show clearly ok, cuz doing it quick will make them lost"
//
// The platform roster is the product's primary trust signal — the moment a user learns Ezhalah
// searches the WHOLE Saudi market rather than one site. Two things have to be true for that to land,
// and BOTH are arithmetic between two files that nothing previously tied together:
//
//   1. Every pill has appeared          — lastPillAppearedMs(roster)
//   2. Every pill has been HIGHLIGHTED  — lastPillLitMs(roster)
//   … before the loader is allowed to leave:  SEARCH_MIN_MS ≥ max(1, 2).
//
// CORRECTED 2026-09-19. This used to read `SEARCH_MIN_MS ≥ reveal + sweep`, with sweep taken as the
// nominal LOADER_SWEEP_MS. Both halves were wrong: the two phases both start at mount and OVERLAP
// (so the deadline is the later of them, not their sum), and the wave's real length is
// (roster−1) × highlightStepMs(roster), which the 180ms readable-step floor pushes past the nominal
// 7,400ms for every roster above 41 — as the catalogue has been since abwbna. The two errors pointed
// opposite ways and roughly cancelled, so this barrier stayed green while describing an animation
// nobody shipped. Section D now feeds it that old model and requires it to be rejected.
//
// Before this barrier the floor was 2,200ms and the sweep 3,600ms: the wave could not finish even
// once, so on a fast query the pills at the END of the roster were never lit at all — the platforms
// "got lost", exactly as the owner described. The relationship was maintained only by a comment.
//
// This is a pure-arithmetic contract, so it is EXECUTED here against the SHIPPED constants (imported
// from the component; parsed from agent.tsx, which cannot be imported — it pulls the whole app).
//
//   node --experimental-strip-types scripts/verify-search-loader-shows-every-platform.ts   (npm test)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOADER_REVEAL_MS, LOADER_SWEEP_MS, MAX_ROSTER, WAVE_LIT_MS, PILL_GROUP,
  everyPlatformSeen, highlightStepMs, lastPillAppearedMs, lastPillLitMs, waveDelayMs,
} from '../src/lib/searchLoaderTiming.ts';


const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// The roster COUNT, parsed rather than imported: loaderPlatforms.ts calls Metro's `require()` for
// its bundled logos, which does not resolve in a plain-Node ESM run. Same reason and same idiom as
// scripts/verify-loader-platforms-match-active.ts, which parses the identical constant.
const loaderPlatformsSrc = readFileSync(
  join(root, 'src/data/loaderPlatforms.ts'), 'utf8');
function parsePlatformCount(src: string): number {
  const start = src.indexOf('export const PLATFORM_META');
  const openArr = src.indexOf('[', start);
  const closeArr = src.indexOf('];', openArr);
  return [...src.slice(openArr, closeArr).matchAll(/\bname:\s*'([^']+)'/g)].length;
}
const ROSTER = parsePlatformCount(loaderPlatformsSrc);
// ── the shipped floor, read from its single source ───────────────────────────────────────────────
const agentSrc = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');
const floorMatch = agentSrc.match(/^const SEARCH_MIN_MS = (\d+);/m);
const SEARCH_MIN_MS = Number(floorMatch?.[1]);
check('SEARCH_MIN_MS is readable from agent.tsx (a floor nobody can find is a floor nobody maintains)',
  Number.isFinite(SEARCH_MIN_MS) && SEARCH_MIN_MS > 0, String(floorMatch?.[1]));

console.log('\n── A. the owner\'s ten seconds ──');
check(`the searching beat lasts at least 10s (owner 2026-09-06) — SEARCH_MIN_MS = ${SEARCH_MIN_MS}`,
  SEARCH_MIN_MS >= 10000,
  'the roster is the trust signal; at 2.2s it was gone before it could be read');

console.log('\n── B. the arithmetic that makes "all the platforms show clearly" true ──');
// everyPlatformSeen() is the SHIPPED predicate, imported — not a replica. Section D feeds it the
// pre-fix numbers and the pre-fix MODEL to prove it rejects both.
const appeared = lastPillAppearedMs(ROSTER);
const litBy = lastPillLitMs(ROSTER);
check(`every one of the ${ROSTER} pills has appeared by ${appeared}ms and been lit by ${litBy}ms, inside the ${SEARCH_MIN_MS}ms floor`,
  everyPlatformSeen(SEARCH_MIN_MS, ROSTER),
  `the last pill needs ${Math.max(appeared, litBy)}ms but the loader may leave at ${SEARCH_MIN_MS}ms`);

// The wave's tail is the binding deadline, and it grows with the roster. MAX_ROSTER is the largest
// catalogue this floor can serve; onboarding past it is a real product decision (a longer wait, or a
// wave that lights more than one pill per step), never a nudged constant.
check(`the catalogue (${ROSTER}) is inside the ceiling this floor can serve (${MAX_ROSTER})`,
  ROSTER <= MAX_ROSTER,
  `at step ${highlightStepMs(ROSTER)}ms/pill a ${ROSTER}-roster needs ${litBy}ms; the floor is ${SEARCH_MIN_MS}ms`);
// …and MAX_ROSTER must itself be honest about that floor, or the check above is theatre.
check(`MAX_ROSTER (${MAX_ROSTER}) is the TRUE ceiling of the ${SEARCH_MIN_MS}ms floor, not a round number`,
  lastPillLitMs(MAX_ROSTER) <= SEARCH_MIN_MS && lastPillLitMs(MAX_ROSTER + 1) > SEARCH_MIN_MS,
  `roster ${MAX_ROSTER} lit by ${lastPillLitMs(MAX_ROSTER)}ms, roster ${MAX_ROSTER + 1} by ${lastPillLitMs(MAX_ROSTER + 1)}ms`);

// Per-pill dwell: the sweep must be slow enough to read, not a strobe across a big roster.
const perPill = highlightStepMs(ROSTER);
check(`each platform is highlighted for a readable step (${perPill}ms/pill across ${ROSTER})`,
  perPill >= 150,
  'below ~150ms the wave reads as a flicker and individual platforms stop registering');

console.log('\n── C. the component animates with the constants this barrier just executed ──');
const loaderSrc = readFileSync(join(root, 'src/components/SearchLoader.tsx'), 'utf8');
check('SearchLoader takes its stagger and its highlight step from lib/searchLoaderTiming',
  /from '@\/lib\/searchLoaderTiming'/.test(loaderSrc)
  && /const step = highlightStepMs\(total\);/.test(loaderSrc)
  && /WAVE_RISE, WAVE_HOLD, WAVE_FALL/.test(loaderSrc)
  && /withDelay\(waveDelayMs\(index, step\)/.test(loaderSrc)
  && /Math\.ceil\(total \/ PILL_GROUP\) \* step/.test(loaderSrc)
  && /delay=\{index \* \(reduced \? 25 : PILL_STAGGER\)\}/.test(loaderSrc),
  'a local copy of either number divorces the wave from the floor this barrier checks');
check('no second, private copy of the timing constants survives in the component',
  !/const (PILL_STAGGER|PILL_FADE|LOADER_SWEEP_MS|LOADER_REVEAL_MS|WAVE_RISE|WAVE_HOLD|WAVE_FALL)\s*=/.test(loaderSrc),
  'two sources for one number is how the sweep and the floor drifted apart in the first place');

// The grouped wave is the owner's answer to the 56-platform ceiling, so it is asserted, not assumed.
// Asserted AGAINST PILL_GROUP, not against the number 2. The shape is what matters: the first
// PILL_GROUP pills share step 0, and the pill right after them starts step 1. Hardcoding
// waveDelayMs(2) === 180 silently encoded "the wave is exactly 2 wide", so widening the wave to 3 —
// the very change this file exists to keep honest — failed here instead of being checked.
check(`the wave lights ${PILL_GROUP} pills per step, which is what lifts the ceiling to ${MAX_ROSTER}`,
  PILL_GROUP >= 2
  && waveDelayMs(PILL_GROUP - 1, 180) === 0          // the last pill of the first group shares step 0
  && waveDelayMs(PILL_GROUP, 180) === 180            // the next pill starts step 1
  && waveDelayMs(0, 180) === 0,
  `group=${PILL_GROUP} waveDelayMs(${PILL_GROUP - 1})=${waveDelayMs(PILL_GROUP - 1, 180)} `
  + `waveDelayMs(${PILL_GROUP})=${waveDelayMs(PILL_GROUP, 180)}`);

console.log('\n── D. mutation proofs ──');
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The exact pre-2026-09-06 numbers: a 2.2s floor against a 3.6s sweep. This is the defect the owner
// reported, and it must fail this barrier — otherwise the barrier is describing, not protecting.
mustCatch('the old 2,200ms floor, where the wave never reached the last platform',
  !everyPlatformSeen(2200, ROSTER));

// A floor raised to 10s but a wave fast enough to finish early would still "lose" nobody, so the
// real risk is the other direction: a tail that is lit one millisecond after the loader may leave.
mustCatch('a floor one millisecond short of the real last-pill deadline',
  !everyPlatformSeen(lastPillLitMs(ROSTER) - 1, ROSTER));

// THE MODEL ITSELF. This is the defect found on 2026-09-19: an arithmetic that adds the two phases
// and takes the sweep as the nominal constant. It is reproduced here exactly, and it must disagree
// with the shipped predicate at the shipped roster — otherwise the predicate has silently reverted to
// it. (At ROSTER 52 the old model demands 10,600ms for an animation that really finishes at 9,740ms,
// and above ~56 it UNDER-states the need, which is the direction that loses platforms.)
const oldModel = (floorMs: number, roster: number) =>
  (roster - 1) * 60 + 260 <= LOADER_REVEAL_MS && floorMs >= LOADER_REVEAL_MS + LOADER_SWEEP_MS;
mustCatch('the pre-2026-09-19 model (phases added, nominal sweep) — it must no longer be what we ship',
  oldModel(SEARCH_MIN_MS, ROSTER) !== everyPlatformSeen(SEARCH_MIN_MS, ROSTER)
  || oldModel(lastPillLitMs(ROSTER) - 1, ROSTER) !== everyPlatformSeen(lastPillLitMs(ROSTER) - 1, ROSTER));

// A pill that is technically "reached" but never actually held lit is not seen. The envelope is part
// of the deadline, so a predicate that ignores it must fail.
// A regression to one-pill-per-step is the specific way this ceiling comes back. Proven where it
// MATTERS — at the shipped ceiling: an ungrouped wave must NOT be able to serve MAX_ROSTER, which
// is exactly what makes the grouping load-bearing rather than decorative.
const ungroupedLit = (roster: number) =>
  Math.max(0, roster - 1) * highlightStepMs(roster) + WAVE_LIT_MS;
mustCatch('a wave that reverts to ONE pill per step (the 56-platform ceiling returning)',
  ungroupedLit(MAX_ROSTER) > SEARCH_MIN_MS);

mustCatch('a deadline that forgets the wave still has to RISE and HOLD on the last pill',
  !everyPlatformSeen(waveDelayMs(ROSTER - 1, highlightStepMs(ROSTER)) + WAVE_LIT_MS - 1, ROSTER));

// A roster that outgrows the reveal budget.
mustCatch('a catalogue that outgrows the reveal budget',
  !everyPlatformSeen(SEARCH_MIN_MS, 200));

console.log(failures === 0
  ? '\n✓ ten seconds, and every platform both appears and is highlighted before the loader may leave\n'
  : `\n✗ ${failures} check(s) FAILED — a search could hide platforms the owner asked to be shown\n`);
process.exit(failures === 0 ? 0 : 1);
