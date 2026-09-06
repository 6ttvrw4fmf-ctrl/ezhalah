// THE POST-DEPLOY AF LIVE CHECK MUST GATE ON "DID A BUNDLE SHIP", NOT ON THE DEPLOY'S CONCLUSION.
//
// ops_incident #75. af-live-truth-check.yml chains off `Deploy frontend (production)` to verify
// Advanced Filter the moment a new bundle is live — its own comment calls that "the run that
// actually matters". Every job was gated on:
//
//     github.event.workflow_run.conclusion == 'success'
//
// and that workflow structurally never concludes success: ops_incident #30 (the baseline recorder
// can neither push to main nor open its PR) and a pre-existing React #418 hydration gate each turn
// a perfectly good deploy red. The condition was never true, so all five AF jobs were SKIPPED on
// every deploy. Runs #186 through #195 were all skipped-and-red. Deploy-time AF coverage was zero
// while the workflow existed, was scheduled, and looked maintained.
//
// This barrier EXECUTES the predicate rather than reading the YAML for a hopeful string, because
// the defect it replaces was itself a condition that looked correct and evaluated false forever.
//
// The fixtures are the real discriminating text from the two real runs of 2026-09-05:
//   shipped  33999823504 — safe-deploy aliased, then went red at a later step
//   refused  33998397629 — REFUSED before deploying (migration drift), nothing shipped
//
// The refused fixture carries the trap: GitHub echoes each step's script into the log, and the
// deploy workflow's Report step contains the literal `grep -qE 'Aliased|^https://ezhalah-...'`.
// So the word "Aliased" IS present in the log of a run that never aliased anything. Measured:
// /Aliased/ matches 1 and 1 — it cannot tell them apart, and would have failed open.

import { readFileSync } from 'node:fs';
import { deployShippedFromLog, shouldRunLiveCheck } from './lib/deployShipped.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
// Each mutation re-implements the predicate WRONG and asserts the wrongness is observable. A
// mutation that cannot fail is not a proof, so every one below is checked against the fixture that
// actually discriminates.
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

// ── fixtures: verbatim shapes from the two real runs ────────────────────────────────────────────
const SHIPPED_LOG = [
  '2026-09-05T23:56:44.1Z Deploying to production...',
  '2026-09-05T23:56:44.9Z https://ezhalah-pikf5tdsy-enzalah.vercel.app',
  '2026-09-05T23:56:45.0Z ▲  Aliased         https://ezhalah-app.vercel.app',
  "2026-09-05T23:57:28.8Z   if grep -qE 'Aliased|^https://ezhalah-[a-z0-9]+-' \"$LOG\"; then SHIPPED=yes; fi",
].join('\n');

// Everything the refused run had, INCLUDING the echoed Report-step script. No alias, no deployment.
const REFUSED_LOG = [
  '2026-09-05T23:20:59.1Z   "missing_in_git": [ "20260905210515" ]',
  '2026-09-05T23:20:59.1Z safe-deploy: REFUSED before deploying — production schema drift. Nothing deployed.',
  "2026-09-05T23:21:42.2Z   if grep -qE 'Aliased|^https://ezhalah-[a-z0-9]+-' \"$LOG\"; then SHIPPED=yes; fi",
  '2026-09-05T23:21:42.2Z     echo "- The new build shipped and `https://ezhalah-app.vercel.app` is serving it."',
].join('\n');

console.log('── the predicate separates the two real runs');
check('a shipped deploy is recognised', deployShippedFromLog(SHIPPED_LOG) === true);
check('a REFUSED deploy is not', deployShippedFromLog(REFUSED_LOG) === false);

// The naive predicate this replaces. Asserting it CANNOT work is the point: it is the version a
// future edit would most plausibly "simplify" back to.
const naive = (log: string) => /Aliased/.test(log);
check('the naive /Aliased/ predicate matches BOTH — which is why it is not used',
      naive(SHIPPED_LOG) && naive(REFUSED_LOG));

console.log('\n── the gate decision, including the direction it fails');
check('workflow_run + shipped ⇒ verify', shouldRunLiveCheck({ eventName: 'workflow_run', log: SHIPPED_LOG }).run === true);
check('workflow_run + refused ⇒ do not verify', shouldRunLiveCheck({ eventName: 'workflow_run', log: REFUSED_LOG }).run === false);
check('schedule ⇒ always verify', shouldRunLiveCheck({ eventName: 'schedule', log: null }).run === true);
check('workflow_dispatch ⇒ always verify', shouldRunLiveCheck({ eventName: 'workflow_dispatch', log: null }).run === true);
// The whole incident is a barrier that went dark and still looked fine. An unreadable log must
// never reproduce that one level down.
check('an UNREADABLE log verifies rather than going dark',
      shouldRunLiveCheck({ eventName: 'workflow_run', log: null }).run === true);

console.log('\n── the workflow is actually wired to it');
const wf = readFileSync(new URL('../.github/workflows/af-live-truth-check.yml', import.meta.url), 'utf8');
// Comment lines are stripped before this assertion. The file DOCUMENTS the old condition on
// purpose — the next reader needs to know what was wrong and why — and a naive substring match
// over the whole file cannot tell an explanation from a directive. (This barrier's own first run
// failed exactly that way, on its own explanatory comment.)
const wfDirectives = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
check('no job is gated on the deploy CONCLUSION any more',
      !wfDirectives.includes("workflow_run.conclusion == 'success'"),
      'that condition is false forever — it is what made this workflow dark');
const gatedJobs = (wf.match(/needs\.gate\.outputs\.shipped == 'yes'/g) ?? []).length;
check('every AF job plus attendance is gated on the shipped output', gatedJobs === 6, `found ${gatedJobs}, expected 6`);
check('the gate job runs the real decision script',
      wf.includes('scripts/af-live-truth-deploy-gate.ts') && wf.includes('shipped: ${{ steps.decide.outputs.shipped }}'));
