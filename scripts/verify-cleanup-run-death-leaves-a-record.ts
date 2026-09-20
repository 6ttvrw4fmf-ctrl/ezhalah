// A cleanup run that DIES mid-delete must still record itself. EXECUTED, not grepped.
//
// Earned 2026-09-20 by scrape_runs 49535 (cleanup:wasalt). cleanup_deletion_log is written BEFORE
// the delete (DELETION_SAFETY.md §1), so when the delete loop took a Postgres statement timeout
// (57014) the run had already published 500 claims that listings were permanently destroyed. It
// deleted 1. The cleanup_runs insert sits AFTER the loop and the except handler called only
// end_run(), so the run left NO row in cleanup_runs — and end_run reported rows_seen=0,
// rows_upserted=0 over a row that really had been destroyed.
//
// Measured over every cleanup:* run in the preceding 30 days, 49535 was the ONLY one with no
// cleanup_runs row: every CONTROLLED abort (anomaly, fraction, health gate, inconclusive freeze)
// wrote one. The audit table was complete for every case except the one that went wrong.
//
// WHY THIS LIVES IN npm test AS WELL AS IN pytest. scrapers/common/tests/test_cleanup.py carries
// the same three assertions and runs in common-location-tests.yml — but that workflow is PATH
// FILTERED to `scrapers/**`. npm test is the REQUIRED check on every PR, so a change that breaks
// this guarantee from outside scrapers/ (a shared db.py helper, a requirements bump) is caught
// here and would be invisible there. This is hermetic: no network, no database, no secrets.
//
// AGENTS.md: a barrier that reads source as TEXT can pass for the entire time the defect is live.
// So this EXECUTES cleanup.run() against a client whose delete raises, and then executes it again
// against a MUTATED copy of cleanup.py to watch the assertions go red.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowBetween } from './lib/sourceWindow.ts';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLEANUP = join(ROOT, 'scrapers', 'common', 'cleanup.py');
const problems: string[] = [];

// The driver imports the REAL test module (so the fake client, the policy fixture and the
// candidate rows are the ones production is tested against, never a re-implementation here), then
// optionally swaps the module under test for a mutated copy of cleanup.py compiled in memory.
const DRIVER = `
import json, sys, types, importlib
sys.path.insert(0, sys.argv[1])
mutated = sys.stdin.read() or None
import scrapers.common.tests.test_cleanup as T
if mutated:
    real = importlib.import_module('scrapers.common.cleanup')
    mod = types.ModuleType('mutant')
    mod.__dict__.update({k: v for k, v in real.__dict__.items() if not k.startswith('__')})
    mod.__dict__['__file__'] = real.__file__
    mod.__dict__['__name__'] = 'mutant'
    exec(compile(mutated, 'mutant.py', 'exec'), mod.__dict__)
    T.C = mod                      # _install() patches sb/begin_run/end_run on whatever C is
out = {}
for name in json.loads(sys.argv[2]):
    try:
        getattr(T, name)()
        out[name] = 'GREEN'
    except AssertionError as e:
        out[name] = 'RED: ' + str(e)[:160]
    except Exception as e:
        out[name] = type(e).__name__ + ': ' + str(e)[:160]
print(json.dumps(out))
`;

const TESTS = [
  'test_run_killed_mid_delete_still_writes_its_cleanup_runs_row',
  'test_run_killed_mid_delete_reports_the_TRUE_partial_delete_count',
  'test_pre_delete_ledger_claims_are_still_written_when_the_delete_dies',
];

function run(mutatedSource?: string): Record<string, string> {
  const raw = execFileSync('python3', ['-c', DRIVER, ROOT, JSON.stringify(TESTS)], {
    input: mutatedSource ?? '', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // The scraper prints run summaries to stdout; the driver's JSON is the last line.
  const lines = raw.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

const src = readFileSync(CLEANUP, 'utf8');
const mutate = (from: string, to: string): string => {
  if (!src.includes(from)) {
    problems.push(`mutation target vanished from cleanup.py: ${from.slice(0, 70)}…`);
    return src;
  }
  return src.replace(from, to);
};

// ── 1. The guarantee itself, executed against the real module ───────────────────────────────────
const real = run();
for (const t of TESTS) {
  if (real[t] !== 'GREEN') problems.push(`EXECUTED cleanup.run(): ${t} → ${real[t]}`);
}

const mustCatch = (label: string, caught: boolean) => {
  if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`);
};

// ── 2. THE SHIPPED DEFECT: the except handler writes no cleanup_runs row and reports 0/0 ─────────
{
  // windowBetween(), never a raw slice(indexOf(…), indexOf(…)): if either marker moves, a raw
  // slice silently widens to the rest of the file and the "mutation" becomes a rewrite of
  // everything after it — a barrier that then passes while asserting nonsense.
  const START = '        stats["aborted"] = True\n        stats["abort_reason"] = f"run failed before completion: {e}"';
  const END = '        raise\n    finally:';
  try {
    const from = windowBetween(src, START, END, 'cleanup.py failure path');
    const m = run(src.replace(from,
      '        end_run(run_id, ok=False, rows_seen=0, rows_upserted=0, notes=f"error: {e}")\n'));
    mustCatch('the failed run stops recording itself in cleanup_runs (the shipped defect)',
      m[TESTS[0]].startsWith('RED'));
  } catch (e) {
    problems.push(`could not locate the failure-path audit write in cleanup.py: ${(e as Error).message}`);
  }
}

// ── 3. A DIFFERENT WRONG WAY (§4.2: re-mutate, or the barrier is narrower than it reads) ─────────
// The run row is written, but the delete count reverts to the lump sum computed after the loop —
// a line the failure path never reaches, so a real destruction is reported as deleted=0.
{
  const m = run(mutate(
    '                            stats["deleted"] += len(chunk)\n                else:\n                    stats["deleted"] = sum(len(v) for v in to_delete.values())',
    '                            pass\n                stats["deleted"] = sum(len(v) for v in to_delete.values())'));
  mustCatch('a partial delete being reported as deleted=0 while the run row still gets written',
    m[TESTS[1]].startsWith('RED'));
  if (m[TESTS[0]].startsWith('RED')) {
    problems.push('mutation 3 was meant to leave the run-row assertion GREEN and only break the ' +
      'count — it broke both, so the two assertions are not independent');
  }
}

// ── 4. The direction that must NOT change ────────────────────────────────────────────────────────
// The ledger is written BEFORE the delete on purpose. Suppressing it on failure would turn the
// chunk that DID commit into an UNLEDGERED HARD DELETE, which is strictly worse than a stale claim.
{
  const m = run(mutate(
    '                    if log_rows:\n                        for i in range(0, len(log_rows), 200):',
    '                    if False:\n                        for i in range(0, len(log_rows), 200):'));
  mustCatch('pre-delete ledger claims being suppressed when the delete dies',
    m[TESTS[2]].startsWith('RED'));
}

if (problems.length) {
  console.error('RED  verify-cleanup-run-death-leaves-a-record\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('PASS verify-cleanup-run-death-leaves-a-record — EXECUTED cleanup.run() against a ' +
  'delete that raises: the run records itself, reports the TRUE partial count, and still publishes ' +
  'its pre-delete claims; 3 mutations caught (run 49535, 2026-09-20).');
