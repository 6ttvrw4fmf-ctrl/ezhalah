// A MERGE MADE BY OUR OWN BOT STARTS NOTHING — SO THE BOT STARTS WHAT THE MERGE WOULD HAVE (2026-11-03).
//
// GitHub never triggers a workflow from an event made with the built-in GITHUB_TOKEN. engineer-automerge.yml merges
// with that token, so a merged PR fires NO `push` workflow on main. Measured 2026-11-03: PR #10140 (the word reader's
// look-alike fix — «بنت» read as Wi-Fi on Gathern apartments) was merged by github-actions[bot] at 11:07:52 UTC and
// facts-words.yml's push trigger — the 8-shard re-read of every ad an older reader read — never ran; no workflow at
// all ran on that merge commit. The fix sat on main and changed nothing a user sees.
//
// This script is called by engineer-automerge.yml right after the sanctioned gate merges a PR. For every FOLLOW-UP
// below whose workflow's OWN `on.push.paths` match a merged file, it dispatches that workflow with the inputs the push
// run would have used (workflow_dispatch IS allowed from the built-in token). The paths are read from the workflow
// file itself, so the two can never drift.
//   node scripts/bot-merge-follow-ups.mjs "<comma-separated merged files>" [--dry-run]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FOLLOW_UPS = [
  // The push run: 8 shards, words only (no model), run id «facts-words-reread-…» — facts-words.yml's own push defaults.
  { workflow: 'facts-words.yml', inputs: { phase: 'incremental', shards: '8', embed: 'false' }, runIdPrefix: 'facts-words-reread' },
];

/** The `on: push: paths:` list of a workflow file (plain block YAML, the shape every workflow here uses). */
export function pushPaths(yml) {
  const lines = String(yml).split('\n');
  const out = [];
  let inOn = false, inPush = false, inPaths = false, pushIndent = -1, pathsIndent = -1;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const t = line.trim();
    if (indent === 0) { inOn = /^(on|"on"|'on'):/.test(t); inPush = inPaths = false; continue; }
    if (!inOn) continue;
    if (inPaths && indent > pathsIndent && t.startsWith('- ')) { out.push(t.slice(2).trim().replace(/^["']|["']$/g, '')); continue; }
    if (inPaths && indent <= pathsIndent) inPaths = false;
    if (inPush && indent <= pushIndent) inPush = false;
    if (/^push:/.test(t)) { inPush = true; pushIndent = indent; continue; }
    if (inPush && /^paths:/.test(t)) { inPaths = true; pathsIndent = indent; }
  }
  return out;
}

/** GitHub path-filter glob → RegExp («**» any depth, «*» one segment). */
export function globRe(glob) {
  const re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${re}$`);
}

/** Which follow-ups a merge of `files` owes. `readWorkflow(name)` returns the workflow's YAML text. */
export function followUpsFor(files, readWorkflow, now = new Date()) {
  const merged = (files ?? []).map((f) => String(f).trim()).filter(Boolean);
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
  return FOLLOW_UPS.flatMap((f) => {
    const paths = pushPaths(readWorkflow(f.workflow)).map(globRe);
    if (!paths.length || !merged.some((m) => paths.some((re) => re.test(m)))) return [];
    return [{ workflow: f.workflow, inputs: { ...f.inputs, run_id: `${f.runIdPrefix}-${stamp}-bot` } }];
  });
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/bot-merge-follow-ups.mjs')) {
  const files = (process.argv[2] ?? '').split(',');
  const dry = process.argv.includes('--dry-run');
  const root = process.cwd();
  const todo = followUpsFor(files, (w) => readFileSync(join(root, '.github/workflows', w), 'utf8'));
  if (!todo.length) { console.log('bot-merge follow-ups: none owed by these files'); process.exit(0); }
  let bad = 0;
  for (const t of todo) {
    const args = ['workflow', 'run', t.workflow, ...Object.entries(t.inputs).flatMap(([k, v]) => ['-f', `${k}=${v}`])];
    console.log(`bot-merge follow-up: gh ${args.join(' ')}`);
    if (dry) continue;
    try { execFileSync('gh', args, { stdio: 'inherit' }); } catch { bad++; console.log(`::error::could not dispatch ${t.workflow} — the merge's follow-up did NOT run`); }
  }
  process.exit(bad ? 1 : 0);
}
