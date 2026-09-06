// ── EVERY PLATFORM GETS ITS MOMENT (owner, 2026-09-06) ───────────────────────────────────────────
//
//   "when user uses the filter the animation pops up, let the user wait 10 seconds ok, and make sure
//    all the platforms in the animation show clearly ok, cuz doing it quick will make them lost"
//
// The platform roster is the product's primary trust signal — the moment a user learns Ezhalah
// searches the WHOLE Saudi market rather than one site. Two things have to be true for that to land,
// and BOTH are arithmetic between two files that nothing previously tied together:
//
//   1. Every pill has appeared          — reveal    = (roster−1) × PILL_STAGGER + PILL_FADE
//   2. Every pill has been HIGHLIGHTED  — sweep     = LOADER_SWEEP_MS (one full travelling pass)
//   … before the loader is allowed to leave:  SEARCH_MIN_MS ≥ reveal + sweep.
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
  LOADER_REVEAL_MS, LOADER_SWEEP_MS, everyPlatformSeen, highlightStepMs,
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
// pre-fix numbers to prove it rejects them.
check(`every pill has appeared by ${LOADER_REVEAL_MS}ms and been highlighted by ${LOADER_REVEAL_MS + LOADER_SWEEP_MS}ms, inside the ${SEARCH_MIN_MS}ms floor`,
  everyPlatformSeen(SEARCH_MIN_MS, ROSTER),
  `reveal ${LOADER_REVEAL_MS} + sweep ${LOADER_SWEEP_MS} = ${LOADER_REVEAL_MS + LOADER_SWEEP_MS} > floor ${SEARCH_MIN_MS}`);

// The reveal budget is computed from a MAX_ROSTER assumption inside the component; if the real
// catalogue outgrows it the reveal silently overruns and the tail pills land late.
check(`the reveal budget covers the real catalogue (${ROSTER} platforms)`,
  LOADER_REVEAL_MS >= (ROSTER - 1) * 60 + 260,
  `${ROSTER} platforms need ${(ROSTER - 1) * 60 + 260}ms, budget is ${LOADER_REVEAL_MS}ms`);

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
  && /delay=\{index \* \(reduced \? 25 : PILL_STAGGER\)\}/.test(loaderSrc),
  'a local copy of either number divorces the wave from the floor this barrier checks');
check('no second, private copy of the timing constants survives in the component',
  !/const (PILL_STAGGER|PILL_FADE|LOADER_SWEEP_MS|LOADER_REVEAL_MS)\s*=/.test(loaderSrc),
  'two sources for one number is how the sweep and the floor drifted apart in the first place');

console.log('\n── D. mutation proofs ──');
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The exact pre-2026-09-06 numbers: a 2.2s floor against a 3.6s sweep. This is the defect the owner
// reported, and it must fail this barrier — otherwise the barrier is describing, not protecting.
mustCatch('the old 2,200ms floor, where the wave never reached the last platform',
  !everyPlatformSeen(2200, ROSTER));

// A floor raised to 10s but a sweep left fast enough to finish early would still "lose" nobody, so
// the real risk is the other direction: a sweep slowed past the floor.
mustCatch('a floor one millisecond short of reveal + sweep',
  !everyPlatformSeen(LOADER_REVEAL_MS + LOADER_SWEEP_MS - 1, ROSTER));

// A roster that outgrows the reveal budget.
mustCatch('a catalogue that outgrows the reveal budget',
  !everyPlatformSeen(SEARCH_MIN_MS, 200));

console.log(failures === 0
  ? '\n✓ ten seconds, and every platform both appears and is highlighted before the loader may leave\n'
  : `\n✗ ${failures} check(s) FAILED — a search could hide platforms the owner asked to be shown\n`);
process.exit(failures === 0 ? 0 : 1);
