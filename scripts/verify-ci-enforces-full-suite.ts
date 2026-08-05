// CI-enforcement guard (2026-08-04).
//
// THE BUG THIS EXISTS TO PREVENT: on 2026-08-04 an audit found that `npm test` — 43 regression
// guards covering the PRICE = SOURCE invariants, the Region -> City -> District boundary, taxonomy
// and canon sync, the RPC filter contract and the Arabic UX rules — was executed by NO workflow at
// all. 41 of 43 safety guards ran only on a developer's machine and gated nothing. CI was green on
// every PR regardless of whether those invariants held.
//
// That is disqualifying for automatic merging, which is exactly what the autonomy grant in
// docs/ops/AGENT_AUTHORITY.md permits: "self-merge on green CI". Green has to MEAN something.
//
// This guard fails if any workflow triggered by `pull_request` stops running `npm test` and
// `npm run verify`. Deleting the gate now turns CI red instead of going unnoticed for months.
import { readFileSync, readdirSync } from 'node:fs';

const WORKFLOW_DIR = '.github/workflows';

// A command counts only if a workflow that ACTUALLY RUNS ON PULL REQUESTS invokes it. A
// workflow_dispatch-only or schedule-only workflow gates nothing on a PR, which was the whole bug.
const REQUIRED = [
  { label: 'npm test (43 regression guards)', re: /^\s*run:\s*npm test\s*$/m },
  { label: 'npm run verify (taxonomy + location index)', re: /^\s*run:\s*npm run verify\s*$/m },
];

function triggersOnPullRequest(yaml: string): boolean {
  // Match a top-level `pull_request:` key (column 0 or two-space indent under `on:`), not a
  // mention inside a `permissions:` block or a comment.
  const withoutComments = yaml.replace(/^\s*#.*$/gm, '');
  return /^\s{0,4}pull_request:\s*$/m.test(withoutComments);
}

const files = readdirSync(WORKFLOW_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const prWorkflows = files
  .map((f) => ({ file: f, body: readFileSync(`${WORKFLOW_DIR}/${f}`, 'utf8') }))
  .filter(({ body }) => triggersOnPullRequest(body));

console.log('ci-enforces-full-suite: the safety guards must actually gate a pull request');
console.log(`  scanned ${files.length} workflow file(s); ${prWorkflows.length} run on pull_request`);

if (prWorkflows.length === 0) {
  console.error('\n❌ ci-enforces-full-suite: NO workflow runs on pull_request at all.');
  console.error('   Nothing gates a PR. Automatic merging would be merging blind.');
  process.exit(1);
}

const missing: string[] = [];
for (const { label, re } of REQUIRED) {
  const found = prWorkflows.find(({ body }) => re.test(body));
  if (found) {
    console.log(`  ✓ ${label} — enforced by ${found.file}`);
  } else {
    missing.push(label);
  }
}

if (missing.length > 0) {
  console.error('\n❌ ci-enforces-full-suite: a required command is not run by any pull_request workflow:');
  for (const m of missing) console.error(`     ${m}`);
  console.error('\n   This is the exact regression audited on 2026-08-04: guards that exist but never run.');
  console.error('   "Merge when CI is green" is only safe while green means the invariants held.');
  console.error('   Restore the step in .github/workflows/full-verification-ci.yml — do not delete this check.');
  process.exit(1);
}

console.log('\n✓ ci-enforces-full-suite: passed.');
