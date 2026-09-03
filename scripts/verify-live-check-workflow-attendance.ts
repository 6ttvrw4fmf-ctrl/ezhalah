// A LIVE CHECK THAT DID NOT RUN MUST NEVER READ AS A LIVE CHECK THAT PASSED (2026-09-03).
//
// THE INCIDENT THIS EXISTS FOR. `.github/workflows/af-live-truth-check.yml` grew from 9 browser
// journeys to 20 steps inside ONE job with a `timeout-minutes: 30` budget nobody re-measured. On
// 2026-09-03 the scheduled run hit that cap in the middle of step 15
// (verify-af-full-surface-differential.ts, region sweep) and GitHub CANCELLED the job. Steps 16-20
// — the جدة option sweep, verify-af-option-card-truth-live.ts, verify-af-remove-last-pill-live.ts,
// verify-af-scope-change-live.ts and the mobile pill-removal journey, four of them added the day
// before — were reported as `skipped`. Six live AF barriers did not execute.
//
// Nothing went red. A cancelled run is neither `success` nor `failure`; the `if: ${{ !cancelled() }}`
// guard on each step is designed so a FAILING step cannot hide the ones after it, and it does that
// job well — but under a job-level cancellation `cancelled()` is true, so the guard skips exactly
// the steps it was written to protect. This is the repo's oldest and most expensive bug class,
// stated in AGENTS.md: "a monitor that cannot fire reads as clean" (nine dark detectors read as a
// clean bill of health on 2026-08-10).
//
// THE THREE THINGS THIS PINS, none of which any existing barrier covered:
//
//   1. AN EXCLUSION'S PROMISED HOME MUST ACTUALLY RUN IT. scripts/test-exclusions.txt is
//      `name | where it DOES run | why`, and verify-test-registry-complete.ts checks that the named
//      workflow FILE EXISTS. It does not check that the file runs the script. So a row could name
//      any workflow in the repo and the check that is excluded from `npm test` would run nowhere at
//      all. Found live: verify-web-runtime-smoke.mjs named full-verification-ci.yml, which never
//      invokes it — it actually runs in web-runtime-smoke.yml (row corrected in the same change).
//
//   2. EVERY JOB IN SUCH A WORKFLOW DECLARES A BUDGET. An undeclared timeout-minutes is GitHub's
//      360-minute default, which is not a budget anybody chose.
//
//   3. A MULTI-JOB, NON-PR-GATED LIVE WORKFLOW CARRIES AN ATTENDANCE GATE — a job with
//      `if: always()` that `needs` EVERY other job in the file and fails unless all of them
//      concluded `success`. That is what converts a cancelled/skipped job into a red run. The
//      scope is deliberate: a workflow that also runs on `pull_request` already surfaces a
//      cancelled job as a non-passing required check, so it needs no gate; one that only runs on a
//      schedule has no such reader, and that is precisely where a dark barrier hides.
//
// Deliberately OFFLINE — reads only tracked repo files, no network — like its siblings in
// `npm test`. Its own predicates are pure functions, exercised at the bottom of this file against
// deliberately corrupted inputs so a vacuous assertion cannot pass.
//
// Run: node --experimental-strip-types scripts/verify-live-check-workflow-attendance.ts
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { npmTestRuns, parseExclusions, workflowInvokes, type Exclusion } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const EXCLUSIONS = 'scripts/test-exclusions.txt';
const WF_DIR = '.github/workflows';

// ---------------------------------------------------------------------------------------------
// Pure predicates. Kept free of I/O so the self-proof at the bottom can feed them corrupted input.
// ---------------------------------------------------------------------------------------------

/** A home that points at a workflow file (as opposed to an npm script or the literal `manual`). */
export function homeIsWorkflow(home: string): boolean {
  return home.endsWith('.yml') || home.endsWith('.yaml');
}

export type WorkflowJob = {
  id: string;
  timeout: number | null;
  needs: string[];
  ifExpr: string;
  body: string;
};

