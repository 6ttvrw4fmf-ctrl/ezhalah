// Every CI step that installs Playwright's browser WITH apt dependencies must be bounded and must have
// a no-apt fallback — or one apt outage silently eats the whole job.
//
// MEASURED 2026-11-11. The runner image's apt mirror could not resolve security.ubuntu.com for most
// of the afternoon. `playwright install --with-deps chromium` did not fail fast: each attempt HUNG
// ~10 minutes before exiting 100. A three-try loop therefore took 30 minutes, which is more than the
// smoke job's 25-minute timeout — run 43044447917 (PR #11874) was cancelled at the deadline before
// the fallback line was ever reached; the REQUIRED smoke on #11873 failed twice; four source
// re-reads and the proofs of two production fixes waited an hour for nothing. The browser itself
// installs fine WITHOUT apt (the Ubuntu runner carries the libraries): runs 43044490740 and
// 43049734560 took that path and completed their browser work.
//
// THE RULE, checked by shape on every workflow file so a workflow written tomorrow is covered:
//   1. every `playwright install … --with-deps …` command is wrapped in `timeout N` with N ≤ 300 s;
//   2. the same `run:` block also installs the browser WITHOUT `--with-deps` (the fallback).
// A workflow that never asks apt for anything (plain `playwright install chromium`) is out of scope.
// One declared exemption: deploy-frontend.yml — the production deploy's smoke must FAIL when the
// browser cannot be installed properly, never fall back; it is reviewed on its own (deploy guard).
//
// Run: node --experimental-strip-types scripts/verify-playwright-install-never-waits-on-apt.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_TIMEOUT_S = 300;
const EXEMPT = new Set(['deploy-frontend.yml']);
const FLOOR = 33; // files holding a --with-deps install on 2026-11-11 — a glob that stops seeing them is RED

const WITH_DEPS = /playwright\s+install\b[^\n]*--with-deps/;
const BOUNDED = /(?:^|[;&|{(]\s*|do\s+)timeout\s+(\d+)\s+(?:npx\s+|python(?:3)?\s+-m\s+)?playwright\s+install\b[^\n]*--with-deps/;
const FALLBACK = /playwright\s+install\b(?![^\n]*--with-deps)[^\n]*(?:^|\s)(chromium|firefox|webkit|\$\{\{[^}]*\}\})/;

/** Comment lines removed, so a rule can never be satisfied by prose. */
const uncommented = (yml: string) => yml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

/** The `run:` blocks of a workflow (block scalar or one-liner), by indentation. */
function runBlocks(yml: string): string[] {
  const lines = uncommented(yml).split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(- )?run:(.*)$/);
    if (!open) continue;
    const indent = open[1].length + (open[2] ? open[2].length : 0);
    const block = [open[3]];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { block.push(l); continue; }
      if ((l.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
      block.push(l);
    }
    out.push(block.join('\n'));
  }
  return out;
}

export function audit(file: string, yml: string): string[] {
  const problems: string[] = [];
  for (const block of runBlocks(yml)) {
    const withDeps = block.split('\n').filter(l => WITH_DEPS.test(l));
    if (withDeps.length === 0) continue;
    for (const l of withDeps) {
      const m = l.match(BOUNDED);
      if (!m) problems.push(`${file}: \`${l.trim().slice(0, 90)}\` has no \`timeout N\` — an apt hang eats the job`);
      else if (Number(m[1]) > MAX_TIMEOUT_S) problems.push(`${file}: timeout ${m[1]} s > ${MAX_TIMEOUT_S} s`);
    }
    if (!FALLBACK.test(block)) problems.push(`${file}: no install WITHOUT --with-deps in the same step (no fallback)`);
  }
  return problems;
}

export function auditAll(files: Map<string, string>): { problems: string[]; covered: number } {
  const problems: string[] = [];
  let covered = 0;
  for (const [file, yml] of files) {
    const base = file.split('/').pop() ?? file;
    if (EXEMPT.has(base)) continue;
    if (WITH_DEPS.test(uncommented(yml))) covered++;
    problems.push(...audit(file, yml));
  }
  return { problems, covered };
}

const dir = '.github/workflows';
const live = new Map<string, string>();
for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).sort()) live.set(join(dir, f), readFileSync(join(dir, f), 'utf8'));

const problems: string[] = [];
const { problems: liveProblems, covered } = auditAll(live);
problems.push(...liveProblems);
if (covered < FLOOR) problems.push(`only ${covered} workflows hold a --with-deps install (floor ${FLOOR}) — discovery broke, not the fleet`);

// ── mutation proofs — reintroduce each historical failure mode ─────────────────────────────────
const mustCatch = (label: string, caught: boolean) => { if (!caught) problems.push(`MUTATION NOT CAUGHT: ${label}`); };
const TARGET = join(dir, 'web-runtime-smoke.yml');
const base = live.get(TARGET);
if (!base || !/timeout 240 npx playwright install --with-deps chromium/.test(base)) {
  problems.push(`${TARGET} no longer carries the bounded install this check mutates — retarget the proofs`);
} else {
  const withTarget = (mutated: string) => { const m = new Map(live); m.set(TARGET, mutated); return auditAll(m).problems.some(p => p.startsWith(TARGET)); };
  mustCatch('the 2026-11-11 shape: the install waits on apt with no timeout',
    withTarget(base.replace(/timeout 240 (npx playwright install --with-deps chromium)/g, '$1')));
  mustCatch('a timeout long enough to still blow the job (900 s)',
    withTarget(base.replace(/timeout 240 npx playwright/g, 'timeout 900 npx playwright')));
  mustCatch('the fallback line deleted — bounded, but the job still fails when apt is down',
    withTarget(base.replace(/\n[^\n]*apt still failing[^\n]*npx playwright install chromium;[^\n]*/, '')));
  mustCatch('a rule satisfied only by a comment line',
    withTarget(base.replace(/timeout 240 (npx playwright install --with-deps chromium)/g, '$1') + '\n# timeout 240 npx playwright install --with-deps chromium\n'));
  const invented = new Map(live);
  invented.set(join(dir, 'invented-by-the-barrier.yml'), 'jobs:\n  j:\n    steps:\n      - run: npx playwright install --with-deps chromium\n');
  mustCatch('a brand-new workflow written tomorrow with the bare install',
    auditAll(invented).problems.some(p => p.includes('invented-by-the-barrier.yml')));
  mustCatch('the floor: a discovery that sees no --with-deps install at all reads RED',
    auditAll(new Map([...live].map(([k, v]) => [k, v.replace(/--with-deps/g, '')]))).covered < FLOOR);
}

if (problems.length) {
  console.error('RED  verify-playwright-install-never-waits-on-apt\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`PASS verify-playwright-install-never-waits-on-apt — ${covered} workflows install the browser with apt deps; every one is bounded (≤ ${MAX_TIMEOUT_S} s per try) and falls back to a no-apt install. 6 mutations caught.`);
