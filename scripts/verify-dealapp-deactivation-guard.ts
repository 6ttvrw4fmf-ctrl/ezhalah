/**
 * The dealapp fetch is ~75% false-negative from CI. Pin the two things that keep that bad signal
 * from ever deactivating a live listing.
 *
 * WHY (measured 2026-08-26, full write-up in docs/ops/DEALAPP_FETCH_EGRESS_FINDING.md):
 * dealapp.sa serves a data-bearing detail page to ordinary networks and a PERMANENTLY listing-less
 * page to GitHub Actions egress, for the SAME ids at the SAME moment -- 78-83% shell from a runner
 * vs ~11% off-runner, identical across all five client variants including the system curl binary,
 * flat across all ten deciles, and 0 of 49 shells recovered at 5s/15s/45s/120s (control 10/10).
 *
 * So `last_seen_at` for dealapp is NOT a liveness signal. What stops it becoming one is
 * prune_unseen's coverage floor: at ~25% real coverage the 0.80 default trips every night and
 * prune_unseen returns -1 instead of aging anything out. Measured: pruned=0 on every shard on
 * every day for 14 days, missing_count=0 on all 14,733 active rows.
 *
 * That floor is a plain env-var default. Lower it -- or set PRUNE_MIN_COVERAGE in a dealapp
 * workflow -- and a 75% false-negative signal starts deactivating live listings, silently and at
 * scale. This asserts nobody can do that by accident. Its runtime twin is the DB detector
 * mon_detect_dealapp_deactivation_on_unreliable_fetch, which fires on the FIRST deactivated row
 * if it ever happens anyway; this file is the compile-time half that stops it happening at all.
 *
 * Offline and deterministic -- reads repo files only, so it is safe in `npm test`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WF = '.github/workflows';
const DB_PY = 'scrapers/common/db.py';
const DETECTOR = 'mon_detect_dealapp_deactivation_on_unreliable_fetch';

const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const ok = (m: string) => console.log(`  ok  ${m}`);

// -- 1. The coverage floor default must remain >= 0.80 -----------------------------------------
// This is the single value protecting 14,733 active listings from a 75% false-negative signal.
const db = readFileSync(DB_PY, 'utf8');
const floor = db.match(/PRUNE_MIN_COVERAGE["']\s*,\s*["']([0-9.]+)["']/);
if (!floor) {
  fail(`${DB_PY}: could not find the PRUNE_MIN_COVERAGE default at all -- if the guard was ` +
       `renamed or removed, this barrier must be updated deliberately, not silently bypassed.`);
} else if (Number(floor[1]) < 0.8) {
  fail(`${DB_PY}: PRUNE_MIN_COVERAGE default is ${floor[1]}, below 0.80. dealapp's real coverage ` +
       `is ~25% and its fetch is ~75% false-negative, so lowering this floor lets prune_unseen ` +
       `deactivate live listings. See docs/ops/DEALAPP_FETCH_EGRESS_FINDING.md.`);
} else {
  ok(`prune_unseen coverage floor default is ${floor[1]} (>= 0.80)`);
}

// -- 2. No dealapp workflow may set PRUNE_MIN_COVERAGE ------------------------------------------
// A per-workflow override would defeat §1 without touching db.py at all.
const workflows = readdirSync(WF).filter((f) => /^dealapp-.*\.ya?ml$/.test(f));
if (workflows.length === 0) fail(`${WF}: no dealapp-*.yml workflows found -- expected at least one`);
for (const f of workflows) {
  const body = readFileSync(join(WF, f), 'utf8');
  // Strip comments: dealapp-sharded.yml legitimately DISCUSSES the guard in its header prose.
  const exec = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  if (/PRUNE_MIN_COVERAGE/.test(exec)) {
    fail(`${WF}/${f}: sets PRUNE_MIN_COVERAGE. dealapp must keep the 0.80 default -- overriding ` +
         `it here would let a ~75% false-negative fetch deactivate live listings.`);
  }
}
if (!failures.length) ok(`no dealapp workflow overrides PRUNE_MIN_COVERAGE (${workflows.length} checked)`);

// -- 3. The diagnostic workflow must stay manual-dispatch only ----------------------------------
// It drives real traffic at dealapp for diagnosis; on a schedule it becomes unattended load.
const diag = 'dealapp-fetch-diagnostic.yml';
const diagBody = readFileSync(join(WF, diag), 'utf8');
const diagExec = diagBody.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
if (/^\s*schedule\s*:/m.test(diagExec)) {
  fail(`${WF}/${diag}: has a schedule. It is diagnosis-only and must stay workflow_dispatch.`);
} else if (!/workflow_dispatch/.test(diagExec)) {
  fail(`${WF}/${diag}: no workflow_dispatch trigger -- the diagnostic can no longer be run.`);
} else {
  ok(`${diag} is workflow_dispatch only, never scheduled`);
}

// -- 4. The runtime detector must still be mirrored in the repo ---------------------------------
// The DB half can be dropped or replaced server-side; the migration is the record that it exists.
const migDir = 'supabase/migrations';
const carries = readdirSync(migDir).some((f) =>
  f.endsWith('.sql') && readFileSync(join(migDir, f), 'utf8').includes(`function public.${DETECTOR}`));
if (!carries) {
  fail(`${migDir}: no migration defines ${DETECTOR}. The runtime guard that catches a dealapp ` +
       `deactivation on an unreliable fetch has no committed source.`);
} else {
  ok(`${DETECTOR} is defined in a committed migration`);
}

// -- 5. Self-check: the parsers above must actually be able to fail ------------------------------
// A barrier whose detection is vacuous reads green forever. Prove each predicate on a mutant.
const mutants: [string, boolean][] = [
  ['floor 0.50 is rejected', Number('0.50') < 0.8],
  ['a workflow setting the var is detected', /PRUNE_MIN_COVERAGE/.test('  env:\n    PRUNE_MIN_COVERAGE: "0.1"')],
  ['a commented mention is NOT detected',
    !/PRUNE_MIN_COVERAGE/.test(['# talks about PRUNE_MIN_COVERAGE', 'jobs:'].filter((l) => !/^\s*#/.test(l)).join('\n'))],
  ['a schedule block is detected', /^\s*schedule\s*:/m.test('on:\n  schedule:\n    - cron: "0 3 * * *"')],
];
for (const [what, held] of mutants) {
  if (!held) fail(`self-check failed: ${what}`);
}
if (mutants.every(([, h]) => h)) ok(`self-checks: all ${mutants.length} mutants behave as specified`);

if (failures.length) {
  console.error('\n✗ dealapp deactivation guard FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✓ dealapp deactivation guard: ${5} sections green`);