// A job referencing needs.gate without depending on it silently evaluates to empty and skips —
// which is the original defect wearing new clothes.
const refsWithoutNeed = [...wf.matchAll(/^  ([a-z-]+):\n(?:.*\n)*?    needs: \[([^\]]*)\]\n    if: [^\n]*needs\.gate\./gm)]
  .filter((m) => !m[2].includes('gate')).map((m) => m[1]);
check('no job reads needs.gate without depending on gate', refsWithoutNeed.length === 0, refsWithoutNeed.join(', '));

// EVERY JOB THAT STRIPS TYPES MUST PIN ITS NODE (caught on my own diff, post-merge).
//
// `--experimental-strip-types` needs Node >= 22.6 and the runner's default `node` is not
// guaranteed to be that. Every other job in this workflow pins node-version via setup-node; the
// gate job originally did not, and it is the ONE job whose failure makes all five others skip —
// `shipped` would be empty and the barrier dark again, which is precisely the defect this file
// exists to prevent, reintroduced by its own fix.
//
// Parsed per job rather than grepped over the file, because the question is per-job: a setup-node
// in SOME other job does not help the one that strips types.
const jobBlocks = wf.split(/\n(?=  [a-z][a-z0-9-]*:\n)/);
const stripWithoutPin = jobBlocks
  .filter((b) => b.includes('--experimental-strip-types') && !b.includes('setup-node'))
  .map((b) => b.trim().split(':')[0].trim());
check('every job that strips types pins its Node version', stripWithoutPin.length === 0,
      stripWithoutPin.length ? `unpinned: ${stripWithoutPin.join(', ')}` : 'all pinned');
check('the gate job in particular pins Node',
      /gate:[\s\S]*?setup-node[\s\S]*?af-live-truth-deploy-gate\.ts/.test(wf),
      'its failure would empty `shipped` and skip every live job');

console.log('\n── mutations');
// The version this replaces: /Aliased/ alone. It matches the REFUSED log too, so a run that
// deployed nothing would trigger a full paid live check — and, worse, would report on a bundle
// that never changed.
mustCatch('the naive /Aliased/ predicate is restored',
          naive(REFUSED_LOG) === true);

// An unreadable log treated as "nothing shipped" is #75's own shape one level down: the barrier
// goes quiet exactly when it cannot see.
const darkOnUnreadable = (log: string | null) => (log === null ? false : deployShippedFromLog(log));
mustCatch('an unreadable log is treated as "nothing shipped"',
          darkOnUnreadable(null) !== shouldRunLiveCheck({ eventName: 'workflow_run', log: null }).run);

// Drop the requirement that the alias line names the canonical host.
const looseAlias = (log: string) => /Aliased/.test(log) || /https:\/\/ezhalah-[a-z0-9]{6,}-[a-z0-9-]+\.vercel\.app/.test(log);
mustCatch('the alias line no longer has to name the canonical host',
          looseAlias(REFUSED_LOG) === true && deployShippedFromLog(REFUSED_LOG) === false);

// Let the alias regex span arbitrary text instead of a single run of horizontal whitespace. The
// echoed Report line is `grep -qE 'Aliased|^https://ezhalah-...'` — "Aliased" and "https://" DO
// sit on one line there, so `.*` reaches across the alternation and calls a refused run shipped.
//
// (The first draft of this slot mutated the deployment-URL pattern instead, by dropping its
// `.vercel.app` terminator. That mutant SURVIVED — neither the echoed regex text nor the canonical
// host can satisfy `ezhalah-<seg>-<seg>` however the terminator is relaxed, so it narrowed nothing
// and proved nothing. Replaced rather than kept: a mutation that cannot fail is not a proof.)
const looseAliasSpan = (log: string) => /Aliased.*https:\/\//.test(log);
mustCatch('the alias regex spans arbitrary text instead of whitespace',
          looseAliasSpan(REFUSED_LOG) === true && deployShippedFromLog(REFUSED_LOG) === false);

// A job that reads needs.gate without depending on gate evaluates to empty and skips forever —
// the original defect wearing new clothes. The wiring check must SEE that.
const DANGLING = "  af-x:\n    needs: [af-truth]\n    if: always() && needs.gate.outputs.shipped == 'yes'\n";
const danglingFound = [...DANGLING.matchAll(/^  ([a-z-]+):\n(?:.*\n)*?    needs: \[([^\]]*)\]\n    if: [^\n]*needs\.gate\./gm)]
  .filter((m) => !m[2].includes('gate'));
mustCatch('a job reads needs.gate without depending on it', danglingFound.length === 1);

// A job that strips types with no Node pin — the bug this file's own author shipped and then
// caught by re-reading the diff. The detector must SEE it.
const UNPINNED_JOB = "  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: node --experimental-strip-types scripts/x.ts\n";
const unpinnedSeen = UNPINNED_JOB.split(/\n(?=  [a-z][a-z0-9-]*:\n)/)
  .filter((b) => b.includes('--experimental-strip-types') && !b.includes('setup-node'));
mustCatch('a job strips types without pinning Node', unpinnedSeen.length === 1);

// The revert: gating on the deploy conclusion again.
const REVERTED = "if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'";
mustCatch('the workflow goes back to gating on the deploy conclusion',
          REVERTED.includes("workflow_run.conclusion == 'success'")
            && !wfDirectives.includes("workflow_run.conclusion == 'success'"));

console.log(failures === 0
  ? '\n✓ the AF live check gates on a shipped bundle, and cannot go dark on an unreadable log'
  : `\n✗ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
