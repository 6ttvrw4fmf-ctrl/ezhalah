// Permanent regression test for scripts/deploy-report.sh — the Report step's SHIPPED / REFUSED_PRE
// / POST_FAILED / DEPLOY_URL verdict (deploy-frontend.yml).
//
// Closes a false-alarm investigation from 2026-09-12: SHIPPED was suspected to read "no" even on
// runs where `▲ Aliased ...` printed a few dozen lines earlier in the SAME step's raw log (run
// 34724048886). The parsing traced out CORRECT (see scripts/deploy-report.sh's header for the full
// story and why the mechanism could not have lost that line) — but nothing EXECUTED it, so there
// was no way to prove that, or to catch a real future regression, from source-reading alone. This
// test sources the REAL scripts/deploy-report.sh (never a copy of it — extraction fails loudly if
// the function is renamed) against synthetic fixtures AND two real historical run excerpts
// (34724048886, 34707723517), including a negative control so a fixture that stopped discriminating
// would be caught rather than trusted.
//
// Runs in `npm test`. No network, no DB, fully deterministic.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = process.cwd();
const LIB = path.join(REPO, 'scripts', 'deploy-report.sh');

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}`);
  if (!cond) failures++;
};

type Verdict = { SHIPPED: string; REFUSED_PRE: string; POST_FAILED: string; DEPLOY_URL: string };

// Write `content` to a temp log file, source the REAL library (or, for the mutation proofs below,
// a deliberately-broken temp COPY of it — never the other way around: real code is always checked
// against the real file), call the function against it, and return the four flags it set.
const tmpDirs: string[] = [];
const verdictFor = (content: string | null, libPath: string = LIB): Verdict => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deploy-report-'));
  tmpDirs.push(dir);
  const log = path.join(dir, 'safe-deploy.log');
  if (content !== null) writeFileSync(log, content);
  const missingLog = path.join(dir, 'does-not-exist.log');
  const r = spawnSync('bash', ['-c',
    `set -euo pipefail
