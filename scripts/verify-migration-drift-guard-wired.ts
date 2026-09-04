// The migration-drift barrier must stay ACTUALLY WIRED (2026-08-10, owner-requested permanent
// barrier: "Production DB change -> tracked migration -> repository matches production -> CI
// verifies the match... detect immediately and fail loudly").
//
// THE FAILURE CLASS THIS PINS: a monitoring script that quietly stops running protects nothing —
// see verify-agent-deploy-path-documented.ts's header for the exact same lesson learned on
// deploy-frontend.yml (a working guard nobody's told about), and lib/public-supabase.ts's header
// for the same lesson learned on the two live-behavioral checks (a workflow reading an env var that
// was never wired to a real secret, failing SILENTLY-WRONG for weeks). This barrier has three parts
// that all have to keep pointing at each other:
//   1. scripts/verify-migration-drift-vs-production.ts (the check itself)
//   2. `npm test` (package.json) — runs it on every push/PR via full-verification-ci.yml
//   3. .github/workflows/migration-drift-guard.yml — runs it on a tight independent schedule, so
//      drift introduced with NO push at all (the actual failure mode: a session applies a migration
//      directly via MCP and never commits) is still caught within minutes.
// A future refactor that renames/moves/deletes any one of these without updating the others would
// silently disable the barrier while every file still LOOKS present. This is what would catch that.
//
// Also pins that both scripts/safe-deploy.sh (the deploy-time gate) and the continuous checker
// build the repo migration-versions list from the SAME shared parser — two independent copies is
// exactly how this repo has drifted before (see build-repo-migration-versions.cjs's own header).
//
// Deliberately OFFLINE (reads only tracked repo files, no network) to match the other verifiers in
// `npm test` — the LIVE half (does the check actually catch real drift) is
// scripts/verify-migration-drift-vs-production.ts itself, exercised for real against production on
// every scheduled run and every push.
//
// Run: node --experimental-strip-types scripts/verify-migration-drift-guard-wired.ts
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import { readFileSync, existsSync } from 'node:fs';
import { buildRepoMigrationVersions } from './build-repo-migration-versions.cjs';

const CHECK_SCRIPT = 'scripts/verify-migration-drift-vs-production.ts';
const SHARED_PARSER = 'scripts/build-repo-migration-versions.cjs';
const WORKFLOW = '.github/workflows/migration-drift-guard.yml';
const SAFE_DEPLOY = 'scripts/safe-deploy.sh';
const PACKAGE_JSON = 'package.json';
const ROOT = join(import.meta.dirname, '..');
const DRIFT_MODULE = 'scripts/lib/migrationDrift.ts';
const PURE_TEST = 'scripts/verify-migration-mirror-integrity.ts';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// 1. Every file this barrier depends on must actually exist.
for (const f of [CHECK_SCRIPT, SHARED_PARSER, WORKFLOW]) {
  check(existsSync(f), `${f} exists`, `${f} is missing — the barrier has a dead link`);
}

// 2. This offline structural test itself MUST run in `npm test` (so a future refactor that breaks
//    the wiring below is caught on every push) — but the LIVE checker must NOT (see its own header
//    for why: `npm test` is a required status check for every PR, and migration drift is common
//    enough here that wiring the live check in would block unrelated PRs for someone else's miss).
//    This pins BOTH halves of that decision, not just one, so neither can silently drift back.
// `npm test` no longer lists its checks inline — it discovers them (scripts/lib/testRegistry.ts,
// owner-approved 2026-08-28 to kill the one-line merge-conflict hotspot). Asking the registry is the
// same question this always asked; string-matching the "test" script would now answer "no" for every
// check in the suite.
const testScript: string = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).scripts?.test ?? '';
check(npmTestRuns(ROOT, 'verify-migration-drift-guard-wired'),
  'npm test runs THIS structural check',
  `package.json's "test" script no longer runs verify-migration-drift-guard-wired.ts — a broken ` +
  `wiring below would go unnoticed until someone happens to run it manually`);
check(!npmTestRuns(ROOT, CHECK_SCRIPT.replace(/\.ts$/, '')) && !testScript.includes(CHECK_SCRIPT),
  'npm test deliberately does NOT run the live production check',
  `package.json's "test" script now runs ${CHECK_SCRIPT} directly — this makes the REQUIRED ` +
  `full-verification-ci.yml check fail for ANY unrelated PR whenever drift exists anywhere in ` +
  `production (common in this repo), not just PRs that touch migrations. Revert to relying on ` +
  `migration-drift-guard.yml's schedule + migrations-path-scoped push trigger instead`);

