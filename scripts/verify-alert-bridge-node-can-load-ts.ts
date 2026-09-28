// A job that runs the alert bridge must run a Node that can load it.
//
// WHY THIS EXISTS (2026-09-28, Scraping Engineer). scripts/ops/raise-workflow-alert.mjs imports
// scripts/lib/postgrestRetry.ts and relies on Node stripping types by default (22.18+). Its own
// comment says "all 32 bridge invocations run on Node 24" — but muktamel-sharded.yml pinned its
// bridge job to `node-version: "20"`, so on run 36292308178 (2026-09-27) the bridge died with
// ERR_UNKNOWN_FILE_EXTENSION ".ts": the crawl's 8 shards were green, the workflow went red, and the
// run's result never reached alert_event — the bridge exists precisely so a failure is not silent.
//
// Rule: in every job whose steps invoke raise-workflow-alert.mjs, any setup-node pin must be a
// major >= 22 (22.18+ when the minor is given). No pin means the runner default, which is Node 24.
//
//   node --experimental-strip-types scripts/verify-alert-bridge-node-can-load-ts.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';
const BRIDGE = 'raise-workflow-alert.mjs';

/** Split a workflow's `jobs:` block into { jobName: text } by 2-space job keys. */
export function jobsOf(yml: string): Record<string, string> {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return {};
  const out: Record<string, string> = {};
  let cur: string | null = null;
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break; // next top-level key
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { cur = m[1]; out[cur] = ''; continue; }
    if (cur) out[cur] += l + '\n';
  }
  return out;
}

/** A node-version pin that cannot strip types, or null if the pin is fine. */
export function badNodePin(jobText: string): string | null {
  for (const m of jobText.matchAll(/node-version:\s*["']?([^"'\s#]+)/g)) {
    const [maj, min] = m[1].replace(/^v/, '').split('.').map((x) => parseInt(x, 10));
    if (!Number.isFinite(maj)) return m[1]; // lts/*, a matrix expression — cannot prove it
    if (maj < 22 || (maj === 22 && Number.isFinite(min) && min < 18)) return m[1];
  }
  return null;
}

export function problems(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [f, yml] of Object.entries(files)) {
    for (const [job, text] of Object.entries(jobsOf(yml))) {
      if (!text.includes(BRIDGE)) continue;
      const bad = badNodePin(text);
      if (bad) out.push(`${f} job '${job}' runs ${BRIDGE} on node-version ${bad} (needs >= 22.18 to load .ts)`);
    }
  }
  return out;
}

// ── Mutation proof: the predicate must catch the exact shape that broke muktamel ──────────────────
const job = (pin: string) => `jobs:\n  bridge:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${pin}\n      - run: node scripts/ops/${BRIDGE}\n`;
const selfTest: [string, string, boolean][] = [
  ['node 20 (the 2026-09-27 break)', job('"20"'), true],
  ['node 22.4', job('"22.4"'), true],
  ['lts/* (unprovable)', job('lts/*'), true],
  ['node 24', job('"24"'), false],
  ['node 22.18', job('22.18'), false],
  ['no pin (runner default)', `jobs:\n  bridge:\n    steps:\n      - run: node scripts/ops/${BRIDGE}\n`, false],
  ['node 20 in a job WITHOUT the bridge', `jobs:\n  crawl:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: "20"\n  bridge:\n    steps:\n      - run: node scripts/ops/${BRIDGE}\n`, false],
];
let failed = false;
for (const [label, yml, shouldFlag] of selfTest) {
  const flagged = problems({ 'self.yml': yml }).length > 0;
  if (flagged !== shouldFlag) { console.error(`✗ self-test: ${label} — flagged=${flagged}, expected ${shouldFlag}`); failed = true; }
}

const files: Record<string, string> = {};
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml'))) {
  files[f] = readFileSync(join(DIR, f), 'utf8');
}
const bridged = Object.values(files).filter((y) => y.includes(BRIDGE)).length;
const real = problems(files);
for (const p of real) console.error(`✗ ${p}`);
if (bridged === 0) { console.error(`✗ no workflow invokes ${BRIDGE} — the scan is looking in the wrong place`); failed = true; }

if (failed || real.length) process.exit(1);
console.log(`✓ alert bridge: ${bridged} workflows invoke ${BRIDGE}, none pins a Node that cannot load .ts (${selfTest.length} self-tests)`);
