// AUTO-MIRROR: a migration applied to production but missing from git gets its byte-exact save PR automatically
// (owner 2026-10-27: «fix this slow issue» — deploys kept waiting hours on other sessions' unmirrored migrations).
//
// AGENTS.md "Migration drift guard": every applied migration must be in supabase/migrations/, and the drift gate in
// safe-deploy.sh refuses EVERY deploy until it is. Measured 2026-10-27: four of the day's deploys were refused for
// another session's missing file, each wait 1-3 hours. This robot (.github/workflows/migration-auto-mirror.yml, every
// 15 min) does the mirror step for them:
//   1. ask production which applied migrations git lacks (ops_deploy_preflight_checks, the deploy gate's own question);
//   2. skip anything applied less than GRACE_MINUTES ago (the applying session's own mirror usually lands first) and
//      anything that already has a branch mirror/<version> (someone is on it);
//   3. write ops_migration_sql(version) — exactly what production executed — to supabase/migrations/<version>_<name>.sql
//      on branch mirror/<version>, and open a PR titled «mirror (auto): …».
// engineer-automerge.yml merges mirror-only PRs through safe-pr-merge.ts once every required check — including
// byte-parity against production — is green. A wrong file therefore fails CI and is never merged. Nothing here
// writes to the database.
//   node scripts/auto-mirror-migrations.mjs            (needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GH_TOKEN)
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export const GRACE_MINUTES = 20;
export const MAX_PER_RUN = 10;
// A person's open PR on mirror/<version> holds the version only this long after the apply (2026-11-10, repeat_bug:
// migration_drift ×16 in 7 days). Measured over 61 migrations 11-07…11-09: the robot's own PRs merged in 15–60 min,
// but 27 mirrors took > 3 h — every one sat behind a person's mirror/<version> PR that was not moving (#11367 carried
// 9 migrations + 2 scripts and 32 commits of review on a branch named mirror/…; #11444/#11445/#11471 waited 11–14 h
// on a reviewer). An open PR read as «someone is on it» forever, so the robot never stepped in. After CLAIM_MINUTES
// the robot mirrors the version itself on mirror/<version>-auto; engineer-automerge closes the person's PR if it then
// carries nothing new. The robot's own -auto PR never expires as a claim (it would only duplicate itself).
export const CLAIM_MINUTES = 90;
/** Every PR body this robot writes carries this; an open mirror PR with it is the robot's own and holds its version for good. */
export const ROBOT_MARK = '.github/workflows/migration-auto-mirror.yml';
/** The title this robot gives every PR it opens (see `gh pr create` below). */
export const ROBOT_TITLE = 'mirror (auto): ';
/** The robot's own PR: ITS title shape AND its body mark. A person's PR that merely mentions the workflow path
 *  (a lesson, a cross-reference) is still a person's claim and still expires (CodeRabbit on #11673). */
export const isRobotPr = (pr) => String(pr?.title ?? '').startsWith(ROBOT_TITLE) && String(pr?.body ?? '').includes(ROBOT_MARK);

/** «20261027201642» → Date (UTC); null when the version is not a 14-digit timestamp. */
export function versionTime(version) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(version));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** A filename-safe migration name (the auto-merge robot accepts only [A-Za-z0-9_]). */
export function safeName(name) {
  const s = String(name ?? '').trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  return s || 'migration';
}

/** Which missing migrations to mirror now: old enough, not already being mirrored, at most MAX_PER_RUN.
 *  «Being mirrored» = an OPEN PR whose head is mirror/<version> (`takenHeads`), for CLAIM_MINUTES after the apply.
 *  A bare branch with no open PR is
 *  NOT a claim: on 2026-11-03 four of 🔬's five applied migrations (20261103091902 … 093636) had stale
 *  mirror/<version> branches and no PR — the files travelled in #10130 beside sql/mirrors/ — so every run read
 *  «someone is on it», mirrored nothing, and the drift gate refused six deploys over 2 h 37 min. Such a version is
 *  mirrored on mirror/<version>-auto so the stale branch is never touched. */
