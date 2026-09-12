// BARRIER (hermetic half): a user-visible change merged to `main` may not sit UNSERVED unnoticed.
//
// THE INVARIANT, in behavioural terms — never "a line is present":
//
//     What `main` says the app is, is what a real user is being served. If it is not, something
//     goes RED and names the commits users are not getting.
//
// WHY IT WAS NEEDED (routine #9, 2026-09-12). Exactly one scheduled detector claimed this class, and
// its own header says so — "Nothing else catches this class of gap"
// (scripts/verify-frontend-bundle-matches-source-live.ts). Executed against real production at
// 2026-09-12 15:2xZ it printed «✓ … no undeployed drift» while the served bundle was b3a7ba2
// (2026-09-11 17:42Z) and main was c8a1e14 (2026-09-12 07:53Z) — FOUR src/ commits and ~22 hours
// behind, two of them P1 user-facing repairs (a browser-tab crash on «عرض المزيد», and a finished
// chat reopening with 1,140 of 1,200 matches unreachable). It is green because it compares only the
// amenity token vocabulary of src/lib/afCohorts.ts, which none of those four commits touches.
// The narrow proposition it proves is TRUE; the broad one its name and its closing sentence assert
// is FALSE. See scripts/lib/undeployedDrift.ts's header for the full measurement.
//
// WHAT THIS FILE IS. The hermetic half of the pair, per AGENTS.md's "The required suite is HERMETIC"
// rule: it performs no I/O against production and its verdict depends only on the diff, so it is
// safe in the REQUIRED `npm test`. It proves the DECISION — undeployedDriftProblems() — by EXECUTING
// it against deliberately broken worlds, and it proves the live half that applies that same function
// to real readings still runs somewhere (liveHalfProblems).
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not compute today's real verdict. `npm test` gates every
// PR, and a drift that exists in production would otherwise fail every unrelated PR in the repo —
// the same reason AGENTS.md pins verify-migration-drift-vs-production.ts out of the suite. The live
// verdict belongs to the sibling, on a schedule.
//
//   node --experimental-strip-types scripts/verify-undeployed-user-visible-drift.ts   (in `npm test`)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { undeployedDriftProblems, isUserVisible, type DriftReading } from './lib/undeployedDrift.ts';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';

