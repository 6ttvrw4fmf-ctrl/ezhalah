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
import {
  liveBundleReading, undeployedDriftProblems, isUserVisible, type DriftReading,
} from './lib/undeployedDrift.ts';
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

// ── THE STALE-RECORD CASE, in the exact shape measured on 2026-09-15. ─────────────────────────
// The floor said 18fd9974 while four production deploys had succeeded past it, the newest 07c6104.
// Reading the drift off that floor named 13 user-visible files — two platform launches and a P1
// chat-lock repair — as «MERGED AND NOT SHIPPED». Every one of them was live. The record was wrong,
// not the work, and the two must not collapse into one verdict.
const RECORDED = '18fd9974dfb925286f701b098a2d280d409846a9';   // what the file still claimed
const DEPLOYED = '07c610411ee8a9eda27a9278ad385ad8f48894cf';   // what production provably served
const HEAD     = '9ca2c353ce1dc6bd9d2cf6d5f9549a94c2d769f3';   // main, 1 scrapers-only commit ahead

/** The world of 2026-09-15: stale floor, and NOTHING user-visible actually unshipped. */
const STALE_RECORD: DriftReading = {
  ...HEALTHY,
  baselineSha: RECORDED,
  headSha: HEAD,
  // What the stale floor makes the diff look like — the 13 files, all of them in fact shipped.
  changedPaths: ['src/components/ResultCard.tsx', 'src/data/platforms.ts', 'src/i18n.tsx',
                 'src/app/agent.tsx', 'assets/images/rakez.png', 'assets/images/suwar.png'],
  commitLine: [`${DEPLOYED.slice(0, 7)} suwar column fix + new platform راكز العقارية`],
  lastDeploySha: DEPLOYED,
  baselineIsBehindLastDeploy: true,
  // Against the commit production really serves, only a scrapers/ commit remains.
  changedPathsSinceLastDeploy: ['scrapers/remal/list.py'],
};
mustCatch('THE 2026-09-15 FALSE ALARM: a stale baseline is itself reported as a problem',
  undeployedDriftProblems(STALE_RECORD).length > 0);
check('…and it says the RECORD is what is wrong, naming the recorder, not the merged commits',
  undeployedDriftProblems(STALE_RECORD).join(' ').includes('is STALE')
  && undeployedDriftProblems(STALE_RECORD).join(' ').includes('record-deploy-baseline.sh'));
check('…and it does NOT accuse shipped work of being «MERGED AND NOT SHIPPED»',
  !undeployedDriftProblems(STALE_RECORD).join(' ').includes('MERGED AND NOT SHIPPED'));
check('…and it states that nothing user-visible is genuinely unshipped, measured against the real deploy',
  undeployedDriftProblems(STALE_RECORD).join(' ').includes('NOTHING user-visible is unshipped'));

// The stale-record branch must still REPORT genuine drift when there is some. A guard that hides
// real unshipped work behind "the record is stale" would be strictly worse than the bug it fixes.
const STALE_RECORD_AND_REAL_DRIFT: DriftReading = {
  ...STALE_RECORD,
  changedPathsSinceLastDeploy: ['src/components/ResultCard.tsx', 'scrapers/remal/list.py'],
};
mustCatch('a stale record does NOT hide user-visible work that is genuinely unshipped past the real deploy',
  undeployedDriftProblems(STALE_RECORD_AND_REAL_DRIFT).some((p) => p.includes('genuinely unshipped')));
check('…and it names the actually-unshipped file rather than the whole stale diff',
  undeployedDriftProblems(STALE_RECORD_AND_REAL_DRIFT).join(' ').includes('src/components/ResultCard.tsx'));

// THE GUARD MUST NOT NEUTER THE DETECTOR. With corroboration supplied and the record CURRENT, the
// original 2026-09-12 incident must still be caught exactly as before.
const CORROBORATED_AND_DRIFTING: DriftReading = {
  ...REAL,
  lastDeploySha: A,                    // production's last deploy IS the recorded baseline
  baselineIsBehindLastDeploy: false,   // the record is current
  changedPathsSinceLastDeploy: null,   // not consulted on this branch
};
mustCatch('THE INCIDENT still caught when the record is corroborated as CURRENT (the guard is not an off-switch)',
  undeployedDriftProblems(CORROBORATED_AND_DRIFTING).some((p) => p.includes('MERGED AND NOT SHIPPED')));

// Fail CLOSED on unverifiable corroboration, both shapes.
mustCatch('an UNREADABLE deploy history treated as «the record must be fine»',
  undeployedDriftProblems({ ...HEALTHY, lastDeploySha: null, baselineIsBehindLastDeploy: null }).length > 0);
mustCatch('an UNDETERMINED «is the baseline behind the last deploy» read as «the record is current»',
  undeployedDriftProblems({ ...HEALTHY, lastDeploySha: A, baselineIsBehindLastDeploy: null }).length > 0);

