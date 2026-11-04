// Barrier: THE NIGHTLY AI READER FINISHES ITS NIGHT, AND A NIGHT THAT DOES NOT IS LOUD (owner 2026-11-03: «we never have
// to have this … make sure that we never get this issue»).
//
// Measured 2026-11-03: facts-extract.yml (mode new, pg_cron gh-facts-ai-new) planned 10,000 ads on ONE lane at ~0.3 ads/s;
// GitHub killed it at the 300-min job timeout — 11-03 «cancelled» after 1,679 ads, 11-02 «failure» — while ~3,900 new
// ads arrived a day. The only signal was a P2 that sat for three days, and the shared failure bridge treats «cancelled»
// as no verdict. This barrier reads the workflow and the reader and proves, with mutation proofs:
//   1. the time budget (MAX_MINUTES) ends the run at least 15 min before the job's timeout-minutes;
//   2. the nightly runs on ≥ 2 lanes by default (the dispatch with no inputs is what pg_cron sends);
//   3. the reader honours the budget (an argument that stops between batches);
//   4. a lane that fails OR is cancelled raises a P1 through scripts/ops/raise-workflow-alert.mjs, with Node 24 set up.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const WF = readFileSync(join(root, '.github/workflows/facts-extract.yml'), 'utf8');
const PY = readFileSync(join(root, 'scrapers/facts/extract.py'), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
// mustCatch(label, heldOnBroken): the invariant evaluated on deliberately broken input must be false.
const mustCatch = (label: string, heldOnBroken: boolean) => check(`(mutation) catches ${label}`, heldOnBroken === false);

const timeoutMin = (y: string) => Number((y.match(/^\s*timeout-minutes:\s*(\d+)/m) || [])[1] || NaN);
const budgetMin = (y: string) => Number((y.match(/MAX_MINUTES:\s*'?(\d+)'?/) || [])[1] || NaN);
const budgetFits = (y: string) => budgetMin(y) > 0 && budgetMin(y) <= timeoutMin(y) - 15;
const defaultLanes = (y: string) => {
  const input = Number((y.match(/lanes:\s*\n(?:\s+\w+:.*\n)*?\s+default:\s*"(\d+)"/) || [])[1] || NaN);
  const fallback = Number((y.match(/LANES:\s*\$\{\{\s*inputs\.lanes\s*\|\|\s*'(\d+)'\s*\}\}/) || [])[1] || NaN);
  return Math.min(input, fallback);
};
const readerHonoursBudget = (p: string) =>
  /add_argument\("--max-minutes"/.test(p) && /if args\.max_minutes and time\.time\(\) - t_start > args\.max_minutes \* 60:[\s\S]{0,400}break/.test(p);
const loudOnFailure = (y: string) =>
  /if: always\(\)[\s\S]{0,400}raise-workflow-alert\.mjs[\s\S]{0,200}--kind af_live_check_failed[\s\S]{0,200}--status \$\{\{ job\.status == 'cancelled' && 'failure' \|\| job\.status \}\}/.test(y)
  && /setup-node@v4[\s\S]{0,80}node-version: '24'[\s\S]{0,200}Bridge this lane/.test(y);

check(`the time budget (${budgetMin(WF)} min) ends the run ≥ 15 min before the job timeout (${timeoutMin(WF)} min)`, budgetFits(WF));
check(`the nightly runs on ≥ 2 lanes by default (now ${defaultLanes(WF)})`, defaultLanes(WF) >= 2);
check('the reader stops between batches when the budget is spent (--max-minutes)', readerHonoursBudget(PY));
check('a failed OR cancelled lane raises a P1 (af_live_check_failed → the 🔬 engineer) with Node 24 set up', loudOnFailure(WF));

mustCatch('a budget as long as the job timeout', budgetFits(WF.replace(/MAX_MINUTES:\s*'?\d+'?/, "MAX_MINUTES: '300'")));
mustCatch('the budget removed', budgetFits(WF.replace(/^.*MAX_MINUTES:.*$/m, '')));
mustCatch('the nightly back on one lane', defaultLanes(WF.replace(/LANES:\s*\$\{\{\s*inputs\.lanes\s*\|\|\s*'\d+'/, "LANES: ${{ inputs.lanes || '1'")) >= 2);
mustCatch('the reader ignoring the budget', readerHonoursBudget(PY.replace(/if args\.max_minutes and/, 'if False and')));
mustCatch('a cancel no longer counted as a failure', loudOnFailure(WF.replace("job.status == 'cancelled' && 'failure' || job.status", 'job.status')));

if (failed) { console.error(`\n❌ verify-ai-reader-finishes-its-night: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✓ the nightly AI reader finishes its night, and a night that does not is a P1');
