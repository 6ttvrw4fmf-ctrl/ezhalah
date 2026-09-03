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
import { createHash } from 'node:crypto';
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

// ── (5) the served BYTES must be the artifact the filename names ───────────────────────────
// Added 2026-09-03 with the run-33776354197 fix. The old gate's only expected-hash source was the
// per-deployment URL, which deployment protection makes unreadable (HTTP 302 → sso-api), so it fell
// back to "the alias hash must DIFFER from the pre-deploy hash" — unsatisfiable for a byte-identical
// rebuild, which is why 14+ healthy deploys went red and the baseline stopped advancing. The gate now
// takes the expected hash from THIS run's build log and proves the served bytes really are it. These
// checks are offline: they build a file, name it after its own md5, and mutate it.
const md5 = (buf: Buffer | string) => createHash('md5').update(buf).digest('hex');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'dtg-bundle-'));
tmpDirs.push(bundleDir);
const bytes = 'globalThis.x=1;//' + 'a'.repeat(500);
const realName = `_expo/static/js/web/entry-${md5(bytes)}.js`;
const goodFile = path.join(bundleDir, 'good.js');
writeFileSync(goodFile, bytes);
const badFile = path.join(bundleDir, 'bad.js');
writeFileSync(badFile, bytes + '//tampered');
const emptyFile = path.join(bundleDir, 'empty.js');
writeFileSync(emptyFile, '');
const authVerdict = (file: string, name: string) =>
  dtg(`dtg_bundle_is_authentic "${file}" "${name}" && echo OK || echo REFUSE`);

check('bundle hash is lifted from an Expo entry filename',
  dtg(`dtg_bundle_hash "_expo/static/js/web/entry-a4fd39e6c124093c973a94c8f097ac18.js"`) === 'a4fd39e6c124093c973a94c8f097ac18');
check('a non-entry path yields no hash (cannot be mistaken for a bundle)',
  dtg(`dtg_bundle_hash "index.html"`) === '');
check('bytes whose md5 IS the filename hash → AUTHENTIC (an identical rebuild still passes)',
  authVerdict(goodFile, realName) === 'OK');
check('tampered/stale bytes under the right filename → REFUSED',
  authVerdict(badFile, realName) === 'REFUSE');
check('empty body (truncated CDN read) → REFUSED',
  authVerdict(emptyFile, realName) === 'REFUSE');
check('unparseable bundle name → REFUSED (never assume authenticity)',
  authVerdict(goodFile, 'index.html') === 'REFUSE');

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
// The expected hash MUST come from this run's own build log — the one source that is readable when
// the per-deployment URL is behind deployment protection, and that is correct for an identical
// rebuild. Reverting to a deployment-URL-only expectation reintroduces the run-33776354197 deadlock.
check('safe-deploy.sh takes the expected bundle from THIS run\'s build log (EMITTED_BUNDLE)',
  /EMITTED_BUNDLE="\$\(grep -oE '_expo\/static\/js\/web\/entry-\[a-f0-9\]\+\\\.js' "\$DEPLOY_LOG"/.test(safeDeploy)
  && /EXPECTED_BUNDLE="\$\{EMITTED_BUNDLE:-\$NEW_BUNDLE\}"/.test(safeDeploy));
check('safe-deploy.sh proves the served bytes are that artifact (dtg_bundle_is_authentic)',
  /dtg_bundle_is_authentic/.test(safeDeploy));
// Non-weakening: the gate must stay BLOCKING and must have no escape hatch.
check('the alias/bundle gate still fails the deploy (blocking, no bypass flag)',
  /REFUSING TO ADVANCE THE BASELINE: the canonical alias never proved/.test(safeDeploy)
  && !/SKIP_ALIAS_CHECK|ALLOW_STALE_ALIAS|--force-baseline/.test(safeDeploy));
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
