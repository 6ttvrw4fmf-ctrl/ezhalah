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

/** Which missing migrations to mirror now: old enough, not already being mirrored, at most MAX_PER_RUN. */
export function planMirrors(missing, now, existingBranches) {
  const taken = new Set(existingBranches);
  return (missing ?? [])
    .filter((m) => {
      const t = versionTime(m?.version);
      return t && now.getTime() - t.getTime() >= GRACE_MINUTES * 60_000 && !taken.has(`mirror/${m.version}`);
    })
    .slice(0, MAX_PER_RUN)
    .map((m) => ({ version: m.version, file: `supabase/migrations/${m.version}_${safeName(m.name)}.sql`, branch: `mirror/${m.version}` }));
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
  const plan = planMirrors(missing, new Date(), branches);
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
      git('push', '-q', 'origin', `${p.branch}:${p.branch}`);
      execFileSync('gh', ['pr', 'create', '--head', p.branch, '--base', 'main',
        '--title', `mirror (auto): ${p.version} ${p.file.split('/').pop()}`,
        '--body', `Applied to production but missing from git, ${GRACE_MINUTES}+ minutes after it was applied. ` +
          'File = `ops_migration_sql(version)`, exactly what production executed. Merged by engineer-automerge.yml once every ' +
          'required check (incl. byte-parity) is green. Opened by `.github/workflows/migration-auto-mirror.yml`.'], { stdio: 'inherit' });
      console.log(`✓ ${p.version}: PR opened on ${p.branch}`);
    } catch (e) { console.error(`✗ ${p.version}: ${e.message}`); failed++; }
  }
  if (failed) process.exit(1);
}
