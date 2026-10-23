// THE CANARY GATE FAILS CLOSED AND SITS BEFORE THE BASELINE (owner 2026-10-23, step 3 «fail small»).
//
// A rolling release that nobody decides is a release parked at 10% forever, and a gate that promotes
// on a run it did not watch is the 2026-09-03 dark-barrier shape inside the deploy itself. This pins:
//   (a) scripts/canary-gate.sh ABORTS on a non-zero guardian exit AND on a zero exit with no PASS line,
//       and only `complete`s after the run; its two report phrases stay verbatim (the workflow greps them);
//   (b) safe-deploy.sh calls the gate AFTER the smoke test + drift gate and BEFORE record-deploy-baseline,
//       and its alias reads carry the canary pin while a release is in flight;
//   (c) the guardian harness honours CANARY_QUERY on every page it opens;
//   (d) deploy-frontend.yml installs the browser before the deploy step and hands the deploy step
//       EZ_ROLLING_RELEASE, or the gate can never run inside the deploy.
//
//   node --experimental-strip-types scripts/verify-canary-gate-fails-closed.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const gate = read('scripts/canary-gate.sh');
const deploy = read('scripts/safe-deploy.sh');
const harness = read('e2e/guardian/harness.mjs');
const wf = read('.github/workflows/deploy-frontend.yml');

function gateProblems(g: string): string[] {
  const bad: string[] = [];
  if (!/if \[ "\$GATE_RC" -ne 0 \]; then[\s\S]*?abort "/.test(g)) bad.push('a non-zero guardian exit does not abort the release');
  if (!/if ! grep -qE 'PASS' "\$GATE_LOG"; then[\s\S]*?abort "/.test(g)) bad.push('a guardian run with no PASS line does not abort (a run that proved nothing could promote)');
  const completeAt = g.lastIndexOf('rolling-release complete --dpl'); const runAt = g.indexOf('node e2e/guardian/run.mjs');
  if (completeAt < 0 || runAt < 0 || completeAt < runAt) bad.push('`complete` is not after the guardian run');
  if (!/rolling-release abort --dpl "\$DPL" --yes/.test(g)) bad.push('abort does not target the deployment');
  if (!g.includes('CANARY ABORTED — traffic restored to the previous deployment')) bad.push('the ABORTED phrase changed (the workflow Report step greps it)');
  if (!g.includes('CANARY PASSED — promoted to 100%')) bad.push('the PASSED phrase changed (the workflow Report step greps it)');
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
  return bad;
}
let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

check('canary-gate.sh aborts on failure or silence, completes only after the run', gateProblems(gate));
check('safe-deploy.sh: smoke + drift → gate → baseline, alias reads pinned to the canary', deployProblems(deploy));
check('guardian harness opens every page on the canary when asked', harnessProblems(harness));
check('deploy workflow installs the browser and hands the gate its switch', wfProblems(wf));
mustCatch('a gate that completes on a silent run', gateProblems(gate.replace("if ! grep -qE 'PASS' \"$GATE_LOG\"; then", "if false; then")));
mustCatch('a gate that ignores the guardian exit code', gateProblems(gate.replace('if [ "$GATE_RC" -ne 0 ]; then', 'if false; then')));
mustCatch('a baseline advanced before the gate', deployProblems(deploy.replace('scripts/canary-gate.sh "${DEPLOYED_URL:-}"', '# gate removed')));
mustCatch('alias reads that forget the canary pin', deployProblems(deploy.replace(/\$\{CANARY_Q\}/g, '')));
mustCatch('a harness that drops the pin', harnessProblems(harness.replace('${withCanary(path)}', '${path}')));
mustCatch('a workflow that forgets the browser', wfProblems(wf.replace('npx playwright install --with-deps chromium', 'true')));
console.log(failed ? `\n${failed} FAILED` : '\nAll canary-gate assertions passed');
process.exit(failed ? 1 : 0);
