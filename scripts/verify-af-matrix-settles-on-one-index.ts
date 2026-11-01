// Barrier: the live AF matrix judges a cell on ONE index state — hermetic half (AF engineer, 2026-10-13).
//
// verify-af-matrix-truth-live.ts reads one certified cell for minutes. On 2026-10-13 its 05:49 run failed
// 81 checks and its 07:57 run 28 DIFFERENT ones; every failing cell passed in full when re-run alone
// minutes later (Villa/Buy 217, Residential Building 230, Rest House/Buy 138 checks). Alert 1434 stood
// open on a measuring-tool flaw, which is exactly when a real defect would raise nothing new.
//
// judgeCellOnOneIndex (scripts/lib/afSurfaceJudge.ts) is the rule: a clean cell passes; a failing cell is
// re-taken inside settleOnOneIndex; failures that survive a stable re-read are the product's; a re-read
// that still straddles a rebuild is UNDECIDED, never a pass. This file EXECUTES that function against
// stubbed index stamps and attempts, and checks that the live matrix routes every cell through it.
//
//   node --experimental-strip-types scripts/verify-af-matrix-settles-on-one-index.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgeCellOnOneIndex, UNREADABLE_STAMP, type CellVerdict } from './lib/afSurfaceJudge.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

console.log('\nThe live AF matrix judges a cell on one index state\n');

const stamps = (...xs: string[]) => { let i = 0; return async () => xs[Math.min(i++, xs.length - 1)]; };
const attempts = (...xs: string[][]) => { let i = 0; return async () => xs[Math.min(i++, xs.length - 1)]; };
type Judge = (s: () => Promise<string>, a: () => Promise<string[]>) => Promise<CellVerdict>;

async function cases(judge: Judge): Promise<string[]> {
  const bad: string[] = [];
  const v1 = await judge(stamps('1@a'), attempts([]));
  if (v1.verdict !== 'pass') bad.push('a clean cell must pass');
  const v2 = await judge(stamps('9@x', '9@x'), attempts(['base moved'], []));
  if (!(v2.verdict === 'pass' && v2.reconciled)) bad.push('a disagreement gone on a stable re-read is reconciled, not a failure');
  const v3 = await judge(stamps('9@x', '9@x'), attempts(['real defect'], ['real defect']));
  if (!(v3.verdict === 'fail' && v3.failures[0] === 'real defect')) bad.push('a defect that survives a stable re-read must FAIL');
  const v4 = await judge(stamps('9@x', '10@y'), attempts(['moved'], []));
  if (v4.verdict !== 'undecided') bad.push('a re-read that straddles a rebuild is UNDECIDED, never a pass');
  const v5 = await judge(stamps(UNREADABLE_STAMP, UNREADABLE_STAMP), attempts(['x'], []));
  if (v5.verdict !== 'undecided') bad.push('an unreadable stamp never certifies one index');
  return bad;
}

const real = await cases(judgeCellOnOneIndex);
check(`judgeCellOnOneIndex obeys the rule${real.length ? ' -- ' + real.join('; ') : ''}`, real.length === 0);

// The live matrix routes every cell through it, and check() writes to the cell's own buffer.
const live = readFileSync(join(ROOT, 'scripts/verify-af-matrix-truth-live.ts'), 'utf8');
export function wiringProblems(src: string): string[] {
  const out: string[] = [];
  if (!/judgeCellOnOneIndex\(\s*indexStamp\s*,\s*attempt\s*\)/.test(src)) out.push('cells are not judged by judgeCellOnOneIndex(indexStamp, attempt)');
  if (!/cellRun\.run\(\s*run\s*,\s*\(\)\s*=>\s*verifyCell\(c\)\s*\)/.test(src)) out.push('verifyCell does not run inside its own check buffer');
  if (!/const run = cellRun\.getStore\(\);\s*\n\s*if \(run\)/.test(src)) out.push('check() does not route into the running cell buffer');
  if (!/undecidedCells\.length > floor/.test(src)) out.push('UNDECIDED cells are not gated');
  return out;
}
const w = wiringProblems(live);
check(`verify-af-matrix-truth-live.ts is wired${w.length ? ' -- ' + w.join('; ') : ''}`, w.length === 0);

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────
const firstReadOnly: Judge = async (_s, a) => { const f = await a(); return f.length ? { verdict: 'fail', failures: f } : { verdict: 'pass', reconciled: false }; };
mustCatch('a judge that trusts the first read (the 10-13 behaviour)', (await cases(firstReadOnly)).length > 0);
const retryUntilGreen: Judge = async (_s, a) => { await a(); const f = await a(); return f.length ? { verdict: 'fail', failures: f } : { verdict: 'pass', reconciled: true }; };
mustCatch('a retry that ignores whether the index moved', (await cases(retryUntilGreen)).length > 0);
const movedIsPass: Judge = async (s, a) => { const v = await judgeCellOnOneIndex(s, a); return v.verdict === 'undecided' ? { verdict: 'pass', reconciled: true } : v; };
mustCatch('UNDECIDED folded into a pass', (await cases(movedIsPass)).length > 0);
mustCatch('the matrix calling verifyCell directly again',
  wiringProblems(live.replace(/judgeCellOnOneIndex\(\s*indexStamp\s*,\s*attempt\s*\)/, 'attempt()')).length > 0);
mustCatch('check() writing straight to the global tally',
  wiringProblems(live.replace(/const run = cellRun\.getStore\(\);\s*\n\s*if \(run\)/, 'const run = null;\n  if (false)')).length > 0);

if (failed) { console.error(`\n✗ verify-af-matrix-settles-on-one-index: ${failed} failure(s)`); process.exit(1); }
console.log('\n✓ a matrix cell is judged on one index state; a real defect still fails, a moved index is never a pass');
