// THE CANARY GATE FAILS CLOSED AND SITS BEFORE THE BASELINE (owner 2026-10-23, step 3 «fail small»).
//
// A rolling release that nobody decides is a release parked at 10% forever, and a gate that promotes
// on a run it did not watch is the 2026-09-03 dark-barrier shape inside the deploy itself. This pins:
//   (a) scripts/canary-gate.sh drives STABLE and CANARY, aborts on a run with too few verdicts, and only
//       `complete`s after the runs; its report phrases stay verbatim (the workflow greps them);
//   (b) safe-deploy.sh calls the gate AFTER the smoke test + drift gate and BEFORE record-deploy-baseline,
//       starts the release itself (after an abort Vercel no longer does), and its alias reads carry the
//       canary pin while a release is in flight;
//   (c) the guardian harness honours CANARY_QUERY on every page it opens;
//   (d) deploy-frontend.yml installs the browser before the deploy step, hands the deploy step
//       EZ_ROLLING_RELEASE, and never reports an unconfirmed rollback as a rollback;
//   (e) EXECUTED, against stubbed CLI + guardian (owner standing order 2026-10-24, after three aborts in
//       one morning on one-off harness flakes): a single flake is re-run ONCE on BOTH builds and does not
//       abort; a regression that reproduces does; an UNDETERMINED never passes without that re-run; the
//       abort names the STABLE deployment (naming the canary was refused 400 at 06:26 and 07:56 UTC) and
//       «CANARY ABORTED» is printed only once Vercel's own record reads ABORTED.
//
//   node --experimental-strip-types scripts/verify-canary-gate-fails-closed.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const gate = read('scripts/canary-gate.sh');
const deploy = read('scripts/safe-deploy.sh');
const harness = read('e2e/guardian/harness.mjs');
const wf = read('.github/workflows/deploy-frontend.yml');