// 3. The dedicated workflow must run independently of any push (the actual failure mode: a session
//    applies a migration via MCP and pushes NOTHING) — so it needs a schedule trigger, and that
//    schedule must be tight. "Immediately" was the owner's word; anything looser than hourly is not
//    that, so this pins the interval rather than just "a schedule exists".
const wf = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, 'utf8') : '';
const cronMatch = wf.match(/cron:\s*'\*\/(\d+) \* \* \* \*'/);
check(!!cronMatch,
  'migration-drift-guard.yml has a */N-minute cron schedule',
  `${WORKFLOW} must run on a tight cron schedule independent of pushes — a push-only trigger would ` +
  `never catch a direct-to-prod migration with no commit at all`);
if (cronMatch) {
  const minutes = Number(cronMatch[1]);
  check(minutes <= 30,
    `schedule runs at most every ${minutes} minutes (owner asked for "immediately")`,
    `${WORKFLOW}'s schedule is every ${minutes} minutes — too loose to call "immediate" detection`);
}
check(/workflow_dispatch/.test(wf),
  'migration-drift-guard.yml supports manual dispatch',
  `${WORKFLOW} should support workflow_dispatch for on-demand verification`);
check(/run: .*verify-migration-drift-vs-production\.ts/.test(wf),
  'migration-drift-guard.yml actually invokes the check script',
  `${WORKFLOW} exists but does not run ${CHECK_SCRIPT} — a workflow that runs nothing protects nothing`);

// 4. The workflow must actually be capable of writing the dashboard-visible alert (not just failing
//    the CI job) — that requires the service-role key be passed through.
check(/SUPABASE_SERVICE_ROLE_KEY/.test(wf),
  'migration-drift-guard.yml passes the service-role key through',
  `${WORKFLOW} never sets SUPABASE_SERVICE_ROLE_KEY — drift would only show as a GitHub Actions ` +
  `red X, never as a dashboard alert_event P1`);

// 4b. BOTH live checkers must FAIL CLOSED when production is unreachable (2026-09-04).
//
// Until today both ended their network catch with a bare `process.exit(0)` under a comment that
// said "CI must not skip" — a stated intent nothing implemented. Anything that stopped the RPC from
// answering (host down, key rotated, ops_deploy_preflight_checks renamed or dropped by a later
// migration) produced a GREEN scheduled run that had verified nothing. For conditions #1-#4 that
// silence is permanent: unlike condition #5 they stamp no heartbeat, so no staleness detector would
// ever notice. "Could not check" must never render as "checked, and clean".
//
// The rule pinned here is the shape, not the wording: the unreachable path must reach a
// `process.exit(1)`, and any surviving `exit(0)` must be guarded by the local-developer escape
// (`process.env.CI`) rather than taken unconditionally.
for (const f of [CHECK_SCRIPT, 'scripts/verify-migration-content-parity.ts']) {
  const src = existsSync(f) ? readFileSync(f, 'utf8') : '';
  // Strip comments at the READER — prose describing fail-closed must not read as fail-closed.
  const code = src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(/process\.env\.CI/.test(code),
    `${f} distinguishes an unattended run from a local one`,
    `${f} never reads process.env.CI — its network-failure branch cannot tell a developer's ` +
    `offline laptop from a scheduled guard run, so it must be treating both the same way`);
  check(/process\.exit\(1\)/.test(code),
    `${f} can exit non-zero when production is unreachable`,
    `${f} has no process.exit(1) — an unreachable production would end the run successfully`);
  // Every exit(0) must sit inside an `if (!process.env.CI)` block. Counting is the honest test:
  // one unguarded exit(0) on the failure path re-opens the hole no matter how many guarded ones
  // surround it.
  const exitZeros = (code.match(/process\.exit\(0\)/g) ?? []).length;
  const guardedExitZeros = (code.match(/if\s*\(!process\.env\.CI\)\s*\{[^}]*process\.exit\(0\)/g) ?? []).length;
  check(exitZeros === guardedExitZeros,
    `${f}: all ${exitZeros} exit(0) call(s) are behind the non-CI guard`,
    `${f}: ${exitZeros} process.exit(0) call(s) but only ${guardedExitZeros} inside an ` +
    `if (!process.env.CI) block — an unguarded one makes an unchecked run report success in CI`);
}