. "${libPath}"
deploy_report_verdict "${content !== null ? log : missingLog}"
printf 'SHIPPED=%s\\nREFUSED_PRE=%s\\nPOST_FAILED=%s\\nDEPLOY_URL=%s\\n' "$SHIPPED" "$REFUSED_PRE" "$POST_FAILED" "$DEPLOY_URL"`],
    { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`  (bash exited ${r.status}: ${r.stderr})`);
    return { SHIPPED: '<crash>', REFUSED_PRE: '<crash>', POST_FAILED: '<crash>', DEPLOY_URL: '<crash>' };
  }
  const out = r.stdout || '';
  const get = (k: string) => (out.match(new RegExp(`^${k}=(.*)$`, 'm')) || ['', ''])[1];
  return { SHIPPED: get('SHIPPED'), REFUSED_PRE: get('REFUSED_PRE'), POST_FAILED: get('POST_FAILED'), DEPLOY_URL: get('DEPLOY_URL') };
};

console.log('deploy-report: Report-step verdict regression test');

// ── (1) THE EXPLICIT ASK: a synthetic log with an Aliased line → SHIPPED=yes ────────────────
check('synthetic log containing "▲ Aliased ..." → SHIPPED=yes',
  verdictFor('▲ Aliased         https://ezhalah-app.vercel.app\n').SHIPPED === 'yes');

// ── (2) Negative control: the fixture must actually discriminate, not just always pass ──────
check('a log with NEITHER Aliased NOR a preview URL → SHIPPED=no (fixture is discriminating)',
  verdictFor('Building...\nOK: some unrelated line\n').SHIPPED === 'no');

// ── (3) The URL-shaped alternative also counts as shipped ───────────────────────────────────
check('a bare preview-URL line (no "Aliased" text) → SHIPPED=yes',
  verdictFor('https://ezhalah-qomxzygu7-enzalah.vercel.app\n').SHIPPED === 'yes');

// ── (4) REFUSED_PRE ───────────────────────────────────────────────────────────────────────
check('"REFUSING TO DEPLOY" → REFUSED_PRE=yes, SHIPPED stays no',
  (() => { const v = verdictFor('safe-deploy: REFUSING TO DEPLOY — dirty tree.\n'); return v.REFUSED_PRE === 'yes' && v.SHIPPED === 'no'; })());

// ── (5) Missing log file → every flag defaults, nothing throws under `set -e` ────────────────
check('missing log file → SHIPPED=no, REFUSED_PRE=no, POST_FAILED=no, DEPLOY_URL empty',
  (() => { const v = verdictFor(null); return v.SHIPPED === 'no' && v.REFUSED_PRE === 'no' && v.POST_FAILED === 'no' && v.DEPLOY_URL === ''; })());

// ── (6) DEPLOY_URL extraction picks the LAST matching preview URL ───────────────────────────
check('DEPLOY_URL extracts the ezhalah preview URL (tail -1 of matches)',
  verdictFor('  Production      https://ezhalah-qomxzygu7-enzalah.vercel.app\n').DEPLOY_URL
    === 'https://ezhalah-qomxzygu7-enzalah.vercel.app');

// ── (7) REAL HISTORICAL RUN — 34724048886 (the run named in the original investigation) ─────
// Verbatim message text from that run's "Deploy via the sanctioned guarded entrypoint" step,
// captured via `gh run view 34724048886 --log` (job/step/timestamp columns stripped — the real
// /tmp/safe-deploy.log file never carries those; they are gh's own per-line display prefix).
const RUN_34724048886_EXCERPT = [
  '▲ Aliased         https://ezhalah-app.vercel.app',
  '',
  '✓ Ready in 3m',
  '',
  'Verifying the canonical alias serves the bundle this run emitted (_expo/static/js/web/entry-3b5976ea811a41697b7486b9d450bbd1.js), polling up to 5m...',
  'OK: https://ezhalah-app.vercel.app serves _expo/static/js/web/entry-3b5976ea811a41697b7486b9d450bbd1.js — the entry this run emitted; md5(bytes) matches its filename, and it references supabase.co.',
].join('\n') + '\n';
check('REAL run 34724048886 excerpt (clean success) → SHIPPED=yes, POST_FAILED=no',
  (() => { const v = verdictFor(RUN_34724048886_EXCERPT); return v.SHIPPED === 'yes' && v.POST_FAILED === 'no'; })());

// ── (8) REAL HISTORICAL RUN — 34707723517 (genuine "shipped, then a post-deploy check failed") ──
// Verbatim message text from that run: the deploy DID alias, and the baseline-advance push was
// THEN refused (branch protection) with no BASELINE_PR_TOKEN configured, and a PR for that branch
// already existed — the exact "DEPLOY SUCCEEDED — POST-DEPLOY VERIFICATION FAILED" scenario the
// Report step's branching exists to catch. Overall job conclusion for this run was "failure".
const RUN_34707723517_EXCERPT = [
  '▲ Aliased         https://ezhalah-app.vercel.app',
  '',
  '✓ Ready in 3m',
  '',
  'Verifying the canonical alias serves the bundle this run emitted (_expo/static/js/web/entry-15df906bbae22d08733e6e1f4f4e4e8c.js), polling up to 5m...',
  'OK: https://ezhalah-app.vercel.app serves _expo/static/js/web/entry-15df906bbae22d08733e6e1f4f4e4e8c.js — the entry this run emitted; md5(bytes) matches its filename, and it references supabase.co.',
  '',
  'Recording c9ce60eef53fee4cc4ca6238ea516cb58c68b059 as the new approved production baseline...',
  'remote: error: GH006: Protected branch update failed for refs/heads/main.',
  'Direct push to main refused (branch protection, or main moved) — recording it as a PR instead.',
  '   gh pr create failed: a pull request for branch "deploy/baseline-c9ce60e" into branch "main" already exists:',
  'https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/2395',
  '❌ REFUSING TO ADVANCE THE BASELINE: it could be neither pushed to main nor opened as a PR.',
].join('\n') + '\n';
check('REAL run 34707723517 excerpt (shipped, baseline-advance refused) → SHIPPED=yes AND POST_FAILED=yes',
  (() => { const v = verdictFor(RUN_34707723517_EXCERPT); return v.SHIPPED === 'yes' && v.POST_FAILED === 'yes'; })());

// ── (9) Drift guard: the workflow sources this file's function — never a re-inlined copy ────
const workflow = readFileSync(path.join(REPO, '.github', 'workflows', 'deploy-frontend.yml'), 'utf8');
check('deploy-frontend.yml sources scripts/deploy-report.sh in the Report step',
  /\.\s+scripts\/deploy-report\.sh/.test(workflow));
check('deploy-frontend.yml calls deploy_report_verdict (not a re-inlined grep block)',
  /deploy_report_verdict\s+\/tmp\/safe-deploy\.log/.test(workflow));
check('deploy-frontend.yml no longer re-inlines the four evidence greps directly',
  !/if grep -qE 'Aliased\|\^https:\/\/ezhalah-\[a-z0-9\]\+-' "\$LOG"/.test(workflow));
check('the Report step prints the computed verdict to its own log (not just $GITHUB_STEP_SUMMARY)',
  /echo "Computed verdict: SHIPPED=\$SHIPPED/.test(workflow));

// ── (10) MUTATION PROOFS — the checks above must be able to fail, not just pass on real code ────
// Each proof writes a deliberately-broken TEMP COPY of the real library (never touches the real
// file) and re-runs the exact same verdictFor() helper against it, proving the assertions above
// actually discriminate correct from incorrect implementations rather than passing vacuously.
const mustCatch = (label: string, caught: boolean) => check(`MUTATION ${label}`, caught);
const realLib = readFileSync(LIB, 'utf8');
const mutantLib = (broken: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deploy-report-mutant-'));
  tmpDirs.push(dir);
  const p = path.join(dir, 'deploy-report.sh');
  writeFileSync(p, broken);
  return p;
};

// Mutant A: the SHIPPED-determining grep is neutralized (the exact false-negative this whole
// investigation was about) — must be caught even with a real "Aliased" line in the log.
const noShippedCheck = realLib.replace(
  /if grep -qE 'Aliased\|\^https:\/\/ezhalah-\[a-z0-9\]\+-' "\$log"; then SHIPPED=yes; fi/,
  'SHIPPED=no # MUTANT: log-read removed',
);
check('sanity: mutant A actually changed the source (regex still matches the real file)',
  noShippedCheck !== realLib);
mustCatch('SHIPPED hardcoded to "no" is caught even with a real Aliased line present',
  verdictFor(RUN_34724048886_EXCERPT, mutantLib(noShippedCheck)).SHIPPED !== 'yes');

// Mutant B: the `|| true` guard on DEPLOY_URL is removed (the latent bug this PR fixed) — must be
// caught by the exact scenario that exposed it: a log with no preview-URL match (a real pre-deploy
// refusal never prints one), sourced under verdictFor's own `set -euo pipefail`.
const noTrueGuard = realLib.replace(
  `'https://ezhalah-[a-z0-9]+-[a-z0-9-]+\\.vercel\\.app' "$log" | tail -1 || true)"`,
  `'https://ezhalah-[a-z0-9]+-[a-z0-9-]+\\.vercel\\.app' "$log" | tail -1)"`,
);
check('sanity: mutant B actually changed the source (|| true was really removed)',
  noTrueGuard !== realLib);
mustCatch('removing the || true guard crashes the whole function on a log with no preview URL',
  verdictFor('safe-deploy: REFUSING TO DEPLOY — dirty tree.\n', mutantLib(noTrueGuard)).SHIPPED === '<crash>');

for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }

if (failures > 0) {
  console.error(`\n❌ deploy-report: ${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log(`\n✅ deploy-report: all checks passed.`);
