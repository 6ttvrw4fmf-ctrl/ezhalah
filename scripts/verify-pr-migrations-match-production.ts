// Hermetic proof of the robot's DATABASE LANE (scripts/pr-migrations-match-production.ts, wired in
// .github/workflows/engineer-automerge.yml; owner 2026-11-07 «yeah do that»): a PR carrying migration or sql/mirrors
// files lands by itself only when every migration in it is exactly what production already ran, and the robot can
// never widen its own door. No network.
//   node --experimental-strip-types scripts/verify-pr-migrations-match-production.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judge, type PrFile } from './pr-migrations-match-production.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`); };
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

const MIG = 'supabase/migrations/20261106060445_gh_checks_that_cry_wolf_weekly.sql';
const SQL = "select cron.schedule('gh-checks-that-cry-wolf', '27 7 * * 1', $c$select 1$c$);";
const prod = new Map<string, string | null>([['20261106060445', SQL]]);
const one = (text: string | null, path = MIG): PrFile[] => [{ path, text }];

check('a migration byte-identical to what production ran → lands', judge(one(SQL), prod).ok);
check('…a trailing newline is not a difference (verify-migration-content-parity normalisation)', judge(one(`${SQL}\n`), prod).ok);
check('migration + its sql/mirrors/cron_schedule.json (the #10856 shape) → lands',
  judge([...one(SQL), { path: 'sql/mirrors/cron_schedule.json', text: '{}' }], prod).ok);
check('a sql/mirrors-only PR → lands (git copies; their own barriers are required checks)',
  judge([{ path: 'sql/mirrors/listing_native_location_v1.sql', text: '-- x' }], prod).ok);
check('a migration production has NOT run → stays with a person', !judge(one(SQL, 'supabase/migrations/20991231000000_new_thing.sql'), prod).ok);
check('production answered null for it → stays with a person', !judge(one(SQL), new Map([['20261106060445', null]])).ok);
check('one changed byte → stays with a person', !judge(one(SQL.replace('27 7', '28 7')), prod).ok);
check('a file unreadable at the PR head → stays with a person', !judge(one(null), prod).ok);
check('a file outside migrations/sql-mirrors is never admitted by this lane', !judge([...one(SQL), { path: 'supabase/config.toml', text: '' }], prod).ok);
check('no files → not a pass', !judge([], prod).ok);

// ── wiring: the workflow really asks production, and the gate's own pieces never auto-merge ──
const wf = readFileSync(join(import.meta.dirname, '..', '.github', 'workflows', 'engineer-automerge.yml'), 'utf8');
const wired = (y: string) =>
  /if git fetch -q origin "refs\/pull\/\$pr\/head" \\\s*&& node [^\n]*\\\s*scripts\/pr-migrations-match-production\.ts "\$head_sha" "\$\{db_files\[@\]\}"; then\s*db_lane=1/.test(y)
  && y.includes('if [ -z "$files" ] || { [ -n "$outside" ] && [ "$db_lane" != 1 ]; }; then')
  && /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}\n\s+run: \|/.test(y)
  && !y.includes('mirror_only');
const PROTECTED = ['scripts/lib/mergeGate', 'scripts/pr-migrations-match-production', 'scripts/lib/migrationDrift', 'scripts/safe-pr-merge'];
const guarded = (y: string) => {
  const line = y.split('\n').find((l) => l.includes("grep -E '^(\\.github/workflows/engineer-automerge\\.yml")) ?? '';
  return PROTECTED.every((f) => line.includes(`${f}\\.ts`));
};
check('engineer-automerge asks production before the database lane opens, and only then', wired(wf));
check('the merge gate, this check and its normaliser stay with a person (a robot cannot widen its own door)', guarded(wf));
mustCatch('the database lane opened without the production read', !wired(wf.replace(/if git fetch -q origin "refs\/pull\/\$pr\/head" \\\s*&& node [^\n]*\\\s*scripts\/pr-migrations-match-production\.ts "\$head_sha" "\$\{db_files\[@\]\}"; then/, 'if true; then')));
mustCatch('the old title-«mirror» rule back beside it', !wired(wf.replace('db_lane=0', 'db_lane=0\n            mirror_only=0')));
mustCatch('mergeGate.ts dropped from the protected list', !guarded(wf.replace('|scripts/lib/mergeGate\\.ts', '')));
mustCatch('this check dropped from the protected list', !guarded(wf.replace('|scripts/pr-migrations-match-production\\.ts', '')));

if (failed) { console.error(`\n❌ verify-pr-migrations-match-production: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the database lane lands only SQL production already ran, and the gate stays with a person');
