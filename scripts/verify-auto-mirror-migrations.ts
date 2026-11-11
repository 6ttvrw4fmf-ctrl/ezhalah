// AUTO-MIRROR decides correctly and actually runs (owner 2026-10-27: «fix this slow issue»).
//
// EXECUTES planMirrors() from scripts/auto-mirror-migrations.mjs on synthetic drift, and reads the workflow for the
// properties that keep it safe and alive: a schedule, the PR token that makes CI run, and the failure→alert bridge.
//   node --experimental-strip-types scripts/verify-auto-mirror-migrations.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { planMirrors, safeName, versionTime, GRACE_MINUTES, MAX_PER_RUN, CLAIM_MINUTES, ROBOT_MARK, ROBOT_TITLE, isRobotPr } = await import('./auto-mirror-migrations.mjs');
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
check('a stale mirror/<version> branch with NO open PR does not block the mirror (🔧 2026-11-03: four 🔬 versions sat unmirrored 2 h 37 min)',
  (() => { const p = planMirrors([{ version: '20261027201642', name: 'x' }], now, [], ['mirror/20261027201642']); return p.length === 1 && p[0].branch === 'mirror/20261027201642-auto'; })());
check('an OPEN PR on mirror/<version> still claims a version applied less than CLAIM_MINUTES ago',
  planMirrors([{ version: '20261027210558', name: 'x' }], now, ['mirror/20261027210558'], ['mirror/20261027210558']).length === 0);
// 2026-11-10 (repeat_bug:migration_drift): a person's claim is bounded. 27 of 61 mirrors took > 3 h behind a PR that was not moving.
const stale = planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642'], ['mirror/20261027201642']);
check(`a person's open mirror PR stops holding the version ${CLAIM_MINUTES} min after the apply — the robot mirrors it on -auto`,
  stale.length === 1 && stale[0].branch === 'mirror/20261027201642-auto', JSON.stringify(stale));
