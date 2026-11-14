// SECURITY + COST (owner-approved plan, Phase 2, 2026-10-21): every job can move to our own server with ONE repo
// variable, and a pull request can never run on it while the repo is public. docs/ops/OWN_SERVER_RUNNERS.md.
//
// Every `runs-on:` in .github/workflows must be exactly SWITCH below:
//   * EZ_RUNNER unset → 'ubuntu-latest' (today's behaviour);
//   * EZ_RUNNER = 'ezhalah-own' → our server, EXCEPT pull_request / pull_request_target, which stay on GitHub,
//     because on a public repo anyone can open a fork PR and fork code must never run on a self-hosted machine.
// The expression is EVALUATED below for every event, not just matched as text. A new workflow that hard-codes a
// runner is RED, so the switch cannot quietly leave a job behind (or send one somewhere unsafe).
//   node --experimental-strip-types scripts/verify-runner-switch.ts   (discovered by `npm test`)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SWITCH = "${{ (github.event_name != 'pull_request' && github.event_name != 'pull_request_target' && vars.EZ_RUNNER) || 'ubuntu-latest' }}";
const dir = join(import.meta.dirname, '..', '.github', 'workflows');

// A tiny evaluator for exactly the GitHub-expression shape SWITCH uses: `(a != 'x' && b != 'y' && vars.V) || 'z'`.
function evalSwitch(expr: string, event: string, ezRunner: string): string {
  const m = /^\$\{\{ \((.*)\) \|\| '([^']+)' \}\}$/.exec(expr);
  if (!m) return 'UNPARSEABLE';
  let ok: string | false = true as unknown as string;
  for (const part of m[1].split(' && ')) {
    const ne = /^github\.event_name != '([^']+)'$/.exec(part);
    const v = /^vars\.EZ_RUNNER$/.exec(part);
    if (ne) { if (event === ne[1]) { ok = false; break; } }
    else if (v) { ok = ezRunner || false; if (!ok) break; }
    else return 'UNPARSEABLE';
  }
  return ok ? String(ok) : m[2];
}

// Workflows that stay on GitHub's machines whatever EZ_RUNNER says — a reviewed list, each with its reason. Every job in a
// listed file says exactly `ubuntu-latest`; every other file uses the switch. Keeping a job on GitHub is always safe (it is
// where pull requests run anyway); the list only exists so the choice is deliberate, never a stray hard-code.
const LIFECYCLE = 'the lifecycle checkers are deadline jobs (gathern 24 h, others 48 h); on the 6-runner own server they queued 10-14 h behind long matrix jobs and every hourly gathern/dealapp sweep was cancelled from 18:37 UTC 2026-11-13 (♻️ 2026-11-14)';
export const HOSTED_ONLY: Record<string, string> = {
  'dealapp-sharded.yml': 'dealapp throttles PER IP; its 24 shards were built for one IP each, and on our one server they all shared one IP and held 5 of 8 workers for 11 h (2026-11-14)',
  'aqar-liveness.yml': LIFECYCLE,
  'aqar-liveness-recheck.yml': LIFECYCLE,
  'customer-journey.yml': 'every engineer\'s live-site proof; queued 3 h on the own server 2026-11-14, so no fix could be proven (♻️)',
  'dead-visible-score.yml': LIFECYCLE,
  'dealapp-liveness.yml': LIFECYCLE,
  'fleet-liveness.yml': LIFECYCLE,
  'fleet-liveness-recheck.yml': LIFECYCLE,
  'gathern-liveness.yml': LIFECYCLE,
  'gathern-recheck-dead.yml': LIFECYCLE,
  'lifecycle-spot-check.yml': LIFECYCLE,
  'wasalt-enum-liveness.yml': LIFECYCLE,
  'web-runtime-smoke.yml': 'phone-speed robots froze on the own server under full load (owner 2026-11-13: «we can split for now»)',
};
function problems(files: Record<string, string>, expr = SWITCH): string[] {
  const fail: string[] = [];
  for (const [f, src] of Object.entries(files)) {
    for (const line of src.split('\n')) {
      const m = /^\s*runs-on:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      if (f in HOSTED_ONLY) { if (m[1] !== 'ubuntu-latest') fail.push(`${f}: listed as GitHub-only but runs-on is "${m[1]}"`); }
      else if (m[1] !== expr) fail.push(`${f}: runs-on is "${m[1]}", not the switch`);
    }
  }
  for (const f of Object.keys(HOSTED_ONLY)) if (Object.keys(files).length > 1 && !(f in files)) fail.push(`HOSTED_ONLY names ${f}, which does not exist`);
  for (const ev of ['pull_request', 'pull_request_target']) {
    if (evalSwitch(expr, ev, 'ezhalah-own') !== 'ubuntu-latest') fail.push(`a ${ev} event would run on our own server`);
  }
  for (const ev of ['push', 'schedule', 'workflow_dispatch', 'workflow_run']) {
    if (evalSwitch(expr, ev, '') !== 'ubuntu-latest') fail.push(`with EZ_RUNNER unset, ${ev} does not stay on GitHub`);
    if (evalSwitch(expr, ev, 'ezhalah-own') !== 'ezhalah-own') fail.push(`with EZ_RUNNER set, ${ev} does not move to our server`);
  }
  return fail;
}

const files: Record<string, string> = {};
for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) files[f] = readFileSync(join(dir, f), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const p = problems(files);
const jobs = Object.values(files).reduce((n, s) => n + (s.match(/^\s*runs-on:/gm) ?? []).length, 0);
check(`all ${jobs} jobs in ${Object.keys(files).length} workflows use the runner switch; PRs never reach our server`, p.length === 0, p.slice(0, 5).join('; '));
mustCatch('a GitHub-only workflow moved to the switch or our server', problems({ ...files, 'web-runtime-smoke.yml': 'jobs:\n  a:\n    runs-on: ezhalah-own\n' }).length > 0);
mustCatch('a workflow hard-coding ubuntu-latest', problems({ ...files, 'x.yml': 'jobs:\n  a:\n    runs-on: ubuntu-latest\n' }).length > 0);
mustCatch('a workflow hard-coding our server', problems({ ...files, 'x.yml': 'jobs:\n  a:\n    runs-on: ezhalah-own\n' }).length > 0);
mustCatch('the pull_request guard dropped (fork code on our server)',
  problems({}, "${{ (github.event_name != 'pull_request_target' && vars.EZ_RUNNER) || 'ubuntu-latest' }}").length > 0);

if (failed) { console.error(`\n❌ verify-runner-switch: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-runner-switch: one variable moves every job to our server; pull requests stay on GitHub.');