// ── UNDETERMINED IS NOT "CURRENT" AT THE ACCUSATION SITE EITHER (routine #9, 2026-09-18). ──────
// The two mutations directly above were the ONLY cover for the undetermined case, and both assert
// `.length > 0` against HEALTHY — a world with NO user-visible drift. In that world the accusation
// branch cannot run, so neither mutation could ever observe what the predicate CLAIMS once drift is
// also present. `baselineIsBehindLastDeploy === null` satisfies `!== true`, so an unverifiable record
// produced the same flat «MERGED AND NOT SHIPPED» as a record proven CURRENT — the UNKNOWN→NO shape,
// in the guard built to stop this accusation being false. Measured live on 2026-09-18: 11 commits
// named, 10 of them provably served by their own discriminators in the served bundle (ops_incident
// #227). Note the asymmetry these fixtures now close: the `=== true` branch has had exactly this
// assertion since 2026-09-15, the `=== null` branch had none.
const UNVERIFIABLE_RECORD_AND_DRIFT: DriftReading = {
  ...REAL,
  lastDeploySha: null,                 // a cloud session cannot read the deploy history at all
  baselineIsBehindLastDeploy: null,    // …so this is UNDETERMINED, not "the record is current"
};
mustCatch('THE 2026-09-18 FALSE ACCUSATION: an UNVERIFIABLE record still failing the run',
  undeployedDriftProblems(UNVERIFIABLE_RECORD_AND_DRIFT).length > 0);
check('…and it does NOT call the diff «MERGED AND NOT SHIPPED» when nothing corroborated the record',
  !undeployedDriftProblems(UNVERIFIABLE_RECORD_AND_DRIFT).join(' ').includes('MERGED AND NOT SHIPPED'));
check('…and it says so in the reader\'s own words: whether the work is unshipped is UNKNOWN',
  undeployedDriftProblems(UNVERIFIABLE_RECORD_AND_DRIFT).join(' ').includes('UNKNOWN'));
check('…and NO SIGNAL IS LOST — the files and the commits are still named in full',
  undeployedDriftProblems(UNVERIFIABLE_RECORD_AND_DRIFT).join(' ').includes('src/store.tsx')
  && undeployedDriftProblems(UNVERIFIABLE_RECORD_AND_DRIFT).join(' ').includes('A finished chat reopens as a dead end'));
// The other undetermined shape: the history READ, but the ancestry question unanswered.
check('an UNDETERMINED ancestry against a readable history is hedged the same way, not accused',
  !undeployedDriftProblems({ ...REAL, lastDeploySha: A, baselineIsBehindLastDeploy: null })
    .join(' ').includes('MERGED AND NOT SHIPPED'));
// AND THE HEDGE IS NOT AN OFF-SWITCH. Both neighbours of `null` must still accuse, or the repair
// would have bought honesty on one path by going blind on two.
check('…while a record corroborated CURRENT still accuses (the hedge is not vacuously quiet)',
  undeployedDriftProblems({ ...REAL, lastDeploySha: A, baselineIsBehindLastDeploy: false })
    .some((p) => p.includes('MERGED AND NOT SHIPPED')));
check('…and a caller supplying NO corroboration at all still accuses, exactly as before',
  undeployedDriftProblems(REAL).some((p) => p.includes('MERGED AND NOT SHIPPED')));
mustCatch('a last-deploy sha that is prose rather than a commit',
  undeployedDriftProblems({ ...HEALTHY, lastDeploySha: 'unknown', baselineIsBehindLastDeploy: false }).length > 0);

// BACKWARD COMPATIBILITY: a caller supplying no corroboration at all behaves exactly as before —
// the new readings are additive, so the predicate cannot start failing on callers that never had them.
check('a reading with NO corroboration evidence is judged exactly as before (additive, not required)',
  undeployedDriftProblems(HEALTHY).length === 0
  && undeployedDriftProblems(REAL).some((p) => p.includes('MERGED AND NOT SHIPPED')));

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

// ── THE RESPONSE→READING RULE, executed here too, so it is covered on every PR and not only on
// the live run. This is the step where a failed request becomes a plausible-looking answer.
const REAL_HTML = '<!doctype html><script src="/_expo/static/js/web/entry-deadbeef.js"></script>';
mustCatch('a non-200 production response treated as a readable page',
  liveBundleReading(false, REAL_HTML) === null);
mustCatch('an empty or unreadable 200 body treated as a readable page',
  liveBundleReading(true, '') === null && liveBundleReading(true, null) === null);
mustCatch('a 200 carrying an ERROR PAGE passed off as a bundle, then accepted by the predicate',
  undeployedDriftProblems({
    ...HEALTHY, liveEntryBundle: liveBundleReading(true, '<!doctype html><h1>502 Bad Gateway</h1>'),
  }).length > 0);
mustCatch('…while a real bundle reference IS extracted and IS accepted (not vacuously null)',
  liveBundleReading(true, REAL_HTML) === '_expo/static/js/web/entry-deadbeef.js'
  && undeployedDriftProblems({ ...HEALTHY, liveEntryBundle: liveBundleReading(true, REAL_HTML) }).length === 0);

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