function gateProblems(g: string): string[] {
  const bad: string[] = [];
  if (!/if \[ "\$CANARY_N" -lt 8 \] \|\| \[ "\$STABLE_N" -lt 8 \]; then[\s\S]*?abort "/.test(g)) bad.push('a run with too few verdicts does not abort (a run that proved nothing could promote)');
  if (!/if \[ -n "\$REGRESSIONS" \]; then[\s\S]*?abort "/.test(g)) bad.push('a regression against the stable build does not abort');
  if (!/CANARY_QUERY='vcrrForceStable=true' BASE_URL=/.test(g) || !/CANARY_QUERY='vcrrForceCanary=true' BASE_URL=/.test(g)) bad.push('the gate does not drive BOTH the stable build and the canary (a relative verdict needs both)');
  const completeAt = g.lastIndexOf('rolling-release complete --dpl'); const runAt = g.lastIndexOf('node e2e/guardian/run.mjs');
  if (completeAt < 0 || runAt < 0 || completeAt < runAt) bad.push('`complete` is not after the guardian runs');
  if (/rolling-release abort --dpl "\$DPL"/.test(g)) bad.push('abort names the canary: Vercel rolls back TO the deployment named, and refuses a partially-deployed canary (400)');
  // Measured 2026-10-24 04:41 UTC (deploy of #8400): vercel CLI 54.18 rejects `--yes` on rolling-release
  // complete AND abort («unknown or unexpected option: --yes»), so a passing canary could neither promote
  // nor roll back and the release sat at 10% until a person completed it by hand.
  if (/rolling-release (complete|abort|start)[^\n]*--yes/.test(g)) bad.push('`--yes` on a rolling-release command: the CLI rejects it and the release is stranded at 10%');
  if (!g.includes('CANARY ABORTED — traffic restored to the previous deployment')) bad.push('the ABORTED phrase changed (the workflow Report step greps it)');
  if (!g.includes('CANARY PASSED — promoted to 100%')) bad.push('the PASSED phrase changed (the workflow Report step greps it)');
  if (!g.includes('CANARY UNRESOLVED')) bad.push('the UNRESOLVED phrase is gone (an unconfirmed rollback would read as a rollback)');
  if (!/if \[ -z "\$DPL" \]; then[\s\S]*?exit 1/.test(g)) bad.push('a missing deployment URL does not fail');
  return bad;
}
function deployProblems(d: string): string[] {
  const bad: string[] = [];
  const gateAt = d.indexOf('scripts/canary-gate.sh "${DEPLOYED_URL:-}"');
  const baselineAt = d.indexOf('scripts/record-deploy-baseline.sh "$LOCAL"');
  const driftPostAt = d.indexOf('scripts/schema-drift-gate.sh post');
  if (gateAt < 0) bad.push('safe-deploy.sh no longer calls the canary gate');
  else {
    if (!(driftPostAt >= 0 && driftPostAt < gateAt)) bad.push('the gate runs before the post-deploy drift gate');
    if (!(baselineAt > gateAt)) bad.push('the baseline advances before the gate decides');
  }
  if (!/\|\| \{ echo "❌ REFUSING TO ADVANCE THE BASELINE: the canary gate aborted the release\."; exit 1; \}/.test(d)) bad.push('an aborted gate does not refuse the baseline');
  if (!/CANARY_Q="&vcrrForceCanary=true"/.test(d)) bad.push('alias reads are not pinned to the canary during a release');
  if ((d.match(/\$\{CANARY_Q\}/g) ?? []).length < 2) bad.push('fewer than 2 alias reads carry the canary pin');
  // After an abort (an instant rollback) the next production deployment comes up STAGED with no traffic
  // until a release is started — five deploys on 2026-10-24 waited out the alias read and refused.
  const startAt = d.indexOf('rolling-release start --dpl "${DEPLOYED_URL:-}"');
  const rrAt = d.indexOf('if [ "${EZ_ROLLING_RELEASE:-}" = "1" ]; then');
  const pollAt = d.indexOf('Verifying the canonical alias serves the bundle');
  if (startAt < 0 || !(rrAt >= 0 && rrAt < startAt && startAt < pollAt)) bad.push('the release is not started (idempotently) before the alias reads — after an abort the canary never gets traffic');
  return bad;
}
function harnessProblems(h: string): string[] {
  const bad: string[] = [];
  if (!/process\.env\.CANARY_QUERY/.test(h)) bad.push('harness ignores CANARY_QUERY');
  if (!/page\.goto\(`\$\{BASE\}\$\{withCanary\(path\)\}`/.test(h)) bad.push('open() does not route the path through withCanary');
  return bad;
}
function wfProblems(w: string): string[] {
  const bad: string[] = [];
  const installAt = w.indexOf('npx playwright install --with-deps chromium');
  const deployAt = w.indexOf('scripts/safe-deploy.sh 2>&1 | tee');
  if (installAt < 0 || deployAt < 0 || installAt > deployAt) bad.push('the browser is not installed before the deploy step');
  if (!/EZ_ROLLING_RELEASE: \$\{\{ vars\.EZ_ROLLING_RELEASE \}\}/.test(w)) bad.push('the deploy step is not handed EZ_ROLLING_RELEASE');
  if (!/CANARY ABORTED/.test(w)) bad.push('the Report step does not recognise an aborted canary');
  if (!/CANARY UNRESOLVED/.test(w) || !/rollback was not confirmed/.test(w)) bad.push('the Report step can misreport a failed abort as a successful rollback');
  return bad;
}
let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

check('canary-gate.sh aborts on failure or silence, completes only after the run', gateProblems(gate));
check('safe-deploy.sh: smoke + drift → start → gate → baseline, alias reads pinned to the canary', deployProblems(deploy));
check('guardian harness opens every page on the canary when asked', harnessProblems(harness));
check('deploy workflow installs the browser, hands the gate its switch, reports an unconfirmed rollback', wfProblems(wf));
mustCatch('the 2026-10-24 stranded release (--yes on complete)', gateProblems(gate.replace('rolling-release complete --dpl "$DPL"', 'rolling-release complete --dpl "$DPL" --yes')));
mustCatch('a gate that completes on a silent run', gateProblems(gate.replace('if [ "$CANARY_N" -lt 8 ] || [ "$STABLE_N" -lt 8 ]; then', 'if false; then')));
mustCatch('a gate that ignores a regression', gateProblems(gate.replace('if [ -n "$REGRESSIONS" ]; then', 'if false; then')));
mustCatch('a gate that only looks at the canary (absolute, not relative)', gateProblems(gate.replace("CANARY_QUERY='vcrrForceStable=true'", "CANARY_QUERY=''")));
mustCatch('a baseline advanced before the gate', deployProblems(deploy.replace('scripts/canary-gate.sh "${DEPLOYED_URL:-}"', '# gate removed')));
mustCatch('alias reads that forget the canary pin', deployProblems(deploy.replace(/\$\{CANARY_Q\}/g, '')));
mustCatch('a deploy that waits for Vercel to start the release (STAGED after an abort, 2026-10-24)', deployProblems(deploy.replace('rolling-release start --dpl "${DEPLOYED_URL:-}"', 'true')));
mustCatch('a harness that drops the pin', harnessProblems(harness.replace('${withCanary(path)}', '${path}')));
mustCatch('a workflow that forgets the browser', wfProblems(wf.replace('npx playwright install --with-deps chromium', 'true')));
mustCatch('a Report step that calls an unconfirmed rollback a rollback', wfProblems(wf.replace(/CANARY UNRESOLVED/g, 'CANARY ABORTED')));

// ═══ (e) EXECUTED: the real shell, a stubbed CLI and a stubbed guardian ═══════════════════════════════
// The guardian stub prints 8 journeys on one viewport; MODE decides which turn non-PASS and when. The CLI
// stub answers Vercel's rolling-release record from a file and behaves like the API measured on
// 2026-10-24: abort naming the canary → 400; abort naming the stable build → the record reads ABORTED.
const CANARY_URL = 'https://ezhalah-canary-enzalah.vercel.app';
const record = (state: string) => JSON.stringify({ rollingRelease: { state, currentDeployment: { id: 'dpl_stable' }, canaryDeployment: { id: 'dpl_canary', url: 'ezhalah-canary-enzalah.vercel.app' } } });
const STUBS: Record<string, string> = {
  git: 'printf "%s\\n" "$T"\n',
  sleep: 'exit 0\n',
  node: `
if [ "$1" != e2e/guardian/run.mjs ]; then exec "$REAL_NODE" "$@"; fi
side=stable; [[ "$CANARY_QUERY" == *Canary* ]] && side=canary
pass=first; [ -n "\${GUARDIAN_ONLY:-}" ] && pass=rerun
echo "$side $pass \${GUARDIAN_ONLY:-all} \${GUARDIAN_VIEWPORT:-all}" >> "$T/runs.log"
[ "$MODE" = empty ] && exit 1
for j in a b c d e f g h; do
  [ -n "\${GUARDIAN_ONLY:-}" ] && [ "journey-$j" != "$GUARDIAN_ONLY" ] && continue
  [ -n "\${GUARDIAN_VIEWPORT:-}" ] && [ "$GUARDIAN_VIEWPORT" != desktop ] && continue
  v=PASS
  case "$MODE:$side:$pass:$j" in
    flake:canary:first:a) v=UNDETERMINED ;;
    regression:canary:*:a|abort-unverified:canary:*:a) v=FAIL ;;
    und-both:*:first:a|und-both:canary:rerun:a) v=UNDETERMINED ;;
    debt:*:*:a|rerun-debt:*:rerun:a) v=FAIL ;;
    rerun-debt:canary:first:a) v=UNDETERMINED ;;
  esac
  printf '▶ journey-%s [desktop] … %s (1s)\\n' "$j" "$v"
  [ "$v" != PASS ] && printf '    ? stub reason for journey-%s\\n' "$j"
done
exit 0
`,
  npx: `
printf '%s\\n' "$*" >> "$T/cli.log"
case " $* " in *" --yes "*) echo "unknown or unexpected option: --yes" >&2; exit 2 ;; esac
if [ "$1" = vercel ] && [ "$2" = api ]; then cat "$T/rr.json"; exit 0; fi
if [ "$1" = vercel ] && [ "$2" = rolling-release ] && [ "$4" = --dpl ]; then
  case "$3" in
    abort)
      if [ "$5" != dpl_stable ]; then echo "Error: Cannot rollback to deployment $5 as it is a canary deployment that is only partially deployed. (400)" >&2; exit 1; fi
      [ "$MODE" = abort-unverified ] && exit 0
      sed 's/"ACTIVE"/"ABORTED"/' "$T/rr.json" > "$T/rr.tmp" && mv "$T/rr.tmp" "$T/rr.json"; exit 0 ;;
    complete)
      [ "$MODE" = complete-fails ] && exit 1
      sed 's/"ACTIVE"/"COMPLETE"/' "$T/rr.json" > "$T/rr.tmp" && mv "$T/rr.tmp" "$T/rr.json"; exit 0 ;;
  esac
fi
echo "unexpected npx call: $*" >&2; exit 2
`,
};
type Run = { status: number | null; out: string; runs: string; cli: string };
function runGate(src: string, mode: string): Run {
  const T = mkdtempSync(join(tmpdir(), 'ez-canary-gate-'));
  try {
    mkdirSync(join(T, 'bin')); mkdirSync(join(T, '.vercel'));
    for (const [name, body] of Object.entries(STUBS)) writeFileSync(join(T, 'bin', name), '#!/usr/bin/env bash\n' + body, { mode: 0o755 });
    writeFileSync(join(T, '.vercel/project.json'), '{"projectId":"prj_test","orgId":"team_test","projectName":"ezhalah-app"}\n');
    writeFileSync(join(T, 'rr.json'), record('ACTIVE'));
    writeFileSync(join(T, 'gate.sh'), src, { mode: 0o755 });
    const r = spawnSync('bash', [join(T, 'gate.sh'), CANARY_URL], {
      cwd: T, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PATH: `${join(T, 'bin')}:${process.env.PATH}`, EZ_ROLLING_RELEASE: '1', MODE: mode, T, REAL_NODE: process.execPath },
    });
    const f = (n: string) => (existsSync(join(T, n)) ? readFileSync(join(T, n), 'utf8') : '');
    return { status: r.status, out: `${r.stdout}${r.stderr}`, runs: f('runs.log'), cli: f('cli.log') };
  } finally {
    rmSync(T, { recursive: true, force: true });
  }
}
const promoted = (r: Run) => r.status === 0 && r.out.includes('CANARY PASSED — promoted to 100%') && /rolling-release complete --dpl https:\/\/ezhalah-canary/.test(r.cli) && !/rolling-release abort/.test(r.cli);
const abortedToStable = (r: Run) => r.status === 1 && r.out.includes('CANARY ABORTED — traffic restored to the previous deployment')
  && /rolling-release abort --dpl dpl_stable --non-interactive/.test(r.cli) && !r.out.includes('CANARY UNRESOLVED');
const rolledBack = (r: Run) => abortedToStable(r) && !/rolling-release complete/.test(r.cli);
const rerunBoth = (r: Run) => r.runs.includes('stable rerun journey-a desktop') && r.runs.includes('canary rerun journey-a desktop');

/** Each scenario returns its problems; an empty list means the gate behaved. */
const SCENARIOS: Record<string, (r: Run) => string[]> = {
  pass: (r) => (promoted(r) && !r.runs.includes('rerun') ? [] : ['an all-PASS canary was not promoted cleanly']),
  flake: (r) => [
    ...(promoted(r) ? [] : ['a one-off UNDETERMINED on the canary aborted the release (it must be re-run, then promote)']),
    ...(rerunBoth(r) ? [] : ['the suspect was not re-run on BOTH builds']),
  ],
  regression: (r) => [
    ...(rolledBack(r) ? [] : ['a regression that reproduces did not roll back to the STABLE build with Vercel confirming']),
    ...(rerunBoth(r) ? [] : ['the regression was not confirmed by a re-run on both builds']),
  ],
  'und-both': (r) => [
    ...(rolledBack(r) ? [] : ['UNDETERMINED on both builds, then canary-only on the re-run, was not caught (an UNDETERMINED passed silently)']),
    ...(rerunBoth(r) ? [] : ['an UNDETERMINED was not re-run']),
  ],
  debt: (r) => (promoted(r) && !r.runs.includes('rerun') ? [] : ['a journey failing on BOTH builds (production debt) blocked the release']),
  'rerun-debt': (r) => [
    ...(promoted(r) ? [] : ['a suspect that failed on BOTH builds in the re-run (not the canary\'s) blocked the release']),
    ...(rerunBoth(r) ? [] : ['the suspect was not re-run on both builds']),
  ],
  empty: (r) => (rolledBack(r) ? [] : ['a guardian run with no verdicts did not reach the abort path']),
  'abort-unverified': (r) => (r.status === 1 && r.out.includes('CANARY UNRESOLVED') && !r.out.includes('CANARY ABORTED — traffic restored') ? [] : ['a rollback Vercel never confirmed was reported as a rollback']),
  'complete-fails': (r) => (abortedToStable(r) ? [] : ['a failed `complete` did not roll back']),
};
const scenarioProblems = (src: string, only?: string[]) => Object.entries(SCENARIOS)
  .filter(([mode]) => !only || only.includes(mode))
  .flatMap(([mode, judge]) => judge(runGate(src, mode)).map((p) => `[${mode}] ${p}`));

check('EXECUTED: flake re-run once on both builds, reproduced regression aborts, abort names stable and is confirmed', scenarioProblems(gate));
const mut = (label: string, from: string, to: string, modes: string[]) => {
  if (!gate.includes(from)) { failed++; console.log(`FAIL  (mutation) «${label}» — the anchor is gone from canary-gate.sh`); return; }
  mustCatch(label, scenarioProblems(gate.replace(from, to), modes));
};
mut('a gate with no re-run: the first flake aborts (three aborts on 2026-10-24)',
  'pair "$WORK/s.$J.$VP.log" "$WORK/c.$J.$VP.log" "$J" "$VP"', ':', ['flake']);
mut('UNDETERMINED left out of the suspects, so one on both builds passes without a re-run',
  'c[k]=="UNDETERMINED" || ', '', ['und-both']);
mut('the abort naming the canary (refused 400 at 06:26 + 07:56 UTC)',
  'rolling-release abort --dpl "$stable"', 'rolling-release abort --dpl "$DPL"', ['regression']);
mut('«CANARY ABORTED» printed without Vercel confirming it',
  'if [ "$state" = "ABORTED" ] && [ "$canary" = "${DPL#https://}" ]; then', 'if true; then', ['abort-unverified']);
mut('a silent run killing the gate under pipefail before it reaches the abort',
  "verdicts() { { grep -oE '▶ [a-z0-9-]+ \\[[a-z]+\\] … (PASS|FAIL|UNDETERMINED)' \"$1\" || true; }",
  "verdicts() { { grep -oE '▶ [a-z0-9-]+ \\[[a-z]+\\] … (PASS|FAIL|UNDETERMINED)' \"$1\"; }", ['empty']);
mut('a re-run judged on the canary alone (production debt would block every deploy)',
  'elif [ "$S2" = "PASS" ]; then', 'elif true; then', ['rerun-debt']);

console.log(failed ? `\n${failed} FAILED` : '\nAll canary-gate assertions passed');
process.exit(failed ? 1 : 0);