check('the robot never pushes to a person\'s claimed branch, even when the branch list is the default',
  planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642'])[0]?.branch === 'mirror/20261027201642-auto');
check('the claim window is longer than the grace and shorter than the 3 h drift-alert window',
  CLAIM_MINUTES > GRACE_MINUTES && CLAIM_MINUTES + 60 <= 180);
{ // Mutation proof: the pre-11-10 predicate (a claim never expires) executed on the same input must leave the version unmirrored.
  const neverExpires = (missingIn: any[], nowIn: Date, takenIn: string[]) => missingIn.filter((m) => {
    const t = versionTime(m.version); return t && nowIn.getTime() - t.getTime() >= GRACE_MINUTES * 60_000 && !takenIn.includes(`mirror/${m.version}`);
  });
  mustCatch('a claim that never expires (the 11-08/11-09 shape: #11367, #11444, #11445 held versions 6–14 h)',
    neverExpires([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642']).length === 0 && stale.length === 1);
  mustCatch('a claim that expires at once (the robot races every session\'s own mirror PR)',
    planMirrors([{ version: '20261027210558', name: 'x' }], now, ['mirror/20261027210558']).length === 0);
}
mustCatch('a robot that reads a bare branch as a claim (the 11-03 shape)',
  planMirrors([{ version: '20261027201642', name: 'x' }], now, [], ['mirror/20261027201642']).length !== 0);
mustCatch('a robot that ignores an existing mirror branch (duplicate PRs)',
  planMirrors([{ version: '20261027210558', name: 'x' }], now, ['mirror/20261027210558']).length === 0);

check('an OPEN PR on mirror/<version>-auto is a claim too (2026-11-04: the robot re-mirrored its own open PR)',
  planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642-auto'], ['mirror/20261027201642', 'mirror/20261027201642-auto']).length === 0);
mustCatch('a robot that ignores its own open -auto PR',
  planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642-auto'], ['mirror/20261027201642', 'mirror/20261027201642-auto']).length === 0);

{ // 2026-11-10: the robot's OWN open mirror/<version> PR (98 min old here, past CLAIM_MINUTES) is never re-mirrored on -auto.
  const own = planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642'], ['mirror/20261027201642'], ['mirror/20261027201642']);
  check('the robot\'s own open mirror/<version> PR never expires as a claim (11-10: five duplicate -auto PRs)', own.length === 0, JSON.stringify(own));
  const person = planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642'], ['mirror/20261027201642'], []);
  check('a PERSON\'s open mirror/<version> PR still expires after CLAIM_MINUTES (the 11-08/11-09 shape is kept)',
    person.length === 1 && person[0].branch === 'mirror/20261027201642-auto', JSON.stringify(person));
  // Mutation: the 11-10 predicate (robot heads ignored) executed on the same input re-mirrors the robot's own PR.
  const ignoresRobot = (missingIn: any[], nowIn: Date, takenIn: string[]) => missingIn.filter((m) => {
    const t = versionTime(m.version); const age = t ? nowIn.getTime() - t.getTime() : -1;
    return t && age >= GRACE_MINUTES * 60_000 && !(takenIn.includes(`mirror/${m.version}`) && age < CLAIM_MINUTES * 60_000);
  });
  mustCatch('a robot that lets its own claim expire (the 11-10 duplicate shape)',
    ignoresRobot([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642']).length === 1 && own.length === 0);
  check('the robot recognises its own PRs by the body mark it writes, and the mark names its workflow file',
    ROBOT_MARK === '.github/workflows/migration-auto-mirror.yml');
  // Provenance is title shape AND mark (CodeRabbit Major on #11673): a person's PR that mentions the workflow path is not the robot's.
  const robotPr = { title: `${ROBOT_TITLE}20261027201642 x.sql`, body: `Applied … Opened by \`${ROBOT_MARK}\`.` };
  const personMentions = { title: 'mirror: 20261027201642 + lesson', body: `see ${ROBOT_MARK} for the robot` };
  const robotTitleOnly = { title: `${ROBOT_TITLE}20261027201642 x.sql`, body: 'hand-written' };
  check('isRobotPr: the robot\'s own title + mark → robot', isRobotPr(robotPr) === true);
  check('isRobotPr: a person\'s PR that mentions the workflow path is NOT the robot\'s (its claim still expires)', isRobotPr(personMentions) === false && isRobotPr(robotTitleOnly) === false);
  mustCatch('a classifier that trusts the body mark alone (a person\'s mention would hold a version forever)',
    String(personMentions.body).includes(ROBOT_MARK) && isRobotPr(personMentions) === false);
  const personHeld = planMirrors([{ version: '20261027201642', name: 'x' }], now, ['mirror/20261027201642'], ['mirror/20261027201642'], [personMentions].filter(isRobotPr).map(() => 'mirror/20261027201642'));
  check('…so after CLAIM_MINUTES the robot still mirrors that version on -auto', personHeld.length === 1 && personHeld[0].branch === 'mirror/20261027201642-auto');
  // The body the robot WRITES carries the mark it READS (CodeRabbit nit): the create call references ROBOT_MARK and ROBOT_TITLE.
  const scriptSrc = readFileSync(join(root, 'scripts/auto-mirror-migrations.mjs'), 'utf8');
  check('the PR the robot opens is titled ROBOT_TITLE and its body carries ROBOT_MARK (written = read)',
    /'--title', `\$\{ROBOT_TITLE\}/.test(scriptSrc) && /Opened by `' \+ ROBOT_MARK \+ '`\.'/.test(scriptSrc));
}
const wf = readFileSync(join(root, '.github/workflows/migration-auto-mirror.yml'), 'utf8');
const script = readFileSync(join(root, 'scripts/auto-mirror-migrations.mjs'), 'utf8');
check('the script asks GitHub for OPEN PR heads, not only for branches', /gh', \['pr', 'list', '--state', 'open'/.test(script) && /planMirrors\(missing, new Date\(\), openHeads, branches, robotHeads\)/.test(script) && /'headRefName,title,body'/.test(script) && /openPrs\.filter\(isRobotPr\)/.test(script));
check('the workflow runs on a schedule and invokes the script', /cron: '/.test(wf) && /node scripts\/auto-mirror-migrations\.mjs/.test(wf));
check('it opens PRs with the PR token (a GITHUB_TOKEN PR triggers no checks, so it would never merge)', /BASELINE_PR_TOKEN/.test(wf));
check('a queued run reads main as it is when it RUNS, not the dispatch-time commit (2026-11-04: duplicate PRs #10346/#10347)',
  /ref: \$\{\{ github\.ref == 'refs\/heads\/main' && 'main' \|\| github\.sha \}\}/.test(wf));
check('only the robot\'s own -auto branch is force-pushed (a leftover one turned run 41767741699 red)',
  /p\.branch\.endsWith\('-auto'\) \? \['--force'\]/.test(script) && !/'--force', 'origin', `\$\{p\.branch\}/.test(script));
check('a red run reaches a human (failure→alert bridge)', /raise-workflow-alert\.mjs/.test(wf) && /if: always\(\)/.test(wf));
check('it never writes to the database (reads only the two preflight RPCs)',
  !/\bapply_migration\b|\/rest\/v1\/(?!rpc\/)/.test(script) && /ops_migration_sql/.test(script) && /ops_deploy_preflight_checks/.test(script));
check('an unreadable preflight is a failure, never "nothing missing"', /never read as "nothing missing"/.test(script) && /die\(/.test(script));

if (failed) { console.error(`\n❌ verify-auto-mirror-migrations: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-auto-mirror-migrations: unmirrored migrations get a byte-exact save PR automatically, safely.');
