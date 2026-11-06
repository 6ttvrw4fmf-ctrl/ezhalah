// The auto-deploy breaker must stop a failing pipeline AND re-arm by itself (🔧 2026-11-06).
//
// Measured 11-06: three deploys at 07:09-07:35 UTC were refused by the drift gate (nothing shipped). The breaker in
// .github/workflows/auto-deploy-merged-fixes.yml was «the last 3 deploys failed → never dispatch a 4th», and only a
// 4th deploy could clear it, so every merged app fix sat unshipped for 13+ hours after the cause was gone.
//
// This check EXECUTES the workflow's own jq predicate (lifted from the YAML, not a copy) against:
//   - 3 failures, the newest 1 h ago         → must TRIP (a broken pipeline is not hammered)
//   - 3 failures, the newest 5 h ago         → must NOT trip (re-armed)
//   - a success among the last 3             → must NOT trip
// Mutation proof: the old permanent predicate is run against the same cases and must FAIL the «re-armed» case.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const yml = readFileSync('.github/workflows/auto-deploy-merged-fixes.yml', 'utf8');
const m = yml.match(/jq --arg c "\$cooloff" '([^']+)'/);
if (!m) {
  console.error('verify-auto-deploy-breaker-rearms: the breaker predicate (jq --arg c "$cooloff" …) is gone from the workflow');
  process.exit(1);
}
const predicate = m[1];
if (!/date -u -d '3 hours ago'/.test(yml)) {
  console.error('verify-auto-deploy-breaker-rearms: the cool-off ($cooloff = 3 hours ago) is gone from the workflow');
  process.exit(1);
}
if (!/--json [^\n]*createdAt/.test(yml)) {
  console.error('verify-auto-deploy-breaker-rearms: gh run list no longer asks for createdAt, so the cool-off cannot be judged');
  process.exit(1);
}

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
const cooloff = iso(3);
const run = (pred: string, runs: unknown[]) =>
  execFileSync('jq', ['--arg', 'c', cooloff, pred], { input: JSON.stringify(runs) }).toString().trim() === 'true';

const f = (h: number) => ({ conclusion: 'failure', createdAt: iso(h) });
const cases: Array<[string, unknown[], boolean]> = [
  ['3 failures, newest 1 h ago', [f(1), f(1.2), f(1.4)], true],
  ['3 failures, newest 5 h ago (re-armed)', [f(5), f(5.2), f(14)], false],
  ['a success among the last 3', [f(0.5), { conclusion: 'success', createdAt: iso(0.7) }, f(1)], false],
];

let bad = 0;
for (const [name, runs, want] of cases) {
  const got = run(predicate, runs);
  if (got !== want) { console.error(`✗ ${name}: trips=${got}, want ${want}`); bad++; }
  else console.log(`✓ ${name}: trips=${got}`);
}

// Mutation: the pre-11-06 permanent breaker must be caught by the «re-armed» case.
const old = `[limit(3; .[])] | all(.conclusion == "failure")`;
if (run(old, cases[1][1]) !== true) { console.error('✗ mutation proof: the old predicate no longer reproduces the deadlock'); bad++; }
else console.log('✓ mutation proof: the old permanent breaker trips on the re-armed case (the 11-06 deadlock)');

if (bad) process.exit(1);
console.log('verify-auto-deploy-breaker-rearms: OK');