const ROOT = join(import.meta.dirname, '..');
const LIVE_HALF = 'verify-undeployed-user-visible-drift-live.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
const mustCatch = (what: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${what}`); return; }
  failures++;
  console.error(`FAIL  (mutation) did NOT catch ${what}`);
};

console.log('\nMerged-but-never-served: the decision, proven by execution\n');

const A = 'b3a7ba220bc7c2667097ce2a60833b3dbeccccd4';   // the commit production really served
const B = 'c8a1e1421a2edaaf3ae4765161f03df51931e788';   // main's head in the same minute
const BUNDLE = '_expo/static/js/web/entry-f2aa23d16fddb1865740651364cf56ad.js'; // really served

/** A world in which everything is fine. Every mutation below breaks exactly one thing in it. */
const HEALTHY: DriftReading = {
  baselineSha: A,
  headSha: B,
  baselineIsAncestorOfHead: true,
  changedPaths: ['docs/ops/ENGINEER_ROUTINES.md', 'scripts/verify-x.ts', 'supabase/migrations/2026_x.sql'],
  commitLine: [],
  liveEntryBundle: BUNDLE,
};

// ── THE BASELINE CASE. A predicate that is red for everything guards nothing (the `mustCatch`
// "…and the real shape still PASSES" case verify-voice-composer-contract.ts exists for).
check('a repo whose only post-deploy commits are docs/scripts/migrations is NOT flagged',
  undeployedDriftProblems(HEALTHY).length === 0,
  undeployedDriftProblems(HEALTHY).join('\n      '));

// ── THE INCIDENT ITSELF, in the exact shape measured on 2026-09-12. ────────────────────────────
const REAL = {
  ...HEALTHY,
  changedPaths: ['src/lib/chatTranscript.ts', 'src/store.tsx', 'src/app/index.tsx', 'src/data/agent.ts'],
  commitLine: [`${B.slice(0, 7)} A finished chat reopens as a dead end`],
};
mustCatch('THE INCIDENT: four src/ commits merged to main and never served (2026-09-12, b3a7ba2 vs c8a1e14)',
  undeployedDriftProblems(REAL).length > 0);
check('…and the failure NAMES the unserved commits, so a reader can act without re-deriving them',
  undeployedDriftProblems(REAL).join(' ').includes('A finished chat reopens as a dead end'));
check('…and it names the served commit AND the head, never just "drift"',
  undeployedDriftProblems(REAL).join(' ').includes(A) && undeployedDriftProblems(REAL).join(' ').includes(B));

// ONE user-visible file is enough. A threshold here would be a tolerance, and PART 7 forbids one.
mustCatch('a SINGLE unserved src/ file (the smallest real regression, not a batch)',
  undeployedDriftProblems({ ...HEALTHY, changedPaths: ['src/components/ResultCard.tsx'] }).length > 0);
mustCatch('an unserved asset (a platform logo a user actually sees) treated as invisible',
  undeployedDriftProblems({ ...HEALTHY, changedPaths: ['assets/icons/wasalt.png'] }).length > 0);
mustCatch('an unserved app.json (splash, name, web config) treated as invisible',
  undeployedDriftProblems({ ...HEALTHY, changedPaths: ['app.json'] }).length > 0);

// ── THE NARROW-CHECK FAILURE THIS BARRIER EXISTS FOR. The live bundle-parity check was green on
// precisely this world: src/ moved, src/lib/afCohorts.ts did not. Prove this one is not.
mustCatch('THE FALSE GREEN: src/ moved but src/lib/afCohorts.ts did not — the exact world the '
  + 'amenity-vocabulary check reported as «no undeployed drift»',
  undeployedDriftProblems({
    ...HEALTHY,
    changedPaths: ['src/lib/chatTranscript.ts', 'src/store.tsx'],   // afCohorts.ts deliberately absent
  }).length > 0);

// ── FAIL-CLOSED. Every unanswered question is a failure, never a quiet pass. ───────────────────
mustCatch('an UNREACHABLE production treated as «no drift» (a failed fetch is not an empty answer)',
  undeployedDriftProblems({ ...HEALTHY, liveEntryBundle: null }).length > 0);
mustCatch('a 200 that served an ERROR PAGE instead of an Expo entry bundle',
  undeployedDriftProblems({ ...HEALTHY, liveEntryBundle: '<!doctype html><h1>502 Bad Gateway</h1>' }).length > 0);
mustCatch('an unreadable docs/DEPLOY_BASELINE.txt (the commit production serves is UNKNOWN)',
  undeployedDriftProblems({ ...HEALTHY, baselineSha: null }).length > 0);
mustCatch('a baseline file whose first line is prose rather than a sha',
  undeployedDriftProblems({ ...HEALTHY, baselineSha: '# APPROVED PRODUCTION BASELINE' }).length > 0);
mustCatch('an UNDETERMINED ancestry (a shallow checkout) read as a satisfied one',
  undeployedDriftProblems({ ...HEALTHY, baselineIsAncestorOfHead: null }).length > 0);
mustCatch('a baseline that is NOT an ancestor of head — the record and the branch disagree',
  undeployedDriftProblems({ ...HEALTHY, baselineIsAncestorOfHead: false }).length > 0);
mustCatch('an uncomputable file list read as «no files changed»',
  undeployedDriftProblems({ ...HEALTHY, changedPaths: null }).length > 0);

// ── THE CLASSIFIER, executed. A path list is only as good as the rule that reads it. ───────────
check('isUserVisible() executed: src/, assets/, app.json are visible',
  ['src/app/index.tsx', 'assets/logo.png', 'app.json'].every(isUserVisible));
check('isUserVisible() executed: docs/, scripts/, supabase/, e2e/ are NOT',
  !['docs/x.md', 'scripts/verify-x.ts', 'supabase/migrations/1.sql', 'e2e/redteam/chain.mjs'].some(isUserVisible));
// A prefix rule that matched by `includes` would call this visible, and a sibling directory added
// tomorrow (`src-gen/`, `assetsx/`) would silently join the guarded set or silently leave it.
check('isUserVisible() is a PREFIX rule, not a substring one (docs/src/notes.md is not app source)',
  !isUserVisible('docs/src/notes.md') && !isUserVisible('vendor/assets/x.png'));
check('isUserVisible() matches app.json exactly, never a lookalike',
  isUserVisible('app.json') && !isUserVisible('app.json.bak') && !isUserVisible('e2e/app.json'));

// ── THE LIVE HALF STILL RUNS. «Moved out of npm test» and «silently deleted» look identical from
// inside the suite unless this is asserted (scripts/lib/liveHalf.ts, ops_incident #104).
const homing = liveHalfProblems(
  LIVE_HALF,
  loadRegistry(ROOT),
  (bare) => existsSync(join(ROOT, 'scripts', bare)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`${LIVE_HALF} exists, is declared in scripts/test-exclusions.txt, and its named workflow really invokes it`,
  homing.length === 0, homing.join('\n      '));

// ── AND THE NARROW CHECK MAY NOT GO BACK TO OVER-CLAIMING. ──────────────────────────────────────
// This one IS a text assertion, and deliberately so: its subject is literally a SENTENCE — the line
// a human reads and carries away — so text is the artifact, not a proxy for one. (PART 3.3 shape 1
// warns against text tripwires standing in for BEHAVIOUR; nothing here stands in for behaviour, the
// behaviour is proven above by execution.) The rule is the narrow half must not announce the broad
// verdict it does not measure. It said «no undeployed drift» for as long as the defect was live.
const NARROW = join(ROOT, 'scripts', 'verify-frontend-bundle-matches-source-live.ts');
const narrowSrc = existsSync(NARROW) ? readFileSync(NARROW, 'utf8') : '';
check('the amenity-vocabulary live check still exists (this pair names it as the narrow half)',
  narrowSrc.length > 0, `scripts/verify-frontend-bundle-matches-source-live.ts is missing`);
const successLines = narrowSrc.split('\n').filter((l) => l.includes('✓'));
check('…and its SUCCESS line no longer announces the broad verdict «no undeployed drift»',
  successLines.length > 0 && !successLines.some((l) => /no undeployed drift/i.test(l)),
  `success line(s) found: ${JSON.stringify(successLines)}\n      That check compares ONLY the amenity `
  + 'token vocabulary of src/lib/afCohorts.ts. Announcing «no undeployed drift» is the broad claim '
  + 'this pair measures, and it was printed on 2026-09-12 over four unshipped src/ commits.');
check('…and it names its own SCOPE where the reader sees the verdict',
  successLines.some((l) => /amenity/i.test(l)),
  'the success line must say what it proved (the amenity certification), so a reader cannot mistake '
  + 'it for a statement about the whole frontend');

console.log(failures === 0
  ? '\n✓ the merged-but-never-served decision fails on every world where it should\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