// 5. No second, independently-maintained copy of the migration-filename parser. safe-deploy.sh and
//    the continuous checker MUST derive from the one shared file, or they can silently disagree
//    about what counts as "in git" (exactly the class of bug the shared file's own header warns
//    about — see build-repo-migration-versions.cjs).
const deploySh = existsSync(SAFE_DEPLOY) ? readFileSync(SAFE_DEPLOY, 'utf8') : '';
check(deploySh.includes('build-repo-migration-versions'),
  'safe-deploy.sh sources the shared migration-versions parser',
  `${SAFE_DEPLOY} no longer references ${SHARED_PARSER} — check whether it re-inlined its own ` +
  `copy of the filename-parsing logic, which can silently diverge from the continuous checker`);
const checkScript = existsSync(CHECK_SCRIPT) ? readFileSync(CHECK_SCRIPT, 'utf8') : '';
check(checkScript.includes('build-repo-migration-versions'),
  'verify-migration-drift-vs-production.ts sources the shared migration-versions parser',
  `${CHECK_SCRIPT} no longer references ${SHARED_PARSER} — same divergence risk as above`);
check(!/readdirSync\(['"]supabase\/migrations['"]\)/.test(checkScript),
  'the continuous checker does not re-inline its own migrations-dir scan',
  `${CHECK_SCRIPT} scans supabase/migrations directly instead of going through the shared parser`);

// 6. The shared parser itself must actually work and find migrations — a check that always passes
//    an empty list would never detect drift either.
const versions: string[] = buildRepoMigrationVersions();
check(versions.length > 100,
  `shared parser finds ${versions.length} migration identifiers (sanity floor: >100)`,
  `build-repo-migration-versions.cjs found only ${versions.length} identifiers — the glob or the parse regex may be broken`);

// 7. The guard must cover ALL FOUR drift conditions the owner asked for (2026-08-21), not just the
//    two the server RPC returns. The reverse-direction pair — committed-but-not-applied and duplicate
//    versions — lives in the pure module and is proven by the offline pure test; both must stay wired,
//    or two of the four conditions would silently stop being checked.
for (const f of [DRIFT_MODULE, PURE_TEST]) {
  check(existsSync(f), `${f} exists`, `${f} is missing — a drift condition has no detector/test`);
}
const mod = existsSync(DRIFT_MODULE) ? readFileSync(DRIFT_MODULE, 'utf8') : '';
for (const fn of ['findCommittedNotApplied', 'findDuplicateMigrationVersions', 'driftIsClean']) {
  check(mod.includes(`export function ${fn}`),
    `migrationDrift.ts exports ${fn}`,
    `${DRIFT_MODULE} no longer exports ${fn} — a drift condition lost its detector`);
}
check(/export const STRICT_ERA_BASELINE\s*=\s*'20260815000000'/.test(mod),
  'the strict-era baseline is pinned',
  `${DRIFT_MODULE}'s STRICT_ERA_BASELINE changed — moving it silently exempts or re-flags legacy files; change deliberately`);
// The live checker must actually USE all four (server's two + the module's two), not just print them.
for (const needle of ['findCommittedNotApplied', 'findDuplicateMigrationVersions', 'driftIsClean', 'applied_ids']) {
  check(checkScript.includes(needle),
    `the live checker uses ${needle}`,
    `${CHECK_SCRIPT} no longer references ${needle} — a drift condition is computed but not gated on, or the server field it needs is gone`);
}
check(checkScript.includes('listMigrationFiles'),
  'the live checker lists files through the shared parser',
  `${CHECK_SCRIPT} must get its file list from ${SHARED_PARSER}'s listMigrationFiles, not a re-inlined scan`);
// The pure test runs in `npm test` (unlike the live check) — it is offline and deterministic, so it
// pins the detection logic on every PR without the collateral-blocking problem the live check has.
check(npmTestRuns(ROOT, PURE_TEST.replace(/\.ts$/, '')),
  'npm test runs the offline mirror-integrity test',
  `package.json's "test" script no longer runs ${PURE_TEST} — the four-condition detection logic ` +
  `(and its mutation proof) would go unchecked on PRs`);

console.log('migration-drift-guard-wired: the continuous drift barrier must stay actually connected\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the migration-drift barrier has a broken link.`);
  process.exit(1);
}
console.log('\n✅ migration-drift-guard-wired: passed.');