/**
 * Hand-parsed rather than delegated to a YAML loader, because no loader is a dependency of this
 * repo's script suite (see verify-workflow-yaml-valid.ts, which hand-walks for the same reason).
 * Only the shape this barrier reasons about is parsed: job ids at one indent level under `jobs:`,
 * and each job's timeout-minutes / needs / if.
 */
export function parseJobs(src: string): WorkflowJob[] {
  const lines = src.split('\n');
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt === -1) return [];
  const jobs: WorkflowJob[] = [];
  let cur: { id: string; start: number } | null = null;
  const flush = (end: number) => {
    if (!cur) return;
    const body = lines.slice(cur.start, end).join('\n');
    const t = /^\s{4}timeout-minutes:\s*(\d+)\s*$/m.exec(body);
    const nInline = /^\s{4}needs:\s*\[([^\]]*)\]\s*$/m.exec(body);
    const nSingle = /^\s{4}needs:\s*([A-Za-z0-9_-]+)\s*$/m.exec(body);
    const nBlock = /^\s{4}needs:\s*\n((?:\s{6}-\s*[A-Za-z0-9_-]+\s*\n?)+)/m.exec(body);
    let needs: string[] = [];
    if (nInline) needs = nInline[1].split(',').map((s) => s.trim()).filter(Boolean);
    else if (nBlock) needs = [...nBlock[1].matchAll(/-\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    else if (nSingle) needs = [nSingle[1]];
    const ifm = /^\s{4}if:\s*(.+)$/m.exec(body);
    jobs.push({
      id: cur.id,
      timeout: t ? Number(t[1]) : null,
      needs,
      ifExpr: ifm ? ifm[1].trim() : '',
      body,
    });
    cur = null;
  };
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() && !/^\s*#/.test(l)) { flush(i); break; }   // a new top-level key
    const m = /^\s{2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { flush(i); cur = { id: m[1], start: i }; }
    if (i === lines.length - 1) flush(lines.length);
  }
  flush(lines.length);
  return jobs;
}

/** The trigger block, for deciding whether a cancelled job already has a reader. */
export function triggersOn(src: string, event: string): boolean {
  const lines = src.split('\n');
  const at = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (at === -1) return new RegExp(`^on:.*\\b${event}\\b`, 'm').test(src);
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && lines[i].trim()) break;
    if (new RegExp(`^\\s{2}${event}:`).test(lines[i])) return true;
  }
  return false;
}

/**
 * A workflow needs an attendance gate when it has more than one job AND runs on a schedule AND is
 * NOT PR-gated. A PR-gated workflow's cancelled job already shows up as a non-passing required
 * check; a scheduled-only one has nobody looking.
 */
export function needsAttendanceGate(src: string, jobs: WorkflowJob[]): boolean {
  return jobs.length > 1 && triggersOn(src, 'schedule') && !triggersOn(src, 'pull_request');
}

export type GateVerdict = { gate: string | null; problems: string[] };

/**
 * The gate must (a) exist, (b) run `if: always()` so a cancelled sibling cannot skip it, (c) need
 * EVERY other job in the file, and (d) actually fail on a non-success result rather than merely
 * printing one.
 */
