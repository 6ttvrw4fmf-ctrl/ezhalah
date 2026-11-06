// The weekly «checks that cry wolf» robot counts flips correctly (scripts/lib/flipFlops.mjs). Executed on synthetic runs.
// Run: node --experimental-strip-types scripts/verify-flip-flop-finder.ts
import { flipFlops, dispatchTakesInputs, comparableRuns } from './lib/flipFlops.mjs';
let failed = 0;
const check = (m: string, c: boolean) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ❌ ${m}`); failed++; } };
const mustCatch = (m: string, caught: boolean) => check(`(mutation) catches ${m}`, caught);
const R = (sha: string, c: string, h: number) => ({ head_sha: sha, conclusion: c, created_at: new Date(Date.UTC(2026, 10, 5, h)).toISOString() });
check('red then green on the same code within an hour is one flip', flipFlops([R('a', 'failure', 1), R('a', 'success', 2)]) === 1);
check('red then green on DIFFERENT code is not a flip (the code changed)', flipFlops([R('a', 'failure', 1), R('b', 'success', 2)]) === 0);
check('the same verdict twice is not a flip', flipFlops([R('a', 'failure', 1), R('a', 'failure', 2)]) === 0);
check('a flip outside the window does not count', flipFlops([R('a', 'failure', 1), R('a', 'success', 9)]) === 0);
check('cancelled / skipped runs are ignored', flipFlops([R('a', 'failure', 1), R('a', 'cancelled', 2), R('a', 'failure', 3)]) === 0);
check('order of input does not matter', flipFlops([R('a', 'success', 3), R('a', 'failure', 1), R('a', 'success', 2)]) === 1);
mustCatch('a counter that ignores the sha (would blame code changes on the check)',
  ((runs: any[]) => runs.filter((r, i) => i && r.conclusion !== runs[i - 1].conclusion).length)([R('a', 'failure', 1), R('b', 'success', 2)]) !== flipFlops([R('a', 'failure', 1), R('b', 'success', 2)]));
const WITH = 'on:\n  workflow_dispatch:\n    inputs:\n      platform:\n        type: string\njobs: {}\n';
const WITHOUT = 'on:\n  schedule:\n    - cron: \'1 * * * *\'\n  workflow_dispatch:\njobs:\n  x:\n    inputs:\n';
check('a dispatch with inputs is recognised (lifecycle-spot-check shape)', dispatchTakesInputs(WITH));
check('a bare dispatch is not, even with an «inputs:» elsewhere in the file', !dispatchTakesInputs(WITHOUT));
const D = (sha: string, c: string, h: number, event: string) => ({ ...R(sha, c, h), event });
const mixed = [D('a', 'failure', 1, 'workflow_dispatch'), D('a', 'success', 2, 'workflow_dispatch')];
check('dispatches of an input-taking workflow are not compared (they ran different checks)', flipFlops(comparableRuns(mixed, true)) === 0);
check('dispatches of a bare workflow are compared', flipFlops(comparableRuns(mixed, false)) === 1);
mustCatch('a finder that compares every dispatch (the 2026-11-06 false wolf: spot-check per platform)',
  flipFlops(mixed) !== flipFlops(comparableRuns(mixed, true)));
if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the cry-wolf finder counts only flips on unchanged code');
