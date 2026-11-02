// SAFE-DEPLOY CATCHES UP WHEN MAIN MOVED WHILE IT WAS CHECKING (2026-11-02).
//
// deploy-frontend.yml checks out main, then spends minutes on npm ci, preflight and `npm run verify`.
// Whenever a PR merged in that window, HEAD sat one commit BEHIND origin/main and the exact-match gate
// refused a perfectly good deploy — 3 of the 10 refusals sampled on 2026-11-02, each one an hour of
// users not getting a merged fix. `catch_up_with_origin_main()` in scripts/safe-deploy.sh closes the
// race: a CLEAN checkout that is an ANCESTOR of origin/main is fast-forwarded and the script re-runs
// itself ONCE from the top (every gate runs against the commit that is really deployed). Everything
// else — diverged, dirty, a second move — still refuses exactly as before.
//
// This EXECUTES the real function, lifted out of safe-deploy.sh, inside a throw-away git repo with a
// bare origin, and asserts every branch of that decision; then it plants the mutant (no ancestor /
// no clean-tree guard) and proves the same scenarios catch it.
//
//   node --experimental-strip-types scripts/verify-safe-deploy-catches-up-with-main.ts   (in `npm test`)

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (p: string) => p.replace(/\\/g, '/');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const sd = readFileSync(join(root, 'scripts/safe-deploy.sh'), 'utf8');
const fn = sd.match(/^catch_up_with_origin_main\(\) \{[\s\S]*?^\}/m)?.[0] ?? '';
check('safe-deploy.sh defines catch_up_with_origin_main()', fn.length > 0);

console.log('\n── wiring: it runs before the lock and again at the exact-match gate ──');
const lockAt = sd.indexOf('scripts/deploy-lock.sh acquire');
const firstCall = sd.indexOf('\ncatch_up_with_origin_main ""');
const gateCall = sd.indexOf('catch_up_with_origin_main "${HOLDER:-}"');
const refusal = sd.indexOf('REFUSING TO DEPLOY: local main ($LOCAL) does not match origin/main ($REMOTE)');
check('called once before the deploy lock is taken', firstCall > 0 && firstCall < lockAt);
check('called again (releasing the lock it holds) right before the exact-match gate', gateCall > lockAt && gateCall < refusal);
check('the exact-match refusal is still there (a diverged HEAD is still refused)', refusal > 0);
check('a re-run is marked so it can never loop', /EZ_SAFE_DEPLOY_CAUGHT_UP=1 exec/.test(fn));

// ── a throw-away repo: bare origin with two commits on main, a clone sitting one commit behind ──
type Scenario = { name: string; prepare: (clone: string) => void; env?: Record<string, string>; holder?: string };
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

const run = (body: string, s: Scenario) => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-catchup-'));
  const origin = join(dir, 'origin.git'); const clone = join(dir, 'clone'); const stub = join(dir, 'self.sh');
  git(dir, 'init', '--bare', '-b', 'main', origin);
  git(dir, 'clone', '-q', origin, clone);
  git(clone, 'checkout', '-q', '-b', 'main');
  // the lock stub is TRACKED (committed in «one»): an untracked file would read as a dirty tree
  mkdirSync(join(clone, 'scripts'));
  writeFileSync(join(clone, 'scripts/deploy-lock.sh'), '#!/usr/bin/env bash\necho "$1 $2" >> "$(git rev-parse --show-toplevel)/../lock.log"\n');
  writeFileSync(join(clone, 'a.txt'), '1\n'); git(clone, 'add', '.'); git(clone, 'commit', '-q', '-m', 'one');
  writeFileSync(join(clone, 'a.txt'), '2\n'); git(clone, 'add', '.'); git(clone, 'commit', '-q', '-m', 'two');
  git(clone, 'push', '-q', '-u', 'origin', 'main');
  const tip = git(clone, 'rev-parse', '--short', 'HEAD');
  git(clone, 'reset', '-q', '--hard', 'HEAD~1');
  const behind = git(clone, 'rev-parse', '--short', 'HEAD');
  writeFileSync(stub, '#!/usr/bin/env bash\necho "RESTARTED caught_up=${EZ_SAFE_DEPLOY_CAUGHT_UP:-} head=$(git rev-parse --short HEAD)"\n');
  s.prepare(clone);
  const harness = `set -euo pipefail\ncd "${posix(clone)}"\nSAFE_DEPLOY_SELF="${posix(stub)}"\nSAFE_DEPLOY_ARGS=()\n${body}\ncatch_up_with_origin_main "${s.holder ?? ''}"\necho "RETURNED head=$(git rev-parse --short HEAD)"\n`;
  const r = spawnSync('bash', ['-c', harness], { env: { ...process.env, ...(s.env ?? {}) }, encoding: 'utf8' });
  let lock = ''; try { lock = readFileSync(join(dir, 'lock.log'), 'utf8'); } catch { /* not released */ }
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), status: r.status, tip, behind, lock, head: git(clone, 'rev-parse', '--short', 'HEAD') };
};

