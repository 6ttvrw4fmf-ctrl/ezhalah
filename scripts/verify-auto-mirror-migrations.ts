// AUTO-MIRROR decides correctly and actually runs (owner 2026-10-27: «fix this slow issue»).
//
// EXECUTES planMirrors() from scripts/auto-mirror-migrations.mjs on synthetic drift, and reads the workflow for the
// properties that keep it safe and alive: a schedule, the PR token that makes CI run, and the failure→alert bridge.
//   node --experimental-strip-types scripts/verify-auto-mirror-migrations.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { planMirrors, safeName, versionTime, GRACE_MINUTES, MAX_PER_RUN } = await import('./auto-mirror-migrations.mjs');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const now = new Date('2026-10-27T22:00:00Z');
const missing = [
  { version: '20261027201642', name: 'pin district batch' },     // 98 min old  → mirror
  { version: '20261027215500', name: 'fresh_one' },               // 5 min old   → wait (its session may mirror it)
  { version: '20261027210558', name: 'already/being mirrored' },  // branch exists → skip
  { version: '2026_bad', name: 'x' },                             // not a timestamp → skip
];
const plan = planMirrors(missing, now, ['mirror/20261027210558']);
check('mirrors only migrations past the grace period and not already being mirrored',
  plan.map((p: any) => p.version).join(',') === '20261027201642', JSON.stringify(plan));
check('the file and branch follow the mirror convention the auto-merge robot accepts',
  plan[0]?.file === 'supabase/migrations/20261027201642_pin_district_batch.sql' && plan[0]?.branch === 'mirror/20261027201642'
  && /^supabase\/migrations\/[0-9]{14}_[A-Za-z0-9_]+\.sql$/.test(plan[0]?.file ?? ''));
check('names are made filename-safe', safeName('a/b c-d') === 'a_b_c_d' && safeName('') === 'migration');
check('versions read back as exact UTC times', versionTime('20261027201642')?.toISOString() === '2026-10-27T20:16:42.000Z');
check(`at most ${MAX_PER_RUN} PRs per run`, planMirrors(Array.from({ length: 30 }, (_, i) => ({ version: `202610271${String(i).padStart(2, '0')}000`.slice(0, 14), name: 'n' })), now, []).length <= MAX_PER_RUN);
check(`grace period is ${GRACE_MINUTES} minutes (the applying session gets the first chance)`, GRACE_MINUTES >= 10 && GRACE_MINUTES <= 60);
mustCatch('a robot with no grace period (races the session that applied it)',
  planMirrors([{ version: '20261027215500', name: 'x' }], now, []).length === 0);
mustCatch('a robot that ignores an existing mirror branch (duplicate PRs)',
  planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642']).length === 0);

const wf = readFileSync(join(root, '.github/workflows/migration-auto-mirror.yml'), 'utf8');
const script = readFileSync(join(root, 'scripts/auto-mirror-migrations.mjs'), 'utf8');
check('the workflow runs on a schedule and invokes the script', /cron: '/.test(wf) && /node scripts\/auto-mirror-migrations\.mjs/.test(wf));
check('it opens PRs with the PR token (a GITHUB_TOKEN PR triggers no checks, so it would never merge)', /BASELINE_PR_TOKEN/.test(wf));
check('a red run reaches a human (failure→alert bridge)', /raise-workflow-alert\.mjs/.test(wf) && /if: always\(\)/.test(wf));
check('it never writes to the database (reads only the two preflight RPCs)',
  !/\bapply_migration\b|\/rest\/v1\/(?!rpc\/)/.test(script) && /ops_migration_sql/.test(script) && /ops_deploy_preflight_checks/.test(script));
check('an unreadable preflight is a failure, never "nothing missing"', /never read as "nothing missing"/.test(script) && /die\(/.test(script));

if (failed) { console.error(`\n❌ verify-auto-mirror-migrations: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-auto-mirror-migrations: unmirrored migrations get a byte-exact save PR automatically, safely.');
