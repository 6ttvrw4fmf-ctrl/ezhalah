// Permanent regression test for the production-target lock (owner P0 2026-07-21).
// Proves — against the SHARED predicates that scripts/safe-deploy.sh and scripts/preflight-verify.sh
// actually use (scripts/deploy-target-guard.sh) — the four guarantees the owner requires:
//   1. A checkout linked to `ezhalah-app` is ALLOWED to deploy.
//   2. Any other Vercel project (wrong id, wrong name, missing, or garbage link) is REFUSED.
//   3. The canonical URL must serve the EXACT deployed build (matching entry-bundle hash → OK).
//   4. A deploy is NEVER marked successful if the canonical alias did not move (mismatch/empty → REFUSE).
// Plus drift guards: the shipping scripts must SOURCE the shared library and must NOT re-inline a
// divergent copy of the link logic — so this test can never pass while the real scripts diverge.
//
// Runs in `npm test` and in the deploy-guard CI workflow. No network, no DB, fully deterministic.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPO = process.cwd();
const LIB = path.join(REPO, 'scripts', 'deploy-target-guard.sh');

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}`);
  if (!cond) failures++;
};

// Run a bash snippet with the shared guard library sourced; return trimmed stdout.
const dtg = (snippet: string): string => {
  const r = spawnSync('bash', ['-c', `. "${LIB}"; ${snippet}`], { encoding: 'utf8' });
  return (r.stdout || '').trim();
};

// Build a temp checkout dir with a given .vercel/project.json body (null = no file at all).
const tmpDirs: string[] = [];
const linkDir = (body: string | null): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dtg-'));
  tmpDirs.push(dir);
  if (body !== null) {
    mkdirSync(path.join(dir, '.vercel'), { recursive: true });
    writeFileSync(path.join(dir, '.vercel', 'project.json'), body);
  }
  return dir;
};

const canonical = JSON.stringify({
  projectId: 'prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX',
  orgId: 'team_0lVrGRoJbCRIWovPNkfnmwJ7',
  projectName: 'ezhalah-app',
});
const wrongId = JSON.stringify({ projectId: 'prj_SomeoneElsesProject', orgId: 'team_0lVrGRoJbCRIWovPNkfnmwJ7', projectName: 'ezhalah-app' });
const wrongName = JSON.stringify({ projectId: 'prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX', orgId: 'team_0lVrGRoJbCRIWovPNkfnmwJ7', projectName: 'ezhalah-preview-clone' });
const bothWrong = JSON.stringify({ projectId: 'prj_Attacker', orgId: 'team_x', projectName: 'not-ezhalah' });

const linkVerdict = (dir: string) => dtg(`dtg_link_is_canonical "${dir}" && echo ALLOW || echo REFUSE`);
const aliasVerdict = (expected: string, actual: string) =>
  dtg(`dtg_alias_serves "${expected}" "${actual}" && echo OK || echo REFUSE`);

console.log('deploy-target-guard: production-target lock regression test');

// ── (1) canonical link is ALLOWED ─────────────────────────────────────────────────────────
check('canonical ezhalah-app link → ALLOWED', linkVerdict(linkDir(canonical)) === 'ALLOW');

// ── (2) every non-canonical link is REFUSED ───────────────────────────────────────────────
check('wrong projectId (right name) → REFUSED', linkVerdict(linkDir(wrongId)) === 'REFUSE');
check('wrong projectName (right id) → REFUSED', linkVerdict(linkDir(wrongName)) === 'REFUSE');
check('both id and name wrong → REFUSED', linkVerdict(linkDir(bothWrong)) === 'REFUSE');
check('missing .vercel/project.json → REFUSED', linkVerdict(linkDir(null)) === 'REFUSE');
check('garbage (non-JSON) link file → REFUSED', linkVerdict(linkDir('}{ not json')) === 'REFUSE');
check('empty link file → REFUSED', linkVerdict(linkDir('')) === 'REFUSE');

// ── (3) canonical URL must serve the EXACT deployed build ──────────────────────────────────
check('alias serves the exact just-deployed bundle → OK',
  aliasVerdict('_expo/static/js/web/entry-abc123.js', '_expo/static/js/web/entry-abc123.js') === 'OK');

// ── (4) NEVER successful if the alias did not move ─────────────────────────────────────────
check('alias still serving the OLD bundle → REFUSED (alias did not move)',
  aliasVerdict('_expo/static/js/web/entry-NEW.js', '_expo/static/js/web/entry-OLD.js') === 'REFUSE');
check('alias unreadable / empty response → REFUSED (never assume success)',
  aliasVerdict('_expo/static/js/web/entry-NEW.js', '') === 'REFUSE');
check('deployed bundle unknown / empty → REFUSED (cannot prove the match)',
  aliasVerdict('', '_expo/static/js/web/entry-OLD.js') === 'REFUSE');

// ── drift guards: the shipping scripts must USE the shared library, not a private copy ──────
const safeDeploy = readFileSync(path.join(REPO, 'scripts', 'safe-deploy.sh'), 'utf8');
const preflight = readFileSync(path.join(REPO, 'scripts', 'preflight-verify.sh'), 'utf8');
const lib = readFileSync(LIB, 'utf8');

check('safe-deploy.sh sources the shared guard library',
  /\.\s+scripts\/deploy-target-guard\.sh/.test(safeDeploy));
check('safe-deploy.sh gates the link via dtg_link_is_canonical',
  /dtg_link_is_canonical/.test(safeDeploy));
check('safe-deploy.sh gates alias propagation via dtg_alias_serves',
  /dtg_alias_serves/.test(safeDeploy));
check('preflight-verify.sh sources the shared guard library',
  /\.\s+scripts\/deploy-target-guard\.sh/.test(preflight));
check('preflight-verify.sh gates the link via dtg_link_is_canonical',
  /dtg_link_is_canonical/.test(preflight));
// No re-inlined divergent link parse left behind in either script (the exact pre-refactor code).
check('no re-inlined require("./.vercel/project.json") link check in safe-deploy.sh',
  !/require\(["']\.\/\.vercel\/project\.json["']\)/.test(safeDeploy));
check('no re-inlined require("./.vercel/project.json") link check in preflight-verify.sh',
  !/require\(["']\.\/\.vercel\/project\.json["']\)/.test(preflight));

// ── constants are the canonical project (the single place they're defined) ─────────────────
check('library pins projectId = prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX',
  lib.includes('DTG_EXPECT_PROJECT_ID="prj_CLp9BxNzT4RmWL9Is1KjHoQlSAlX"'));
check('library pins projectName = ezhalah-app',
  lib.includes('DTG_EXPECT_PROJECT_NAME="ezhalah-app"'));
check('library pins canonical URL = https://ezhalah-app.vercel.app',
  lib.includes('DTG_CANONICAL_URL="https://ezhalah-app.vercel.app"'));

for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }

if (failures > 0) {
  console.error(`\n❌ deploy-target-guard: ${failures} check(s) FAILED — the production-target lock is weakened. Do not merge/deploy.`);
  process.exit(1);
}
console.log('\n✓ deploy-target-guard: all checks passed — ezhalah-app is the only allowed deploy target, and a deploy cannot be reported successful unless the canonical alias serves the exact build.');
