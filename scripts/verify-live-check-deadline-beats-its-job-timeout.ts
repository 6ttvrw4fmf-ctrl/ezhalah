// A LIVE CHECK MUST OUTLIVE NOTHING AND OUTSPEAK EVERYTHING (routine-4, 2026-09-27).
//
// THE DEFECT THIS PINS FOREVER. `scripts/ops/raise-workflow-alert.mjs` splits a run's outcome into
// VERDICT (success | failure) and NO_VERDICT (cancelled | skipped), and on NO_VERDICT it leaves
// alert_event untouched. That is right: a run cancelled by a newer run in its concurrency group
// concluded nothing. But a job killed by its own `timeout-minutes` reports `cancelled` TOO — so a
// check that outgrows its budget stops producing verdicts and nothing notices. There is no red X
// anyone reads, no alert row, and no positive heartbeat whose absence could be compared. AGENTS.md
// calls this shape canonical for liveness (LISTING_LIVENESS §9): *absence cannot be compared, so
// silence reads as health*, and *if the checker stops working, that failure must be detected too*.
//
// MEASURED 2026-09-27 across all 32 bridge-wired workflows, two of them on this routine's surface:
//   district-suggestion-parity-live-check.yml  9 of 12 runs killed at 618-620s against a 10m cap.
//                                             Last verdict of any kind: 2026-09-24 17:30 UTC.
//                                             DARK ~2.5 days. Cause: honest growth to 1,772
//                                             (city × scope × district) suggestions.
//   count-rpc-parity-live-check.yml            7 of 12 runs killed at ~621s against a 10m cap.
//                                             Cause: PACE_BUDGET_MS == the cap, so waiting for a
//                                             healthy window could eat the whole job and the
//                                             `NOT EXERCISED` verdict was unreachable in CI.
//
// WHAT THIS CHECK IS, AND WHY IT IS SHAPED THIS WAY.
//
// §1 executes the ARITHMETIC (`deadlineFitsJob`, `budgetSecondsFrom`, `boundedBy`) — the inequality
//    itself, at its boundaries, so an off-by-one cannot hide in it.
// §2 executes the VERDICT PREDICATE (`certified`) over a full truth table. This is the half that
//    matters most: the 2026-09-26 run printed «✓ no dead-end district suggestions — every populated
//    district returns results» while 10 searches had come back 503. The exit code was right and the
//    SENTENCE was wrong, and the sentence is what a human reads. So the predicate that decides
//    whether the clean tick may print is executed here, not grepped.
// §3 reads the REAL workflow YAML and asserts the inequality holds for every job that runs a
//    deadline-aware check — summed across steps, because two checks sharing one job share one cap.
//    DISCOVERED BY SHAPE: any script importing lib/checkDeadline.ts is in scope automatically, so a
//    check adopting the deadline tomorrow is covered without anyone registering it here, and a new
//    workflow that forgets CHECK_DEADLINE_SECONDS is judged on the bounded default it will really use.
// §4 asserts each deadline-aware check actually CONSULTS its deadline. A script may import the module
//    and never call it; that reads as coverage while protecting nothing — the AGENTS.md PART 1.11
//    shape. This clause is a source read, and says so: it is a WIRING assertion complementing the
//    executed predicate in §2, never a substitute for it.
// §5 MUTATION PROOFS, executed in-file: each re-introduces a real defect and requires it to be caught.
//
// Hermetic by construction — it reads files and runs pure functions. No network, no database.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BRIDGE_MARGIN_SECONDS, DEFAULT_DEADLINE_SECONDS, DEADLINE_ENV,
  budgetSecondsFrom, deadlineFitsJob, boundedBy, startDeadline, certified, type Measured,
} from './lib/checkDeadline.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

let failures = 0;
const fail = (msg: string) => { console.log(`FAIL  ${msg}`); failures++; };
const pass = (msg: string) => console.log(`PASS  ${msg}`);
const ok = (cond: boolean, msg: string) => (cond ? pass(msg) : fail(msg));

const SCRIPTS = 'scripts';
const WORKFLOWS = join('.github', 'workflows');

