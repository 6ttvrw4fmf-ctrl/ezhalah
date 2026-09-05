// THE BASELINE MUST STILL BE RECORDED WHEN A DIRECT PUSH TO MAIN IS REFUSED.
//
// WHY THIS EXISTS. docs/DEPLOY_BASELINE.txt is the safety floor: preflight-verify.sh refuses to
// deploy anything that does not CONTAIN the recorded commit. It sat at 254baca from 2026-09-01 to
// 2026-09-04 while production moved three times, because the step that advances it had never once
// been executed — the only way to run it was to deploy production, which AGENTS.md forbids doing as
// a test. PR #1747 fixed the SILENT half (a `git commit` that died on "Author identity unknown" was
// printing the same line a healthy no-op prints). The PUSH half was still fiction: `git push origin
// main` from a runner is refused by branch protection, and this repo's GITHUB_TOKEN is read-only by
// default, so it could not have worked. The baseline advanced that day only because a human carried
// it in a hand-written PR.
//
// WHAT THIS PROVES, by EXECUTING scripts/record-deploy-baseline.sh — the real file safe-deploy.sh
// calls — against a local bare repo whose pre-receive hook refuses refs/heads/main exactly the way
// GitHub's protection does (GH006). No network, no GitHub, no deploy:
//   1. a refused push to main is NOT the end: the one-file commit reaches a `deploy/baseline-*`
//      branch, which is what a baseline PR is opened from;
//   2. when the PR cannot be opened at all (no gh, no token) the script FAILS LOUDLY — exit 1 and
//      the exact phrase deploy-frontend.yml's Report step greps for. Silence here is the original
//      defect and must never come back;
//   3. it leaves the checkout on origin/main with a clean tree — a local baseline commit left
//      behind would make the NEXT preflight refuse to deploy (HEAD == origin/main is one of its
//      gates), i.e. a "fix" that jams the pipeline;
//   4. the happy path still works where a direct push is allowed (a laptop run), and
//   5. re-recording the same SHA is a no-op, not a duplicate commit.
// Plus the wiring: safe-deploy.sh must actually call it, or all of the above protects nothing.
//
//   node --experimental-strip-types scripts/verify-baseline-record-path.ts   (in `npm test`)

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...ID, ...args], { cwd, encoding: 'utf8' }).trim();

const sandbox = mkdtempSync(join(tmpdir(), 'baseline-record-'));
const remote = join(sandbox, 'remote.git');
const work = join(sandbox, 'work');
const PROTECT = '#!/bin/sh\nwhile read o n r; do if [ "$r" = "refs/heads/main" ]; then\n'
  + 'echo "remote: error: GH006: Protected branch update failed for refs/heads/main." >&2; exit 1; fi; done\n';

/** Run the REAL script the way safe-deploy.sh runs it, with no GitHub credentials in scope. */
const record = (arg: string) => {
  const r = spawnSync('scripts/record-deploy-baseline.sh', [arg], {
    cwd: work, encoding: 'utf8', shell: false,
    env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '', BASELINE_PR_TOKEN: '' },
  });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

console.log('\nverify-baseline-record-path: the deploy baseline is recorded even under branch protection\n');

try {
  execFileSync('git', ['init', '--bare', '-b', 'main', '-q', remote]);
  execFileSync('git', ['clone', '-q', remote, work]);
  mkdirSync(join(work, 'docs'), { recursive: true });
  mkdirSync(join(work, 'scripts'), { recursive: true });
  writeFileSync(join(work, 'docs/DEPLOY_BASELINE.txt'), `${'0'.repeat(40)}\n# approved baseline log\n`);
  copyFileSync(join(root, 'scripts/record-deploy-baseline.sh'), join(work, 'scripts/record-deploy-baseline.sh'));
  chmodSync(join(work, 'scripts/record-deploy-baseline.sh'), 0o755);
  git(work, 'add', '-A');
  git(work, 'commit', '-qm', 'init');
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(work, 'branch', '-q', '--set-upstream-to=origin/main', 'main');

  // ── 1-3. main is PROTECTED and no PR can be opened (no gh token in this environment) ──────────
  writeFileSync(join(remote, 'hooks/pre-receive'), PROTECT);
  chmodSync(join(remote, 'hooks/pre-receive'), 0o755);
  const sha1 = '1'.repeat(40);
  const refused = record(sha1);
  check('a refused push to main does NOT pass silently', refused.status === 1, `exit ${refused.status}`);
  check('it prints the phrase the deploy report greps for',
    refused.out.includes('REFUSING TO ADVANCE THE BASELINE'), refused.out.split('\n').slice(-1)[0]);
  check('it names the stale floor and the SHA production actually serves',
    refused.out.includes('0000000') && refused.out.includes(sha1.slice(0, 7)));
  const heads = git(work, 'ls-remote', '--heads', remote);
  check('the baseline commit still reached a branch a PR can be opened from',
    heads.includes(`refs/heads/deploy/baseline-${sha1.slice(0, 7)}`), heads.replace(/\s+/g, ' ').slice(0, 120));
  check('the checkout is left clean (a leftover commit would jam the NEXT preflight)',
    git(work, 'status', '--porcelain') === '' && git(work, 'rev-parse', 'HEAD') === git(work, 'rev-parse', 'origin/main'));

  // ── 4. the same act where a direct push IS allowed (a laptop run) ─────────────────────────────
  rmSync(join(remote, 'hooks/pre-receive'));
  const sha2 = '2'.repeat(40);
  const pushed = record(sha2);
  check('where a direct push to main is allowed, the baseline advances', pushed.status === 0
    && pushed.out.includes('pushed to main'), `exit ${pushed.status}`);
  check('and the pushed file really records the deployed commit',
    git(work, 'show', 'origin/main:docs/DEPLOY_BASELINE.txt').startsWith(sha2));

  // ── 5. recording the same SHA twice is a no-op, not a duplicate commit ────────────────────────
  const before = git(work, 'rev-parse', 'HEAD');
  const again = record(sha2);
  check('re-recording the same SHA is a no-op', again.status === 0
    && again.out.includes('nothing to commit') && git(work, 'rev-parse', 'HEAD') === before);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

// ── 6. THE WIRING. All of the above protects nothing if safe-deploy.sh stopped calling it. ───────
const safeDeploy = readFileSync(join(root, 'scripts/safe-deploy.sh'), 'utf8')
  .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // strip comments at the READER
check('safe-deploy.sh actually runs the recorder (not just mentions it in a comment)',
  /^\s*scripts\/record-deploy-baseline\.sh\s+"\$LOCAL"/m.test(safeDeploy));
check('safe-deploy.sh does NOT keep its own inline baseline push (one recorder, one behaviour)',
  !/git push origin main/.test(safeDeploy));

console.log(failures === 0
  ? '\n✅ verify-baseline-record-path: the baseline is recorded, or the run goes red saying it was not.\n'
  : `\n❌ verify-baseline-record-path: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