export function attendanceVerdict(jobs: WorkflowJob[]): GateVerdict {
  const candidates = jobs.filter((j) => /always\(\)/.test(j.ifExpr) && j.needs.length > 0);
  if (candidates.length === 0) {
    return { gate: null, problems: ['no job runs with `if: always()` and a non-empty `needs:`'] };
  }
  const gate = candidates.reduce((a, b) => (b.needs.length > a.needs.length ? b : a));
  const others = jobs.filter((j) => j.id !== gate.id).map((j) => j.id);
  const problems: string[] = [];
  const missing = others.filter((id) => !gate.needs.includes(id));
  if (missing.length) {
    problems.push(
      `«${gate.id}» does not need [${missing.join(', ')}] — a job it does not need can be ` +
      `cancelled without turning the run red`,
    );
  }
  const unknown = gate.needs.filter((id) => !others.includes(id));
  if (unknown.length) problems.push(`«${gate.id}» needs [${unknown.join(', ')}], which are not jobs in this file`);
  // (d): it has to compare against success and exit non-zero. Both halves, so a gate that prints a
  // warning and returns 0 does not count as a gate.
  const readsResults = /needs\b/.test(gate.body) && /success/.test(gate.body);
  const failsHard = /exit\s+1/.test(gate.body);
  if (!readsResults) problems.push(`«${gate.id}» never compares its needed jobs' results against «success»`);
  if (!failsHard) problems.push(`«${gate.id}» never exits non-zero — it reports, it does not gate`);
  return { gate: gate.id, problems };
}

// ---------------------------------------------------------------------------------------------
// The checks, against the real repo.
// ---------------------------------------------------------------------------------------------

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const rows = parseExclusions(readFileSync(join(ROOT, EXCLUSIONS), 'utf8'));
check(rows.length > 0, `${EXCLUSIONS} parsed — ${rows.length} exclusion row(s)`,
  `${EXCLUSIONS} yielded no rows — the parser or the file shape changed and this barrier is blind`);

const wfHomes = new Map<string, string>();   // workflow path -> source
for (const row of rows) {
  if (!homeIsWorkflow(row.where)) continue;
  const path = join(WF_DIR, basename(row.where));
  const abs = join(ROOT, path);
  if (!existsSync(abs)) {
    problems.push(`${row.name}: its declared home ${row.where} does not exist`);
    continue;
  }
  const src = readFileSync(abs, 'utf8');
  wfHomes.set(path, src);
  check(workflowInvokes(src, row.name),
    `${row.name} is really invoked by ${basename(row.where)}`,
    `${row.name} is excluded from \`npm test\` because it "runs in" ${row.where}, but that ` +
    `workflow never invokes it — the check runs NOWHERE. Point the row at the workflow that ` +
    `actually runs it, or run it.`);
}

check(wfHomes.size > 0, `${wfHomes.size} workflow home(s) resolved`,
  'no exclusion row named a workflow — either the file changed shape or every live check went home');

for (const [path, src] of wfHomes) {
  const jobs = parseJobs(src);
  check(jobs.length > 0, `${basename(path)}: ${jobs.length} job(s) parsed`,
    `${basename(path)}: no jobs parsed — this barrier cannot see inside it`);

  for (const j of jobs) {
    check(j.timeout !== null,
      `${basename(path)} · ${j.id}: declares timeout-minutes: ${j.timeout}`,
      `${basename(path)} · ${j.id}: no timeout-minutes — it inherits GitHub's 360-minute default, ` +
      `which is not a budget anyone chose`);
  }

  if (!needsAttendanceGate(src, jobs)) continue;
  const verdict = attendanceVerdict(jobs);
  check(verdict.problems.length === 0,
    `${basename(path)}: attendance gate «${verdict.gate}» needs every other job and fails on any non-success`,
    `${basename(path)}: ${verdict.problems.join('; ')}. This workflow has ${jobs.length} jobs, runs ` +
    `on a schedule and is not PR-gated, so a job cancelled by its timeout is reported as neither ` +
    `success nor failure and every step behind it as «skipped» — the 2026-09-03 dark-barrier shape.`);
}

check(npmTestRuns(ROOT, 'verify-live-check-workflow-attendance'),
  'npm test runs this barrier',
  'npm test no longer discovers verify-live-check-workflow-attendance.ts');

// ---------------------------------------------------------------------------------------------
// SELF-PROOF. Every predicate above is fed a deliberately corrupted input and must reject it —
// a live workflow's happy path passes whether these are sharp or vacuous.
// ---------------------------------------------------------------------------------------------

