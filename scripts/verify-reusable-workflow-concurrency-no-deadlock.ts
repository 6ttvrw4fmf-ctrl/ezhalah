// A WORKFLOW THAT CALLS ANOTHER (`uses: ./.github/workflows/X.yml`) MUST NOT HOLD THE SAME
// CONCURRENCY GROUP AS THE WORKFLOW IT CALLS.
//
// WHY THIS EXISTS (real defect, 2026-10-10 → 2026-10-11, found by the ♻️ Lifecycle Engineer).
// dealapp-liveness-cron.yml was added so pg_cron could run the dealapp liveness sweep every 2 hours
// with apply=true. It called dealapp-liveness.yml and, "so two sweeps never overlap", declared the
// callee's own group `concurrency: dealapp-liveness` at its top level as well. GitHub treats a caller
// and callee holding one group as a deadlock and fails the run before a single job starts: all 12
// pg_cron dispatches from 10-10 12:40 to 10-11 10:40 UTC ended `failure` with ZERO jobs, so no
// dealapp_liveness scrape_runs row was written for 26 hours, while pg_cron's own job_run_details read
// `succeeded` on every one (it only records that the dispatch was accepted). Removed dealapp ads were
// not being struck at all during that window.
//
// The callee's own concurrency block already serialises every run of it, so the caller never needs
// one of its own for the same group. This check reads every caller in .github/workflows, resolves
// each local callee, and fails when the two top-level groups are equal. A mutation proof runs first:
// the exact shape of the defect must be caught, and the fixed shape must pass.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';

/** The top-level `concurrency:` group of a workflow file, or null. Both the short form
 *  (`concurrency: name`) and the mapping form (`concurrency:\n  group: name`) are read. */
export function topLevelGroup(src: string): string | null {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^concurrency:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].replace(/#.*$/, '').trim();
    if (inline) return inline.replace(/^['"]|['"]$/g, '');
    for (let j = i + 1; j < lines.length && /^(\s+|$)/.test(lines[j]); j++) {
      const g = /^\s+group:\s*(.+?)\s*(#.*)?$/.exec(lines[j]);
      if (g) return g[1].replace(/^['"]|['"]$/g, '');
    }
    return null;
  }
  return null;
}

/** Local reusable workflows a file calls (`uses: ./.github/workflows/<file>`). */
export function localCallees(src: string): string[] {
  return [...src.matchAll(/^\s+uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)\s*$/gm)].map((m) => m[1]);
}

export function deadlocks(caller: string, callerSrc: string, read: (f: string) => string | null): string[] {
  const mine = topLevelGroup(callerSrc);
  if (!mine) return [];
  const out: string[] = [];
  for (const callee of localCallees(callerSrc)) {
    const src = read(callee);
    if (src != null && topLevelGroup(src) === mine) {
      out.push(`${caller} holds concurrency group '${mine}' and calls ${callee}, which holds the same group: GitHub fails every run before any job starts`);
    }
  }
  return out;
}

// ── mutation proof: the 2026-10-10 shape must be caught, the fixed shape must pass ──────────────
const CALLEE = 'on:\n  workflow_call:\nconcurrency:\n  group: dealapp-liveness\n  cancel-in-progress: false\njobs: {}\n';
const BAD = 'on:\n  workflow_dispatch:\n\nconcurrency:\n  group: dealapp-liveness\n  cancel-in-progress: false\n\njobs:\n  sweep:\n    uses: ./.github/workflows/callee.yml\n';
const GOOD = 'on:\n  workflow_dispatch:\n\njobs:\n  sweep:\n    uses: ./.github/workflows/callee.yml\n';
const INLINE = 'concurrency: dealapp-liveness\njobs:\n  sweep:\n    uses: ./.github/workflows/callee.yml\n';
const stub = (f: string) => (f === 'callee.yml' ? CALLEE : null);
const proof: string[] = [];
const mustCatch = (label: string, caught: boolean) => { if (!caught) proof.push(label); };
mustCatch('the 2026-10-10 deadlock shape (mapping form) is caught', deadlocks('bad.yml', BAD, stub).length === 1);
mustCatch('the short-form concurrency shape is caught', deadlocks('inline.yml', INLINE, stub).length === 1);
mustCatch('a caller with no group of its own is NOT flagged', deadlocks('good.yml', GOOD, stub).length === 0);
if (proof.length) {
  console.error('✗ verify-reusable-workflow-concurrency-no-deadlock: mutation proof failed\n  ' + proof.join('\n  '));
  process.exit(1);
}

// ── the real tree ─────────────────────────────────────────────────────────────────────────────
const read = (f: string) => (existsSync(join(DIR, f)) ? readFileSync(join(DIR, f), 'utf8') : null);
const failures: string[] = [];
let callers = 0;
for (const f of readdirSync(DIR).filter((x) => /\.ya?ml$/.test(x)).sort()) {
  const src = readFileSync(join(DIR, f), 'utf8');
  if (!localCallees(src).length) continue;
  callers++;
  failures.push(...deadlocks(f, src, read));
}
if (failures.length) {
  console.error('✗ verify-reusable-workflow-concurrency-no-deadlock\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log(`✓ verify-reusable-workflow-concurrency-no-deadlock: ${callers} caller workflow(s), none shares a concurrency group with its callee (mutation proof 3/3)`);
