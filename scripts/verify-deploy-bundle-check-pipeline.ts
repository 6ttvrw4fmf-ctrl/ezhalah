// Permanent regression barrier for the post-deploy bundle gate's SHELL PLUMBING (issue #1563).
//
// THE DEFECT, exactly. scripts/safe-deploy.sh runs under `set -euo pipefail`. Its post-deploy check
// asked "does the bundle the canonical alias serves reference supabase.co?" with:
//
//     curl -s "<bundle url>" | grep -q "supabase.co"
//
// `grep -q` exits 0 at the FIRST match and closes the pipe. The production bundle is ~6.8MB and the
// first `supabase.co` sits ~2.9MB in, so curl still had ~3.9MB to write, died with 56 (recv error),
// and `pipefail` returned 56 for the whole pipeline. Measured against the live bundle:
//
//     PIPESTATUS = 56 0      # curl FAILED, grep MATCHED
//
// So the gate condition was false precisely BECAUSE the assertion was true. PR #1545 had just made
// this check BLOCKING, so 11 consecutive `Deploy frontend (production)` runs that genuinely shipped
// (alias moved, `▲ Aliased`, hydration gate green 5/5) were reported `failure`. The second-order
// cost was the real one: .github/workflows/af-live-truth-check.yml chains its post-deploy AF
// journeys on `workflow_run` with `conclusion == 'success'`, so every one of those deploys silently
// skipped its only post-deploy journey verification.
//
// WHAT THIS BARRIER PINS, in two independent layers:
//   A. BEHAVIOURAL (the mutation proof). It actually runs both shapes under `set -o pipefail` over a
//      large body whose match is near the front, and asserts the OLD shape reports failure-on-success
//      (producer non-zero, grep zero) while the FIXED shape reports 0. If a future shell/coreutils
//      made this defect impossible, layer A fails loudly rather than passing vacuously.
//   B. STRUCTURAL. scripts/*.sh may not reintroduce a `curl … | grep -q` gate pipeline, the
//      supabase.co assertion must still exist reading a FILE, must still be BLOCKING (`exit 1`), and
//      `pipefail` must still be set — because removing pipefail would "fix" this by weakening every
//      other pipeline in the deploy path.
//
// Layer B reads the script with FULL-LINE `#` comments stripped, so the prose above this fix (and in
// safe-deploy.sh, which necessarily quotes the broken pipeline to explain it) can never satisfy or
// trip an assertion — a comment is not a code path. Trailing comments are deliberately NOT stripped:
// safe-deploy.sh has `#` inside quoted strings (e.g. "PR #78", "# $(date +%F)") and naive trailing
// stripping would corrupt real code lines.
//
// No network, no DB, fully deterministic — runs in `npm test`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = process.cwd();
const SAFE_DEPLOY = path.join(ROOT, 'scripts', 'safe-deploy.sh');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

console.log('verify-deploy-bundle-check-pipeline: post-deploy bundle gate plumbing (#1563)');

// ── Layer A: behavioural mutation proof ───────────────────────────────────────────────────────────
// A body large enough that the producer cannot finish writing before `grep -q` exits: the pipe
// buffer is 64KB, this is 4MB, and the match is in the first line.
const dir = mkdtempSync(path.join(tmpdir(), 'bundlecheck-'));
const body = path.join(dir, 'bundle.js');
writeFileSync(body, `supabase.co\n${'x'.repeat(4 * 1024 * 1024)}`);

// `cat` stands in for `curl`: a producer that keeps writing after grep has seen enough.
const shell = (snippet: string) =>
  spawnSync('bash', ['-c', `set -euo pipefail\n${snippet}`], { encoding: 'utf8' });

// PIPESTATUS must be captured by the very next command — any other command overwrites it.
const broken = shell(
  `set +e\ncat "${body}" | grep -q "supabase.co"\nps=("\${PIPESTATUS[@]}")\necho "pipe=\${ps[*]}"`,
);
const brokenOut = broken.stdout || '';
const pipeStatus = /pipe=(\d+) (\d+)/.exec(brokenOut);
check(
  'MUTATION PROOF: the OLD `producer | grep -q` shape reports FAILURE while the pattern MATCHES',
  pipeStatus !== null && pipeStatus[1] !== '0' && pipeStatus[2] === '0',
  `expected producer!=0 and grep==0, got ${brokenOut.trim().replace(/\n/g, ' ')}`,
);

// The same defect as the deploy script actually experiences it: as an `if` condition under pipefail.
const brokenGate = shell(
  `if cat "${body}" | grep -q "supabase.co"; then echo GATE_PASS; else echo GATE_FAIL; fi`,
);
check(
  'MUTATION PROOF: as an `if` condition under pipefail, the OLD shape FAILS the gate on a good bundle',
  (brokenGate.stdout || '').includes('GATE_FAIL'),
  `got ${(brokenGate.stdout || '').trim()}`,
);

// The shipped shape: fetch to a file, grep the file. No pipe, so no SIGPIPE, so the exit status is
// the assertion's answer rather than the plumbing's.
const fixedGate = shell(
  `if grep -q "supabase.co" "${body}"; then echo GATE_PASS; else echo GATE_FAIL; fi`,
);
check(
  'FIXED shape passes the gate on the same good bundle',
  (fixedGate.stdout || '').includes('GATE_PASS'),
  `got ${(fixedGate.stdout || '').trim()}`,
);