export function planMirrors(missing, now, takenHeads, existingBranches = takenHeads, robotHeads = []) {
  const taken = new Set(takenHeads);
  const exists = new Set(existingBranches);
  // The robot's OWN open PRs (any name) never expire as a claim: on 2026-11-10 its plain mirror/<version> PRs
  // (#11639 #11649 #11651 #11655 #11658) were read as a person's claim, expired at CLAIM_MINUTES and were mirrored a
  // second time on -auto (#11652 #11654 #11660 #11663 #11665) — five duplicate PRs, ten CI rounds, one drift.
  const robot = new Set(robotHeads);
  return (missing ?? [])
    .filter((m) => {
      const t = versionTime(m?.version);
      if (!t) return false;
      const ageMs = now.getTime() - t.getTime();
      const heldByPerson = taken.has(`mirror/${m.version}`) && (ageMs < CLAIM_MINUTES * 60_000 || robot.has(`mirror/${m.version}`));
      return ageMs >= GRACE_MINUTES * 60_000 && !heldByPerson && !taken.has(`mirror/${m.version}-auto`);
    })
    .slice(0, MAX_PER_RUN)
    .map((m) => ({
      version: m.version,
      file: `supabase/migrations/${m.version}_${safeName(m.name)}.sql`,
      branch: exists.has(`mirror/${m.version}`) || taken.has(`mirror/${m.version}`) ? `mirror/${m.version}-auto` : `mirror/${m.version}`,
    }));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/auto-mirror-migrations.mjs')) {
  const URL_BASE = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const die = (why) => { console.error(`✗ auto-mirror could not run: ${why}`); process.exit(1); };
  if (!URL_BASE || !KEY || !process.env.GH_TOKEN) die('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GH_TOKEN are required');
  const rpc = async (name, body) => {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) die(`${name} http ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  const require = createRequire(import.meta.url);
  const { buildRepoMigrationVersions } = require('./build-repo-migration-versions.cjs');

  const pre = await rpc('ops_deploy_preflight_checks', { p_repo_versions: buildRepoMigrationVersions() });
  const missing = pre?.missing_in_git_details;
  if (!Array.isArray(missing)) die('preflight returned no missing_in_git_details (never read as "nothing missing")');
  const branches = git('ls-remote', '--heads', 'origin', 'mirror/*').split('\n').filter(Boolean).map((l) => l.split('refs/heads/')[1]);
  // Only an OPEN PR claims a version; a leftover branch does not (2026-11-03: 178 mirror/* branches on origin).
  const openPrs = JSON.parse(execFileSync('gh', ['pr', 'list', '--state', 'open', '--limit', '300', '--json', 'headRefName,title,body'], { encoding: 'utf8' }))
    .filter((p) => /^mirror\//.test(p.headRefName));
  const openHeads = openPrs.map((p) => p.headRefName);
  // The robot's own PRs (title shape + body mark, isRobotPr) are its own claims and never expire.
  const robotHeads = openPrs.filter(isRobotPr).map((p) => p.headRefName);
  const plan = planMirrors(missing, new Date(), openHeads, branches, robotHeads);
  console.log(`missing in git: ${missing.length}; mirroring now: ${plan.length}`);
  let failed = 0;
  for (const p of plan) {
    try {
      const sql = await rpc('ops_migration_sql', { p_version: p.version });
      if (typeof sql !== 'string' || !sql.trim()) { console.error(`✗ ${p.version}: production returned no SQL`); failed++; continue; }
      git('checkout', '-q', '-B', p.branch, 'origin/main');
      if (existsSync(p.file)) { console.log(`${p.version}: already on main as ${p.file} — skip`); continue; }
      writeFileSync(join(process.cwd(), p.file), sql);
      git('add', p.file);
      git('-c', 'user.name=ezhalah-auto-mirror', '-c', 'user.email=auto-mirror@users.noreply.github.com',
        'commit', '-q', '-m', `mirror (auto): ${p.version} byte-exact from production`);
      // A `-auto` branch is this robot's own (never a person's), so a leftover one from a cancelled or failed run is
      // overwritten. 2026-11-04 run 41767741699: mirror/20261104013243-auto was left by an earlier run, the plain push
      // was refused «non-fast-forward», and the run went red. A person's mirror/<version> branch is never forced.
      git('push', '-q', ...(p.branch.endsWith('-auto') ? ['--force'] : []), 'origin', `${p.branch}:${p.branch}`);
      execFileSync('gh', ['pr', 'create', '--head', p.branch, '--base', 'main',
        '--title', `${ROBOT_TITLE}${p.version} ${p.file.split('/').pop()}`,
        '--body', `Applied to production but missing from git, ${GRACE_MINUTES}+ minutes after it was applied. ` +
          'File = `ops_migration_sql(version)`, exactly what production executed. Merged by engineer-automerge.yml once every ' +
          'required check (incl. byte-parity) is green. Opened by `' + ROBOT_MARK + '`.'], { stdio: 'inherit' });
      console.log(`✓ ${p.version}: PR opened on ${p.branch}`);
    } catch (e) { console.error(`✗ ${p.version}: ${e.message}`); failed++; }
  }
  if (failed) process.exit(1);
}
