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
export const HOSTED_ONLY: Record<string, string> = {
  'dealapp-sharded.yml': 'dealapp throttles PER IP; its 24 shards were built for one IP each, and on our one server they all shared one IP and held 5 of 8 workers for 11 h (2026-11-14)',
  'web-runtime-smoke.yml': 'phone-speed robots froze on the own server under full load (owner 2026-11-13: «we can split for now»)',
  'deploy-frontend.yml': 'the production deploy is a short control-plane job; on the own server run 43547632389 waited 10 h for a runner behind the crawls, so merged customer fixes did not ship (🔧 2026-11-14)',
  'auto-deploy-merged-fixes.yml': 'the hourly canary deploy of merged src/ fixes is a short control-plane job; it queued 5.6 h on the own server 2026-11-14 (run 43572437722) (🔧 2026-11-14)',
  'apply-migration.yml': 'applying a night migration is a 2-minute job the engineers wait on inside their slot; run 43590661927 queued 1.8 h+ on the own server 2026-11-14 (🔧 2026-11-14)',
  'migration-auto-mirror.yml': 'the mirror robot is what keeps the drift gate from refusing every deploy; it queued 5 h on the own server 2026-11-14 (run 43575067881) (🔧 2026-11-14)',
  'alert-dispatch.yml': 'alert delivery has a 5-minute P0 SLA (alert_delivery P1 14661 and repeat_bug:alert_delivery 14670 opened 2026-11-14 00:44 while its runs queued); a delivery job never waits behind a crawl (🔧 2026-11-14)',
  'site-speed-live.yml': 'phone-speed robot (4x CPU throttle): on the own server it got a runner twice in 17 h after the 20:30 UTC 11-13 switch, red both times (04:43, 09:34: waitForFunction 30 s timeout) and 30+ passes were cancelled; the 22 passes before on GitHub ran every 30 min, 18 green (🔧 2026-11-14)',
  'map-pins-live.yml': 'phone map robot (same CPU-throttled class as web-runtime-smoke, owner 2026-11-13); red 17:55 UTC 11-13 after the switch and its runs queued 3 h+ (🔧 2026-11-14)',
  'ad-viewer-speed-live.yml': 'phone 4G ad-viewer speed robot (owner: in-app sites must stay under 3 s); same throttled class as web-runtime-smoke; queued 2.3 h on the own server 2026-11-14 (🔧 2026-11-14)',
  'common-location-tests.yml': 'reports the merge-gating «test» check on every scrapers/ PR head through its push trigger; 12 push runs queued 3-4 h on the own server and the robot refused #12188 #12189 #12190 with «test is PENDING» at 13:21 UTC (🔧 2026-11-14)',
  'iphone-robot-live.yml': 'iPhone-emulation robot, same throttled class as web-runtime-smoke (owner 2026-11-13); queued 5 h on the own server 2026-11-14 (run 43574663651) (🔧 2026-11-14)',
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
