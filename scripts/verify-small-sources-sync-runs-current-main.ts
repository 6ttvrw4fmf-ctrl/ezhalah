// A small-sources-sync job dispatched from main must run main's scraper code AS OF WHEN THE JOB STARTS.
//
// 2026-10-31: the fixed daryusuf crawl (06a6856, 06:54 UTC) stored 13109421 «Villa for sale … 1,480,000 SAR» as a
// sale. The 04:22 UTC nightly had been dispatched on ad8e469, before the fix; its daryusuf job waited for a runner
// and ran at 07:16 (job 124443009932) with the old code, writing the villa back as a 1.48 M yearly RENT that no
// sale search finds. The nightly's 144 jobs routinely wait hours (2026-11-01: 96 still queued at 05:15), so any
// fix merged during that window was undone the same morning. The `sync` job therefore checks out `main` when the
// run's ref is main, and keeps its own commit for a branch (probe) dispatch.
//
// This reads the workflow's real `sync` job and checks its checkout step; each mustCatch replays a regression.
//   node --experimental-strip-types scripts/verify-small-sources-sync-runs-current-main.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const WF = readFileSync(join(root, '.github', 'workflows', 'small-sources-sync.yml'), 'utf8');
const WANT_REF = "ref: ${{ github.ref == 'refs/heads/main' && 'main' || github.sha }}";

// The `sync:` job body: from its `  sync:` line to the next top-level job key (2-space indent) or EOF.
export function syncJob(wf: string): string | null {
  const lines = wf.split('\n');
  const i = lines.findIndex((l) => /^ {2}sync:\s*$/.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[j])) j++;
  return lines.slice(i, j).join('\n');
}

// Problems with the sync job's checkout; [] = runs current main for a main dispatch.
export function problems(wf: string): string[] {
  const job = syncJob(wf);
  if (!job) return ['no `sync:` job found in small-sources-sync.yml'];
  const lines = job.split('\n');
  const co = lines.findIndex((l) => /-\s*uses:\s*actions\/checkout@/.test(l));
  if (co < 0) return ['the sync job has no actions/checkout step'];
  // The checkout step's own lines: until the next `- ` step item at the same indent.
  const ind = lines[co].search(/-/);
  let k = co + 1;
  while (k < lines.length && !(lines[k].search(/\S/) === ind && lines[k].trimStart().startsWith('- '))) k++;
  const step = lines.slice(co, k).map((l) => l.trim()).filter((l) => !l.startsWith('#'));
  if (!step.includes(WANT_REF)) {
    return [`the sync job's checkout does not pin \`${WANT_REF}\` — a queued nightly job would run the dispatch-time commit`];
  }
  return [];
}

let fail = 0;
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.error('✗ ' + m); } else console.log('✓ ' + m); };

const real = problems(WF);
ok(real.length === 0, `sync job checks out current main for a main dispatch${real.length ? ': ' + real.join('; ') : ''}`);

const mustCatch = (name: string, mutant: string) => ok(problems(mutant).length > 0, `mustCatch: ${name}`);
mustCatch('checkout back to the dispatch-time commit (the 2026-10-31 shape)', WF.replace(WANT_REF, ''));
mustCatch('ref always github.sha', WF.replace(WANT_REF, 'ref: ${{ github.sha }}'));
mustCatch('ref line commented out', WF.replace(WANT_REF, '# ' + WANT_REF));
mustCatch('sync job renamed away', WF.replace(/^ {2}sync:\s*$/m, '  crawl:'));
// The plan job's sparse checkout must not satisfy the rule by itself.
ok(syncJob(WF)?.includes('fromJSON(needs.plan.outputs.matrix)') === true, 'the job checked is the matrix sync job');

if (fail) { console.error(`\n${fail} problem(s)`); process.exit(1); }
console.log('\nsmall-sources-sync runs current main ✓');
