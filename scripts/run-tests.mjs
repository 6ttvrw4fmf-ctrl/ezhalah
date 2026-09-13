// THE TEST RUNNER — replaces the 201-command single-line `&&` chain in package.json.
//
// Behaviour is deliberately IDENTICAL to that chain: the same scripts, in a deterministic order,
// stopping at the first failure and exiting non-zero. What changed is only WHERE the list comes
// from — the filesystem, via scripts/lib/testRegistry.ts — so that adding a barrier no longer means
// editing one line that every other engineer routine is also editing. See that module's header for
// why (five conflict rounds on PR #1196 alone).
//
//   node scripts/run-tests.mjs            # what `npm test` runs: stop at the first failure
//   node scripts/run-tests.mjs --all      # run every check even after one fails, then summarise
//   node scripts/run-tests.mjs --list     # print the resolved run order and exit
//
// FAILS CLOSED, three ways:
//   • any child exiting non-zero fails the run;
//   • a child killed by a signal (no exit code) is a failure, not a skip;
//   • an empty or shrunken run set is itself a failure — verify-test-registry-complete.ts holds the
//     baseline floor, and this runner refuses to report success over zero tests.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  loadRegistry, argvFor, childOutcome, outcomeIsPass, PER_CHECK_TIMEOUT_MS,
} from './lib/testRegistry.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { run, excluded } = loadRegistry(root);
const args = new Set(process.argv.slice(2));

if (args.has('--list')) {
  for (const f of run) console.log(f);
  process.exit(0);
}

if (run.length === 0) {
  console.error('❌ run-tests: the run set is EMPTY. Refusing to report success over zero tests.');
  process.exit(1);
}

console.log(`run-tests: ${run.length} checks (${excluded.length} deliberately excluded — see scripts/test-exclusions.txt)\n`);

const started = Date.now();
const failed = [];
// How a failure is described. A timeout must SAY it timed out and name the file: the whole point of
// bounding each check (ops_incident #222) is that an unbounded hang used to consume the entire CI
// budget and die as a job-level timeout attributed to nothing.
const describe = (outcome, r) =>
  outcome === 'timeout' ? `TIMED OUT after ${PER_CHECK_TIMEOUT_MS}ms`
  : outcome === 'signal' ? `killed by signal ${r.signal ?? 'unknown'} (no exit code)`
  : `exit ${r.status}`;

for (const file of run) {
  // `timeout` bounds each check; the default killSignal (SIGTERM) is deliberate and must stay.
  // Several barriers mutate PRODUCT SOURCE in place and restore it from a signal handler — that
  // contract is itself pinned by verify-in-place-mutators-restore-on-signal.ts — so SIGKILL here
  // would leave a mutated source file on disk and poison every later check in the run.
  const r = spawnSync(process.execPath, argvFor(file), {
    cwd: root,
    stdio: 'inherit',
    timeout: PER_CHECK_TIMEOUT_MS,
  });
  // A signal-killed child reports status === null. Treating that as anything but a failure is how a
  // timeout or an OOM would read as a pass.
  const outcome = childOutcome(r);
  if (!outcomeIsPass(outcome)) {
    failed.push({ file, outcome, status: r.status, signal: r.signal });
    if (!args.has('--all')) {
      console.error(`\n❌ ${file} failed (${describe(outcome, r)})`);
      console.error(`   ${failed.length} failure(s); stopped here. Re-run with --all to see every failure.`);
      process.exit(1);
    }
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(0);
if (failed.length) {
  console.error(`\n❌ run-tests: ${failed.length} of ${run.length} checks failed in ${secs}s`);
  for (const f of failed) console.error(`   - ${f.file} (${describe(f.outcome, f)})`);
  process.exit(1);
}
console.log(`\n✅ run-tests: all ${run.length} checks passed in ${secs}s`);