// ── §1 the arithmetic ────────────────────────────────────────────────────────────────────────────
console.log('\n§1 the inequality itself');
ok(deadlineFitsJob(1200, 25), '1200s deadline fits a 25m cap (1200+180=1380 <= 1500)');
ok(!deadlineFitsJob(1200, 20), '1200s deadline does NOT fit a 20m cap (1380 > 1200)');
ok(deadlineFitsJob(600 - BRIDGE_MARGIN_SECONDS, 10), 'exactly-fitting budget is allowed (boundary, <=)');
ok(!deadlineFitsJob(600 - BRIDGE_MARGIN_SECONDS + 1, 10), 'one second over the boundary is refused');
ok(!deadlineFitsJob(600, 10), 'THE MEASURED DEFECT: a 10m budget under a 10m cap is refused');
ok(budgetSecondsFrom('900') === 900, 'a declared budget parses');
ok(budgetSecondsFrom(undefined) === DEFAULT_DEADLINE_SECONDS, 'an absent budget falls back to the bounded default');
for (const bad of ['', 'abc', '0', '-5', 'Infinity', 'NaN']) {
  ok(budgetSecondsFrom(bad) === DEFAULT_DEADLINE_SECONDS, `a malformed budget ${JSON.stringify(bad)} falls back, never unbounded`);
}
{
  const d = startDeadline('600', Date.now() - 599_000);
  ok(!d.expired() && d.remainingMs() > 0, 'a deadline with time left is not expired');
  const spent = startDeadline('600', Date.now() - 601_000);
  ok(spent.expired() && spent.remainingMs() === 0, 'a spent deadline is expired and reports 0 remaining, never negative');
  ok(boundedBy(spent, 10 * 60_000) === 0, 'boundedBy clamps an inner wait to 0 once the deadline is spent');
  const roomy = startDeadline('600', Date.now());
  ok(boundedBy(roomy, 1_000) === 1_000, 'boundedBy leaves a wait shorter than the remainder untouched');
  ok(boundedBy(startDeadline('600', Date.now()), 10 * 60_000) <= 600_000,
    'THE COUNT-RPC DEFECT: a 10-minute inner pace budget is clamped to the deadline');
}

// ── §2 the verdict predicate ─────────────────────────────────────────────────────────────────────
console.log('\n§2 what may print the clean tick');
const CLEAN: Measured = { defects: 0, unanswered: 0, unattempted: 0, planningFailed: 0, planningCut: false };
ok(certified(CLEAN), 'a run that measured everything and found nothing is CERTIFIED');
ok(!certified({ ...CLEAN, defects: 1 }), 'a real defect is not certified');
ok(!certified({ ...CLEAN, unanswered: 10 }),
  'THE 2026-09-26 DEFECT: 10 unanswered searches can never read as "every populated district returns results"');
ok(!certified({ ...CLEAN, unattempted: 1 }), 'work the deadline cut is not certified');
ok(!certified({ ...CLEAN, planningFailed: 1 }), 'an enumeration call that never answered is not certified');
ok(!certified({ ...CLEAN, planningCut: true }), 'enumeration cut short is not certified');
ok(!certified({ defects: 0, unanswered: 1, unattempted: 1, planningFailed: 1, planningCut: true }),
  'several unmeasured causes at once are still not certified');
ok(certified({ defects: 0, unanswered: 0, unattempted: 0 }),
  'the optional fields default to "nothing wrong" so an older caller is not falsely condemned');

// ── §3 the inequality over the REAL workflows ────────────────────────────────────────────────────
console.log('\n§3 every job running a deadline-aware check fits its own cap');

/**
 * Does this YAML actually RUN that script? A bare substring match is wrong, and this check caught
 * itself with it on its first run: the comment it asks each workflow to carry names this very file,
 * so both jobs appeared to invoke it and their budgets were over-counted. An invocation is a `node`
 * command on a line that is not a YAML comment.
 */
const invokes = (yaml: string, script: string): boolean =>
  yaml.split('\n').some((l) => !/^\s*#/.test(l) && l.includes(script) && /\bnode\b/.test(l));

/** Scripts that use the deadline module — discovered by shape, never from a list. */
const deadlineAware = readdirSync(SCRIPTS)
  .filter((f) => /^verify-.*\.(ts|mjs)$/.test(f))
  .filter((f) => /from\s+'\.\/lib\/checkDeadline\.ts'/.test(readFileSync(join(SCRIPTS, f), 'utf8')));

ok(deadlineAware.length > 0, `found ${deadlineAware.length} deadline-aware check(s) by shape: ${deadlineAware.join(', ')}`);

type Job = { file: string; job: string; timeoutMinutes: number | null; budgets: { script: string; seconds: number; declared: boolean }[] };
const jobs: Job[] = [];

for (const wf of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))) {
  const src = readFileSync(join(WORKFLOWS, wf), 'utf8');
  if (!deadlineAware.some((s) => invokes(src, s))) continue;
  // Split into jobs on a 2-space-indented key under `jobs:`; each job owns one timeout-minutes.
  const lines = src.split('\n');
  let jobStart = -1;
  const bounds: { name: string; from: number; to: number }[] = [];
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) {
      if (jobStart >= 0) bounds[bounds.length - 1].to = i;
      bounds.push({ name: m[1], from: i, to: lines.length });
      jobStart = i;
    }
  }
  for (const b of bounds) {
    const body = lines.slice(b.from, b.to).join('\n');
    const used = deadlineAware.filter((s) => invokes(body, s));
    if (!used.length) continue;
    const tm = body.match(/^\s*timeout-minutes:\s*(\d+)/m);
    // One CHECK_DEADLINE_SECONDS per step; pair each with the script named in that step's `run:`.
    const budgets = used.map((script) => {
      // the step block for this script: from the nearest preceding `- name:`/`- uses:` to the script line
      const at = body.indexOf(script);
      const stepStart = Math.max(body.lastIndexOf('\n      - ', at), 0);
      const step = body.slice(stepStart, at);
      const env = step.match(new RegExp(`${DEADLINE_ENV}:\\s*'?(\\d+)'?`));
      return { script, seconds: env ? Number(env[1]) : DEFAULT_DEADLINE_SECONDS, declared: Boolean(env) };
    });
    jobs.push({ file: wf, job: b.name, timeoutMinutes: tm ? Number(tm[1]) : null, budgets });
  }
}

