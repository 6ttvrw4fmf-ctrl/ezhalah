// The daily AF live check must not share a concurrency group with the deploy-triggered runs.
//
// HOW THIS WAS EARNED (🔬 2026-11-04, alert 11763 af_live_check_failed). GitHub keeps ONE pending run per
// concurrency group and cancels the older pending one. af-live-truth-check.yml had one static group, and the deploy
// workflow triggers it many times an hour — mostly runs whose gate finds no shipped bundle and verifies nothing. Those
// replaced the waiting daily run (schedule runs 41632499202 and 41446221331: cancelled), so after the 11-04 harness
// fix nothing verified production and the alert stood open on a stale failure. This reads the workflow's real
// concurrency group, evaluates it for each event, and requires the daily events to land outside the deploy group.
//
//   node --experimental-strip-types scripts/verify-af-live-daily-is-not-replaced-by-deploy-runs.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WF = join(import.meta.dirname, '..', '.github', 'workflows', 'af-live-truth-check.yml');

/** The concurrency group the workflow file declares, evaluated for one event (the only expression it may use). */
function groupFor(yml: string, event: string): string | null {
  const m = /\nconcurrency:\s*\n\s+group:\s*([^\n]+)/.exec(yml);
  if (!m) return null;
  return m[1].trim().replace(/\$\{\{\s*github\.event_name == 'workflow_run' && '([^']+)' \|\| '([^']+)'\s*\}\}/g,
    (_, a, b) => (event === 'workflow_run' ? a : b));
}

function problems(yml: string): string[] {
  const out: string[] = [];
  const deploy = groupFor(yml, 'workflow_run');
  if (!deploy) return ['no workflow-level concurrency group found'];
  if (deploy.includes('${{')) out.push(`the group uses an expression this check cannot evaluate: ${deploy}`);
  for (const ev of ['schedule', 'workflow_dispatch']) {
    if (groupFor(yml, ev) === deploy) out.push(`a ${ev} run shares the deploy runs' group «${deploy}» — a deploy no-op can cancel it while it waits`);
  }
  if (!/cancel-in-progress:\s*false/.test(yml)) out.push('cancel-in-progress must stay false (a running sweep is never killed)');
  return out;
}

const yml = readFileSync(WF, 'utf8');
const bad = problems(yml);
if (bad.length) { console.error('✗ af-live-truth-check concurrency:\n  ' + bad.join('\n  ')); process.exit(1); }

const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ mutation proof: ${label} was NOT caught`); process.exit(1); }
};
const old = yml.replace(/(\nconcurrency:\s*\n\s+group:\s*)[^\n]+/, '$1af-live-truth-check');
mustCatch('the old single shared group', problems(old).length > 0);
mustCatch('a running sweep made cancellable', problems(yml.replace(/cancel-in-progress:\s*false/, 'cancel-in-progress: true')).length > 0);

console.log('✓ the daily AF live check waits in its own concurrency group; deploy no-ops cannot cancel it (mutations caught)');
