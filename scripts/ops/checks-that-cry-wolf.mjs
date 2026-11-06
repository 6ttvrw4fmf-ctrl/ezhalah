// Weekly: list every check robot whose verdict flips on unchanged code (scripts/lib/flipFlops.mjs). Goes RED when one
// flips >= FLIP_LIMIT times in 7 days, so the run reaches alert_event through raise-workflow-alert.mjs. A failed GitHub
// read is a FAILURE, never «no wolves».
import { flipFlops } from '../lib/flipFlops.mjs';
const REPO = process.env.GITHUB_REPOSITORY || '6ttvrw4fmf-ctrl/ezhalah';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const FLIP_LIMIT = 3;
const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
async function gh(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}`);
  return r.json();
}
const wfs = (await gh('actions/workflows?per_page=100')).workflows.filter((w) => w.state === 'active');
if (!wfs.length) throw new Error('no workflows read — refusing to report «no wolves»');
const rows = [];
for (const w of wfs) {
  const runs = [];
  for (let page = 1; page <= 5; page++) {
    const got = (await gh(`actions/workflows/${w.id}/runs?branch=main&per_page=100&page=${page}&created=>=${since}`)).workflow_runs;
    runs.push(...got.filter((r) => r.event === 'schedule' || r.event === 'workflow_dispatch'));
    if (got.length < 100) break;
  }
  const flips = flipFlops(runs);
  if (flips) rows.push({ flips, red: runs.filter((r) => r.conclusion === 'failure').length, runs: runs.length, file: w.path.split('/').pop() });
}
rows.sort((a, b) => b.flips - a.flips);
const wolves = rows.filter((r) => r.flips >= FLIP_LIMIT);
const lines = [`Checks whose verdict flipped on unchanged code, last 7 days (${wfs.length} workflows read):`, ...rows.map((r) => `  ${r.flips} flips  ${r.red}/${r.runs} red  ${r.file}${r.flips >= FLIP_LIMIT ? '   ← CRIES WOLF' : ''}`)];
console.log(lines.join('\n') || 'none');
if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import('node:fs'); appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n'); }
if (wolves.length) { console.error(`\n✗ ${wolves.length} check(s) cry wolf (>= ${FLIP_LIMIT} flips): fix what their verdict depends on, never silence them.`); process.exit(1); }
console.log('\n✓ no check flips on unchanged code often enough to be crying wolf');
