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
import { readFileSync, existsSync } from 'node:fs';
import { buildRepoMigrationVersions } from './build-repo-migration-versions.cjs';

const CHECK_SCRIPT = 'scripts/verify-migration-drift-vs-production.ts';
const SHARED_PARSER = 'scripts/build-repo-migration-versions.cjs';
const WORKFLOW = '.github/workflows/migration-drift-guard.yml';
const SAFE_DEPLOY = 'scripts/safe-deploy.sh';
const PACKAGE_JSON = 'package.json';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// 1. Every file this barrier depends on must actually exist.
for (const f of [CHECK_SCRIPT, SHARED_PARSER, WORKFLOW]) {
  check(existsSync(f), `${f} exists`, `${f} is missing — the barrier has a dead link`);
}

// 2. `npm test` must actually run the check — this is what makes drift visible on the very next
//    push/PR, not just on the schedule.
const pkg = readFileSync(PACKAGE_JSON, 'utf8');
const testScript: string = JSON.parse(pkg).scripts?.test ?? '';
check(testScript.includes(CHECK_SCRIPT),
  'npm test runs the migration-drift check',
  `package.json's "test" script no longer runs ${CHECK_SCRIPT} — drift would stop showing up on every push/PR`);

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

console.log('migration-drift-guard-wired: the continuous drift barrier must stay actually connected\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);

if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — the migration-drift barrier has a broken link.`);
  process.exit(1);
}
console.log('\n✅ migration-drift-guard-wired: passed.');