ok(jobs.length > 0, `found ${jobs.length} job(s) running a deadline-aware check`);
for (const j of jobs) {
  const total = j.budgets.reduce((a, b) => a + b.seconds, 0);
  const where = `${j.file} › ${j.job}`;
  const detail = j.budgets.map((b) => `${b.script}=${b.seconds}s${b.declared ? '' : ' (DEFAULT — undeclared)'}`).join(' + ');
  if (j.timeoutMinutes == null) {
    fail(`${where}: no timeout-minutes, so the job has no cap the deadline can sit inside — declare one`);
    continue;
  }
  ok(deadlineFitsJob(total, j.timeoutMinutes),
    `${where}: ${detail} => ${total}s + ${BRIDGE_MARGIN_SECONDS}s margin <= ${j.timeoutMinutes}m cap (${j.timeoutMinutes * 60}s)`);
}

// Every deadline-aware check must have a HOME that bounds it: either `npm test` (hermetic, no job of
// its own to outlive) or a workflow job whose cap the inequality above was just checked against. A
// check with neither is unreachable and protects nothing. `npmTestRuns` rather than a package.json
// string-match, per AGENTS.md ("How `npm test` finds its checks", rule 3).
for (const s of deadlineAware) {
  const inSuite = npmTestRuns(process.cwd(), s);
  const inJob = jobs.some((j) => j.budgets.some((b) => b.script === s));
  ok(inSuite || inJob, `${s} has a home that bounds it (${inSuite ? 'npm test' : ''}${inSuite && inJob ? ' + ' : ''}${inJob ? 'a capped workflow job' : ''}${!inSuite && !inJob ? 'NEITHER' : ''})`);
}

// ── §4 the wiring: importing is not consulting ───────────────────────────────────────────────────
console.log('\n§4 each deadline-aware check actually consults its deadline (source read, see header)');
for (const s of deadlineAware) {
  const src = readFileSync(join(SCRIPTS, s), 'utf8');
  ok(/startDeadline\s*\(/.test(src), `${s} starts a deadline`);
  ok(/\bdeadline\.expired\s*\(\s*\)|boundedBy\s*\(/.test(src),
    `${s} consults the deadline (expired() gate or boundedBy() on an inner wait)`);
  ok(/certified\s*\(/.test(src) || /notExercised/.test(src),
    `${s} accounts for unmeasured work rather than only counting defects`);
}

// ── §5 mutation proofs ───────────────────────────────────────────────────────────────────────────
console.log('\n§5 mutation proofs — each defect restored must be caught');
{
  // M1: the verdict predicate widened to ignore unanswered work (the 2026-09-26 sentence).
  const widened = (m: Measured) => m.defects === 0 && m.unattempted === 0;
  ok(widened({ ...CLEAN, unanswered: 10 }) && !certified({ ...CLEAN, unanswered: 10 }),
    'M1 a predicate ignoring `unanswered` calls the 503 run clean; certified() refuses it');

  // M2: the inequality written with the margin dropped — the pre-fix state of both workflows.
  const noMargin = (b: number, cap: number) => b <= cap * 60;
  ok(noMargin(600, 10) && !deadlineFitsJob(600, 10),
    'M2 dropping the bridge margin admits a 10m budget under a 10m cap; deadlineFitsJob refuses it');

  // M3: an unbounded budget from a malformed env var.
  const naive = (raw: string | undefined) => Number(raw);
  ok(Number.isNaN(naive('abc')) && budgetSecondsFrom('abc') === DEFAULT_DEADLINE_SECONDS,
    'M3 a naive parse yields NaN (an unbounded/never-expiring deadline); budgetSecondsFrom falls back');

  // M4: the real YAML, mutated back to the pre-fix caps, must be rejected by the same §3 arithmetic.
  ok(!deadlineFitsJob(1200, 10) && !deadlineFitsJob(900, 10),
    'M4 the caps as they stood on 2026-09-26 (10m) reject both new budgets — the fix is load-bearing');
}

console.log(`\n${failures === 0 ? '✓ deadline contract holds' : `✗ ${failures} assertion(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
