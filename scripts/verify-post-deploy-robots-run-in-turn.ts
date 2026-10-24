// P1 SPEED (owner 2026-10-23): post-deploy production robots run one after another, not stacked.
//
// At 19:58 UTC four production robots started the second the deploy finished (Guardian journeys, Selector E2E,
// Ad viewer speed, AF backend-truth) on top of PR robots, and real users' searches waited behind them. Now the
// light browser robots form a chain — Deploy → Guardian journeys → Selector E2E → Ad viewer speed — and only two
// workflows may start on the deploy itself: Guardian (the head) and AF backend-truth, whose gate must read the
// deploy run's own log (scripts/af-live-truth-deploy-gate.ts). A NEW production robot that wants to run after a
// deploy must chain behind the last link (Ad viewer speed) instead of starting with the deploy; this file fails
// until it does. A chained link must still run after a RED predecessor (only «skipped» — a failed deploy — stops
// the chain), so chaining never quietly drops a check.
//   node --experimental-strip-types scripts/verify-post-deploy-robots-run-in-turn.ts   (discovered by `npm test`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', '.github', 'workflows');
const read = () => Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

const DEPLOY = 'Deploy frontend (production)';
const DIRECT_OK = ['guardian-journeys.yml', 'af-live-truth-check.yml'];
const CHAIN: [string, string][] = [
  ['selector-e2e.yml', 'Guardian journeys (production)'],
  ['ad-viewer-speed-live.yml', 'Selector E2E (production)'],
];
const CHAINED_IF = "github.event_name != 'workflow_run' || (github.event.workflow_run.event == 'workflow_run' && github.event.workflow_run.conclusion != 'skipped')";

/** The workflow names listed under `workflow_run: workflows:` (inline list or block list). */
function upstreams(yml: string): string[] {
  const m = /\n  workflow_run:\s*\n\s+workflows:\s*(\[[^\]]*\]|(?:\n\s+-\s+[^\n]+)+)/.exec(yml);
  if (!m) return [];
  const raw = m[1].trim().startsWith('[') ? m[1].replace(/^\[|\]$/g, '').split(',') : m[1].split(/\n\s+-\s+/);
  return raw.map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

function problems(wfs: Record<string, string>): string[] {
  const fail: string[] = [];
  const onDeploy = Object.keys(wfs).filter((f) => upstreams(wfs[f]).includes(DEPLOY));
  for (const f of onDeploy) if (!DIRECT_OK.includes(f)) fail.push(`${f} starts on the deploy itself — chain it behind ad-viewer-speed-live.yml ('Ad viewer speed — live guard') instead`);
  for (const f of DIRECT_OK) if (!onDeploy.includes(f)) fail.push(`${f} no longer runs after a deploy`);
  for (const [f, up] of CHAIN) {
    const y = wfs[f];
    if (!y) { fail.push(`${f} is missing`); continue; }
    if (upstreams(y).join('|') !== up) fail.push(`${f} must run after '${up}' (found: ${upstreams(y).join(', ') || 'none'})`);
    if (!y.includes(`if: ${CHAINED_IF}`)) fail.push(`${f} must run after any non-skipped predecessor (a RED predecessor still runs it)`);
    if (/workflow_run\.conclusion == 'success'/.test(y)) fail.push(`${f} skips after a red predecessor — that drops a check`);
  }
  return fail;
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const wfs = read();
const p = problems(wfs);
check('post-deploy robots run in turn: Deploy → Guardian → Selector → Ad viewer (AF keeps its own deploy gate)', p.length === 0, p.join('; '));

const withNew = { ...wfs, 'new-live-robot.yml': "name: New robot\non:\n  workflow_run:\n    workflows: ['Deploy frontend (production)']\n    types: [completed]\njobs: {}\n" };
mustCatch('a new production robot starting with the deploy', problems(withNew).length > 0);
mustCatch('Selector put back on the deploy', problems({ ...wfs, 'selector-e2e.yml': wfs['selector-e2e.yml'].replace('workflows: ["Guardian journeys (production)"]', 'workflows: ["Deploy frontend (production)"]') }).length > 0);
mustCatch('a chained link that skips after a red predecessor', problems({ ...wfs, 'ad-viewer-speed-live.yml': wfs['ad-viewer-speed-live.yml'].replace(CHAINED_IF, "github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'") }).length > 0);
mustCatch('Guardian no longer running after a deploy', problems({ ...wfs, 'guardian-journeys.yml': wfs['guardian-journeys.yml'].replace("workflows: ['Deploy frontend (production)']", "workflows: ['Something else']") }).length > 0);

if (failed) { console.error(`\n❌ verify-post-deploy-robots-run-in-turn: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-post-deploy-robots-run-in-turn: production robots take turns after a deploy.');
