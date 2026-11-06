// The weekly «checks that cry wolf» robot counts flips correctly (scripts/lib/flipFlops.mjs). Executed on synthetic runs.
// Run: node --experimental-strip-types scripts/verify-flip-flop-finder.ts
import { flipFlops } from './lib/flipFlops.mjs';
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
if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the cry-wolf finder counts only flips on unchanged code');