// ...and still FAILS on a bundle that genuinely lacks supabase.co. The fix must not have turned the
// assertion into one that cannot fail — that would be the 2026-07-10 P0 going undetected.
const badBody = path.join(dir, 'bad.js');
writeFileSync(badBody, `no config inlined here\n${'x'.repeat(4 * 1024 * 1024)}`);
const fixedNegative = shell(
  `if grep -q "supabase.co" "${badBody}"; then echo GATE_PASS; else echo GATE_FAIL; fi`,
);
check(
  'FIXED shape still REFUSES a bundle with no supabase.co (assertion not weakened)',
  (fixedNegative.stdout || '').includes('GATE_FAIL'),
  `got ${(fixedNegative.stdout || '').trim()}`,
);

// ...and refuses an empty/failed fetch, which is what a 000/40x bundle read leaves behind.
const emptyBody = path.join(dir, 'empty.js');
writeFileSync(emptyBody, '');
const fixedEmpty = shell(
  `if grep -q "supabase.co" "${emptyBody}"; then echo GATE_PASS; else echo GATE_FAIL; fi`,
);
check(
  'FIXED shape still REFUSES an empty bundle read',
  (fixedEmpty.stdout || '').includes('GATE_FAIL'),
  `got ${(fixedEmpty.stdout || '').trim()}`,
);

rmSync(dir, { recursive: true, force: true });

// ── Layer B: the real scripts may not carry the defect shape ──────────────────────────────────────
const stripComments = (src: string) =>
  src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

// A `curl … | grep -q` gate pipeline, anywhere in the deploy scripts. This is the CLASS, not just
// the one line: any sibling script reintroducing it has the same inverted-truth failure.
const GATE_PIPELINE = /curl[^|\n]*\|\s*grep\s+-q/;
const shellScripts = readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.sh'));
const offenders = shellScripts.filter((f) => {
  const src = readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  return /set\s+-[a-z]*o\s+pipefail|set\s+-euo\s+pipefail/.test(src) && GATE_PIPELINE.test(stripComments(src));
});
check(
  'no scripts/*.sh under pipefail pipes curl into `grep -q` (the #1563 defect class)',
  offenders.length === 0,
  `offenders: ${offenders.join(', ')}`,
);

const code = stripComments(readFileSync(SAFE_DEPLOY, 'utf8'));

check(
  'safe-deploy.sh still runs under pipefail (the fix must not weaken it into working by accident)',
  /set\s+-euo\s+pipefail/.test(code),
);
check(
  'safe-deploy.sh still asserts the served bundle references supabase.co, reading a FILE',
  /grep\s+-q\s+"supabase\.co"\s+"\$BUNDLE_BODY"/.test(code),
);
check(
  'the bundle body is fetched with curl -o into that same file',
  /curl[^\n]*-o\s+"\$BUNDLE_BODY"/.test(code),
);
// Cost guard: the 6.8MB bundle must only be fetched once the alias has already matched, not on
// every one of the ~60 poll iterations.
check(
  'the bundle fetch stays behind the MATCHED short-circuit',
  /if\s+\[\s+"\$MATCHED"\s+=\s+1\s+\][^\n]*\n[^\n]*curl[^\n]*-o\s+"\$BUNDLE_BODY"/.test(code),
);
check(
  'the post-deploy bundle gate is still BLOCKING (refuses and exits 1)',
  /REFUSING TO ADVANCE THE BASELINE: the canonical alias never proved/.test(code) &&
    /exit 1/.test(code.slice(code.indexOf('REFUSING TO ADVANCE THE BASELINE: the canonical alias never proved'))),
);
// The PROPERTY, not one spelling of it: an empty or truncated read must never be reported the same
// way as an authentic bundle that genuinely lacks supabase.co (the 2026-07-10 P0 signature). Two
// independent implementations satisfy this and both are correct — printing the read's HTTP status
// and byte count, or splitting the failure into an authenticity failure and a content failure. This
// barrier was originally written against the first spelling and rejected the second, which is a
// barrier asserting an author rather than a behaviour. Accept either; require one.
const distinguishesReadFromMiss =
  (/last bundle read:/.test(code) && /BUNDLE_HTTP/.test(code) && /BUNDLE_BYTES/.test(code))
  || (/AUTH_FAIL/.test(code) && /SUPA_FAIL/.test(code));
check(
  'the failure block distinguishes a failed/truncated read from a bundle that genuinely lacks supabase.co',
  distinguishesReadFromMiss,
  'a deploy that could not READ the bundle would be reported identically to one whose env vars never inlined',
);
check(
  'the temp bundle body is cleaned up',
  /rm -f[^\n]*"\$BUNDLE_BODY"/.test(code),
);

// ── Wiring: ask the registry, never string-match package.json (AGENTS.md) ─────────────────────────
check(
  'this barrier is discovered and run by `npm test`',
  npmTestRuns(ROOT, 'verify-deploy-bundle-check-pipeline'),
);

if (failures > 0) {
  console.error(`\n❌ verify-deploy-bundle-check-pipeline: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('✅ verify-deploy-bundle-check-pipeline: post-deploy bundle gate reports the truth.');
