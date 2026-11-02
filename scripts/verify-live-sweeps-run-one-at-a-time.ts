// The production sweeps of a live-check workflow run ONE AT A TIME (owner rule 2026-10-09, «our own
// robots must not take production down»; measured 2026-11-02, backlog 1203, PR #9979).
//
// af-live-truth-check.yml's own 2026-09-04 comment already proved the knee by experiment (concurrency
// knee 3, ~1.5 searches/s) and still started its three RPC sweeps side by side the moment the browser
// jobs finished — 3 × 2 probes = 6 walkers. On 2026-11-02 at 14:00:17 UTC that took the production
// search mean from 257–1,147 ms to 2,228–7,242 ms for an hour (evening peak), queued nine robots in
// robot_gate(), failed every PR's required smoke on load and stalled eleven PRs. A rule that lives in a
// comment is not a rule; this check reads the YAML SHAPE: every job that runs a production sweep script
// must `needs:` another sweep job, except exactly one root — so at most one sweep is ever in flight.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW = join(process.cwd(), '.github/workflows/af-live-truth-check.yml');
// A `run:` step that executes one of these walks the live pool with its own self-limited concurrency
// (open-ended RPC walkers; the browser journeys are their victims, not members). Matched on `run:`
// lines only — the file's comments name these scripts too.
const SWEEP_SCRIPTS = [
  'verify-af-full-surface-differential.ts',
  'verify-af-matrix-truth-live.ts',
];

type Job = { id: string; needs: string[]; sweep: boolean };

export function parseJobs(src: string): Job[] {
  const jobsAt = src.search(/^jobs:\s*$/m);
  if (jobsAt < 0) return [];
  const body = src.slice(jobsAt);
  const heads = [...body.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)];
  return heads.map((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : body.length;
    const block = body.slice(start, end);
    const inline = /^\s{4}needs:\s*\[([^\]]*)\]\s*$/m.exec(block);
    const single = /^\s{4}needs:\s*([A-Za-z0-9_-]+)\s*$/m.exec(block);
    const list = /^\s{4}needs:\s*\n((?:\s{6}-\s*[A-Za-z0-9_-]+\s*\n?)+)/m.exec(block);
    let needs: string[] = [];
    if (inline) needs = inline[1].split(',').map((s) => s.trim()).filter(Boolean);
    else if (list) needs = [...list[1].matchAll(/-\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    else if (single) needs = [single[1]];
    const runs = [...block.matchAll(/^\s+(?:-\s+)?run:.*$/gm)].map((m) => m[0]).join('\n');
    const sweep = SWEEP_SCRIPTS.some((s) => runs.includes(s));
    return { id: h[1], needs, sweep };
  });
}

/** Problems with the sweep chain; empty when at most one sweep can run at a time. */
export function sweepChainProblems(jobs: Job[]): string[] {
  const sweeps = jobs.filter((j) => j.sweep);
  const ids = new Set(sweeps.map((j) => j.id));
  const problems: string[] = [];
  if (sweeps.length === 0) problems.push('no job runs a production sweep script — the list in SWEEP_SCRIPTS is stale');
  const roots = sweeps.filter((j) => !j.needs.some((n) => ids.has(n)));
  if (roots.length > 1) {
    problems.push(`${roots.length} sweep jobs start without waiting for another sweep: ${roots.map((j) => j.id).join(', ')} — they run side by side`);
  }
  // Two sweeps waiting on the SAME predecessor also run side by side.
  const byPred = new Map<string, string[]>();
  for (const j of sweeps) for (const n of j.needs) if (ids.has(n)) byPred.set(n, [...(byPred.get(n) ?? []), j.id]);
  for (const [pred, kids] of byPred) if (kids.length > 1) problems.push(`${kids.join(' and ')} both wait only for ${pred}, so they start together`);
  return problems;
}

let failed = 0;
const check = (ok: boolean, name: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => check(caught, `(mutation) catches ${label}`);

const src = readFileSync(WORKFLOW, 'utf8');
const jobs = parseJobs(src);
const sweeps = jobs.filter((j) => j.sweep);
check(sweeps.length === 3, `af-live-truth-check.yml declares the three production sweeps (found ${sweeps.length}: ${sweeps.map((j) => j.id).join(', ')})`);
const problems = sweepChainProblems(jobs);
check(problems.length === 0, 'the sweeps are chained so at most one runs at a time', problems.join('; '));

// Mutation proofs — the shape that hurt production on 2026-11-02 must be RED.
const parallel = src
  .replace(/^(  af-surface-city:\n    needs: )\[[^\]]*\]/m, '$1[gate, af-truth, af-card-state]')
  .replace(/^(  af-matrix:\n    needs: )\[[^\]]*\]/m, '$1[gate, af-truth, af-card-state]');
check(parallel !== src, 'self-proof: the mutation really rewrote the two needs lines');
mustCatch('the 2026-11-02 fan-out (three sweeps beside each other)', sweepChainProblems(parseJobs(parallel)).length > 0);
const fork = src.replace(/^(  af-matrix:\n    needs: )\[[^\]]*\]/m, '$1[gate, af-surface-region]');
mustCatch('two sweeps hanging off the same predecessor', sweepChainProblems(parseJobs(fork)).length > 0);
const synthetic = parseJobs('jobs:\n  a:\n    steps:\n      - run: node scripts/verify-af-matrix-truth-live.ts\n  b:\n    needs: [a]\n    steps:\n      - run: node scripts/verify-af-full-surface-differential.ts\n');
check(sweepChainProblems(synthetic).length === 0, 'self-proof: a strict chain of two sweeps is GREEN');

if (failed) { console.error(`\n❌ verify-live-sweeps-run-one-at-a-time: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ verify-live-sweeps-run-one-at-a-time: every production sweep waits for the previous one');