const GOOD_WF = [
  'name: x', 'on:', '  schedule:', "    - cron: '0 4 * * *'", '  workflow_dispatch:', '',
  'jobs:', '  a:', '    runs-on: ubuntu-latest', '    timeout-minutes: 10', '    steps:',
  '      - run: node scripts/verify-thing.ts', '  b:', '    runs-on: ubuntu-latest',
  '    timeout-minutes: 20', '    steps:', '      - run: echo hi', '  gate:',
  '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    if: always()',
  '    needs: [a, b]', '    steps:', '      - run: |',
  '          echo "${{ toJSON(needs) }}" | grep -v success && exit 1', '',
].join('\n');

const goodJobs = parseJobs(GOOD_WF);
check(goodJobs.map((j) => j.id).join(',') === 'a,b,gate',
  'self-proof: the job parser finds every job', `self-proof: parser found [${goodJobs.map((j) => j.id)}]`);
check(needsAttendanceGate(GOOD_WF, goodJobs),
  'self-proof: a multi-job scheduled workflow needs a gate', 'self-proof: gate requirement not detected');
check(attendanceVerdict(goodJobs).problems.length === 0,
  'self-proof: a correct gate is accepted', `self-proof: correct gate rejected — ${attendanceVerdict(goodJobs).problems.join('; ')}`);

// M1 — the gate stops needing one of the jobs (today's exact hole).
const m1 = parseJobs(GOOD_WF.replace('needs: [a, b]', 'needs: [a]'));
check(attendanceVerdict(m1).problems.some((p) => p.includes('does not need')),
  'self-proof M1: a gate missing one job is refused', 'self-proof M1: a gate that ignores job «b» PASSED');

// M2 — the gate reports instead of failing.
const m2 = parseJobs(GOOD_WF.replace('&& exit 1', '&& echo warning'));
check(attendanceVerdict(m2).problems.some((p) => p.includes('exits non-zero')),
  'self-proof M2: a gate that never exits non-zero is refused', 'self-proof M2: a toothless gate PASSED');

// M3 — the gate loses `if: always()`, so a cancelled sibling skips it too.
const m3 = parseJobs(GOOD_WF.replace('    if: always()\n', ''));
check(attendanceVerdict(m3).gate === null,
  'self-proof M3: a gate without if: always() is not a gate', 'self-proof M3: a skippable gate PASSED');

// M4 — a job loses its budget.
const m4 = parseJobs(GOOD_WF.replace('    timeout-minutes: 20\n', ''));
check(m4.find((j) => j.id === 'b')?.timeout === null,
  'self-proof M4: a missing timeout-minutes is seen', 'self-proof M4: a budgetless job read as budgeted');

// M5 — the script is only MENTIONED in a comment, never run.
check(!workflowInvokes('jobs:\n  a:\n    steps:\n      # see scripts/verify-thing.ts for why\n      - run: echo hi\n', 'verify-thing.ts'),
  'self-proof M5: a script named only in a comment does not count as invoked',
  'self-proof M5: a commented-out mention counted as a real run');
check(workflowInvokes(GOOD_WF, 'verify-thing.ts'),
  'self-proof M5b: a real `run:` invocation counts', 'self-proof M5b: a real invocation was missed');

// M6 — a PR-gated workflow is exempt (the rule must not over-reach).
check(!needsAttendanceGate(GOOD_WF.replace('  workflow_dispatch:', '  pull_request:'), goodJobs),
  'self-proof M6: a PR-gated workflow is exempt', 'self-proof M6: the rule over-reached onto a PR-gated workflow');

console.log('verify-live-check-workflow-attendance: an excluded check must run where it says it\n' +
  '  runs, inside a budget, in a workflow where a cancelled job cannot read as a clean run.\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — a live barrier may not be running at all.`);
  process.exit(1);
}
console.log(`\n✅ verify-live-check-workflow-attendance: ${ok.length} checks passed.`);