const scenarios = {
  behind: { name: 'clean + behind', prepare: () => {} } as Scenario,
  behindHolder: { name: 'clean + behind, holding the lock', prepare: () => {}, holder: 'safe-deploy:test-7' } as Scenario,
  again: { name: 'already restarted once', prepare: () => {}, env: { EZ_SAFE_DEPLOY_CAUGHT_UP: '1' } } as Scenario,
  diverged: { name: 'diverged (a local commit origin does not have)', prepare: (c: string) => { writeFileSync(join(c, 'b.txt'), 'x\n'); git(c, 'add', '.'); git(c, 'commit', '-q', '-m', 'local'); } } as Scenario,
  dirty: { name: 'dirty tree', prepare: (c: string) => writeFileSync(join(c, 'untracked.txt'), 'x\n') } as Scenario,
  equal: { name: 'already at origin/main', prepare: (c: string) => git(c, 'reset', '-q', '--hard', 'origin/main') } as Scenario,
};

console.log('\n── executed: the real function in a throw-away repo ──');
{
  const r = run(fn, scenarios.behind);
  check('clean + behind → fast-forwards to origin/main and restarts from the top',
    r.status === 0 && r.head === r.tip && /RESTARTED caught_up=1 head=/.test(r.out) && new RegExp(`head=${r.tip}`).test(r.out) && !/RETURNED/.test(r.out), r.out);
  check('…and says so', /main moved while we were checking/.test(r.out));
}
{
  const r = run(fn, scenarios.behindHolder);
  check('a held deploy lock is released before the restart (the re-run takes it again)', /^release safe-deploy:test-7/m.test(r.lock), JSON.stringify(r.lock));
}
{
  const r = run(fn, scenarios.again);
  check('a SECOND move is not chased: no fast-forward, no restart — the exact-match gate refuses',
    r.status === 0 && r.head === r.behind && !/RESTARTED/.test(r.out) && /RETURNED/.test(r.out), r.out);
}
{
  const r = run(fn, scenarios.diverged);
  check('diverged → untouched (the exact-match gate refuses, as before)',
    r.status === 0 && !/RESTARTED/.test(r.out) && /RETURNED/.test(r.out) && r.head !== r.tip, r.out);
}
{
  const r = run(fn, scenarios.dirty);
  check('dirty tree → untouched (the clean-tree gate refuses, as before)',
    r.status === 0 && r.head === r.behind && !/RESTARTED/.test(r.out), r.out);
}
{
  const r = run(fn, scenarios.equal);
  check('already equal → nothing happens', r.status === 0 && !/RESTARTED/.test(r.out) && /RETURNED/.test(r.out), r.out);
}

console.log('\n── mutation: a function that fast-forwards without the guards is caught ──');
{
  const mutant = fn
    .replace('[ -z "$(git status --short)" ]', 'true')
    .replace('git merge-base --is-ancestor "$head" "$remote" 2>/dev/null', 'true');
  check('(mutation) the mutant differs from the real function', mutant !== fn);
  const dirty = run(mutant, scenarios.dirty);
  check('(mutation) no clean-tree guard → a dirty tree restarts — caught', /RESTARTED/.test(dirty.out) || dirty.status !== 0);
  const div = run(mutant, scenarios.diverged);
  check('(mutation) no ancestor guard → a diverged HEAD fails or restarts — caught', div.status !== 0 || /RESTARTED/.test(div.out));
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ safe-deploy.sh catches up with a moved main, once, and only when it is safe');
process.exit(failed ? 1 : 0);
