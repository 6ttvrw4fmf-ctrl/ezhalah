// LIVE HALF — is what `main` says the app is, what a real user is being served right now?
//
// Pair: scripts/verify-undeployed-user-visible-drift.ts stays in the REQUIRED `npm test` and
// mutation-proves the decision; this half supplies the READINGS and applies the SAME function
// (scripts/lib/undeployedDrift.ts), never a second copy of the rule. It is out of `npm test` for the
// reason AGENTS.md gives for verify-migration-drift-vs-production.ts: drift that genuinely exists in
// production would otherwise fail every unrelated PR in the repo.
//
// THE THREE READINGS, each taken independently:
//   · what production SERVES  — the Expo entry bundle in the live HTML of https://ezhalah-app.vercel.app.
//                               This is the LIVENESS leg: unreachable ⇒ RED, never «no drift».
//   · what production is RECORDED to serve — docs/DEPLOY_BASELINE.txt, written by the deploy pipeline
//                               itself (scripts/record-deploy-baseline.sh), never by hand to clear a check.
//   · what `main` IS          — this checkout's HEAD, and the baseline..HEAD file list from git.
//
// WHAT IT PROVES, AND WHAT IT DOES NOT — stated because PART 7 forbids reporting a rule this run
// could not reach as one it proved. It proves that the commit production is RECORDED to serve has no
// user-visible diff against the head under test, and that production is up and serving a real bundle.
// It does NOT independently re-derive the served commit from the bundle bytes: a bundle hash is not
// reversible to a sha without a build. So a baseline recorded LATE reads as drift that has in fact
// shipped. That direction is deliberate and is the safe one — the remedy it demands (record the
// baseline) is the deploy pipeline's own obligation, and ops_incident #30 records that half failing
// silently before. The unsafe direction — a baseline advanced AHEAD of a deploy to quiet a check —
// is forbidden in writing here and in docs/DEPLOY_BASELINE.txt's own header.
//
// REQUIRES a full checkout (`fetch-depth: 0`). A shallow one cannot answer the ancestry or the diff,
// and an unanswered question is reported as a FAILURE by the shared predicate, not as a pass.
//
//   node --experimental-strip-types scripts/verify-undeployed-user-visible-drift-live.ts
//   (homed in .github/workflows/frontend-bundle-source-parity-live-check.yml — see scripts/test-exclusions.txt)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { undeployedDriftProblems, USER_VISIBLE_ROOTS, type DriftReading } from './lib/undeployedDrift.ts';

const ROOT = join(import.meta.dirname, '..');
const SITE = process.env.EZHALAH_SITE_URL || 'https://ezhalah-app.vercel.app';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nIs main being served? — merged-but-never-served, measured live\n');

/** git, or null when the question cannot be answered. NEVER a fallback value that looks like an answer. */
const git = (...args: string[]): string | null => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return null; }
};

// ── READING 1: the commit production is RECORDED to serve. ──────────────────────────────────────
const BASELINE_FILE = join(ROOT, 'docs', 'DEPLOY_BASELINE.txt');
const baselineSha = existsSync(BASELINE_FILE)
  ? (readFileSync(BASELINE_FILE, 'utf8').split('\n')[0] ?? '').trim() || null
  : null;

// ── READING 2: what `main` IS, in this checkout. ────────────────────────────────────────────────
const headSha = git('rev-parse', 'HEAD');

let baselineIsAncestorOfHead: boolean | null = null;
if (baselineSha && headSha) {
  // `merge-base --is-ancestor` exits 0 for yes and 1 for no — but it ALSO exits non-zero when the
  // object is simply absent (a shallow clone), and those two must not collapse into "no". Ask
  // whether the object is present FIRST; only then is a non-zero exit a real "not an ancestor".
  const present = git('cat-file', '-e', `${baselineSha}^{commit}`) !== null;
  if (present) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', baselineSha, headSha], { cwd: ROOT });
      baselineIsAncestorOfHead = true;
    } catch { baselineIsAncestorOfHead = false; }
  }
}

const changedPaths = (baselineSha && headSha && baselineIsAncestorOfHead === true)
  ? (git('diff', '--name-only', `${baselineSha}..${headSha}`)?.split('\n').filter(Boolean) ?? null)
  : null;

const commitLine = (baselineSha && headSha && baselineIsAncestorOfHead === true)
  ? (git('log', '--format=%h %s', `${baselineSha}..${headSha}`, '--', ...USER_VISIBLE_ROOTS)
      ?.split('\n').filter(Boolean) ?? [])
  : [];

// ── READING 3: what production ACTUALLY SERVES. Fail-closed on every failure mode. ──────────────
let liveEntryBundle: string | null = null;
try {
  const res = await fetch(SITE, { signal: AbortSignal.timeout(30_000) });
  // A non-200 is NOT a page. Never let an error body stand in for the app's HTML.
  const html = res.ok ? await res.text().catch(() => '') : '';
  const m = html.match(/_expo\/static\/js\/web\/entry-[A-Za-z0-9._-]+\.js/);
  // Hand the predicate what we SAW: the bundle path when there is one, a snippet of whatever was
  // served when there is not, and null when nothing could be read at all. The three are different
  // facts and the shared, mutation-proven rule decides what each one means.
  liveEntryBundle = m ? m[0] : (res.ok && html ? html.slice(0, 120) : null);
  console.log(`  live: HTTP ${res.status}, ${html.length} bytes, bundle ${m ? m[0] : '(none found)'}`);
} catch (e) {
  console.log(`  live: unreachable — ${String(e).slice(0, 160)}`);
}

const reading: DriftReading = {
  baselineSha, headSha, baselineIsAncestorOfHead, changedPaths, commitLine, liveEntryBundle,
};
console.log(`  recorded as live: ${baselineSha ?? '(unreadable)'}`);
console.log(`  head under test : ${headSha ?? '(unreadable)'}`);
console.log(`  files changed   : ${changedPaths === null ? '(undeterminable)' : changedPaths.length}\n`);

const problems = undeployedDriftProblems(reading);
check('everything user-visible on the head under test is being served to real users',
  problems.length === 0, problems.join('\n      '));

console.log(failures === 0
  ? '\n✓ production is serving the head under test — nothing user-visible is merged and unshipped\n'
  : `\n✗ ${failures} check(s) FAILED — see the remedy in the message above\n`);
process.exit(failures === 0 ? 0 : 1);
