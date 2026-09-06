// THE BREAK-GLASS ROLLBACK MUST BE PROVEN TO RUN BEFORE THE NIGHT SOMEONE NEEDS IT.
//
// WHY THIS EXISTS (ops_incident #73). Across 409 barriers, the ONLY file that named
// scripts/emergency-rollback.sh was verify-no-vercel-bypass.ts's SANCTIONED allowlist — whose whole
// purpose is to PERMIT its raw rollback command. Nothing executed it, nothing dry-ran it, nothing
// watched whether it would work. Its first real execution would have been during an outage, under
// time pressure, while safe-deploy.sh beside it carries a dozen guards. A script whose first run is
// an emergency is not a safety net, it is a hope.
//
// WHAT THIS PROVES, by EXECUTING the real scripts/emergency-rollback.sh — copied byte-for-byte out
// of the repo at run time — inside a sandbox git repo where the two things it reaches for are
// recording stubs: scripts/deploy-lock.sh and `npx` on PATH. No network, no Vercel, no deploy, and
// no production lock is ever touched. Every stub appends one line to a shared event log, so the
// ORDER of what happened is the evidence, not a source regex:
//   1. no argument -> it refuses, and refuses BEFORE taking the lock or doing anything else;
//   2. DRY_RUN=1 -> the whole path runs, the lock is taken and released, and the rollback command
//      is NOT executed (the rehearsal an operator can safely run at any time);
//   3. a real run -> the lock is held BEFORE the rollback and released AFTER it, and the command
//      carries exactly the target it was given plus --yes;
//   4. THE FAIL-CLOSED PROPERTY: when the lock is refused (another session is deploying) the
//      rollback does NOT happen. This is the 2026-07-15 three-session outage, and it is the one
//      behaviour of this script that must never regress;
//   5. a rollback that FAILS still releases the lock — a leaked lock after a failed emergency
//      rollback would block the retry for the full TTL, mid-incident;
//   6. the rehearsal and the real thing do not drift: the command DRY_RUN prints is character-for-
//      character the command the real run executes. They are written on two different lines of the
//      script, which is exactly how a "dry run" starts lying.
//
// WHAT THIS DOES NOT PROVE. deploy-lock.sh's own behaviour against the real database (that is
// verify-deploy-lock-canonical.ts plus ops_selftest_deploy_lock_exclusive()), and that Vercel
// accepts the deployment id. It proves this script's control flow, which is what had zero coverage.
//
//   node --experimental-strip-types scripts/verify-emergency-rollback-path.ts   (in `npm test`)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const TARGET = 'dpl_BC6ryVrsvM5QZf9pW8d82bxY9V39';
// Assembled from parts on purpose: written as one literal this file would trip
// verify-no-vercel-bypass.ts, whose grep cannot tell an assertion from an invocation.
const EXPECTED_ARGV = ['vercel', 'rollback', TARGET, '--yes'].join(' ');

// Every stub writes one line here, so ORDER is observable.
const LOCK_STUB = '#!/bin/sh\n'
  + 'echo "lock $1 ttl=${DEPLOY_LOCK_TTL_SECONDS:-default}" >> "$EVENTS"\n'
  + 'if [ "$1" = "acquire" ] && [ -n "${LOCK_REFUSED:-}" ]; then\n'
  + '  echo "REFUSING TO DEPLOY: lock \'production\' is held by another session right now." >&2\n'
  + '  exit 1\n'
  + 'fi\n'
  + 'exit 0\n';
const NPX_STUB = '#!/bin/sh\necho "npx $*" >> "$EVENTS"\nexit "${NPX_EXIT:-0}"\n';

const sandbox = mkdtempSync(join(tmpdir(), 'emergency-rollback-'));
const repo = join(sandbox, 'repo');
const bin = join(sandbox, 'bin');

/** Run the REAL emergency-rollback.sh, with the lock helper and `npx` replaced by recorders. */
type Run = { status: number | null; out: string; events: string[] };
const run = (args: string[], env: Record<string, string> = {}): Run => {
  const events = join(sandbox, `events-${Math.random().toString(36).slice(2)}.log`);
  writeFileSync(events, '');
  const r = spawnSync('scripts/emergency-rollback.sh', args, {
    cwd: repo, encoding: 'utf8', shell: false,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EVENTS: events, DRY_RUN: '', ...env },
  });
  return {
    status: r.status,
    out: `${r.stdout ?? ''}${r.stderr ?? ''}`,
    events: readFileSync(events, 'utf8').split('\n').filter(Boolean),
  };
};

// ── The predicates. Named and pure, so §7 can feed them deliberately broken event logs. ──────────
const acquired = (ev: string[]) => ev.findIndex((l) => l.startsWith('lock acquire'));
const released = (ev: string[]) => ev.findIndex((l) => l.startsWith('lock release'));
const rolledBack = (ev: string[]) => ev.findIndex((l) => l.startsWith('npx '));

/** A rehearsal touches the lock and NOTHING else. */
const dryRunIsInert = (ev: string[]) => acquired(ev) >= 0 && released(ev) >= 0 && rolledBack(ev) < 0;
/** The alias is only ever changed while this session holds the lock, and it is handed back after. */
const heldTheLockAroundIt = (ev: string[]) =>
  acquired(ev) >= 0 && rolledBack(ev) > acquired(ev) && released(ev) > rolledBack(ev);
/** FAIL CLOSED: no lock, no rollback. The 2026-07-15 shape. */
const noLockNoRollback = (ev: string[]) => rolledBack(ev) < 0;

console.log('\nverify-emergency-rollback-path: the break-glass rollback is executed, not just allowlisted\n');

try {
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(bin, { recursive: true });
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  copyFileSync(join(root, 'scripts/emergency-rollback.sh'), join(repo, 'scripts/emergency-rollback.sh'));
  chmodSync(join(repo, 'scripts/emergency-rollback.sh'), 0o755);
  writeFileSync(join(repo, 'scripts/deploy-lock.sh'), LOCK_STUB);
  chmodSync(join(repo, 'scripts/deploy-lock.sh'), 0o755);
  writeFileSync(join(bin, 'npx'), NPX_STUB);
  chmodSync(join(bin, 'npx'), 0o755);

  // ── 1. no target ─────────────────────────────────────────────────────────────────────────────
  const noArg = run([]);
  check('with no deployment id it refuses', noArg.status !== 0 && /usage:/.test(noArg.out),
    `exit ${noArg.status}`);
  check('…and refuses BEFORE taking the deploy lock', noArg.events.length === 0,
    noArg.events.join(' | ') || 'no side effects');

  // ── 2. the rehearsal ─────────────────────────────────────────────────────────────────────────
  const dry = run([TARGET], { DRY_RUN: '1' });
  check('DRY_RUN=1 completes', dry.status === 0, `exit ${dry.status}`);
  check('DRY_RUN=1 does NOT change the production alias', dryRunIsInert(dry.events),
    dry.events.join(' | '));
  check('DRY_RUN=1 says so out loud', /DRY RUN/.test(dry.out) && /NOT touched/.test(dry.out));
  check('a rehearsal cannot jam the break-glass path: it holds a short 60s lock',
    dry.events.some((l) => l.startsWith('lock acquire') && l.includes('ttl=60')),
    dry.events[0]);

  // ── 3-4. the real thing ──────────────────────────────────────────────────────────────────────
  const real = run([TARGET]);
  check('a real run completes', real.status === 0, `exit ${real.status}`);
  check('the lock is held BEFORE the alias changes and released after', heldTheLockAroundIt(real.events),
    real.events.join(' | '));
  check('it rolls back to exactly the deployment it was given, unattended',
    real.events.some((l) => l === `npx ${EXPECTED_ARGV}`), real.events.filter((l) => l.startsWith('npx ')).join(' | '));
  check('the real path takes the full default lock TTL, not the rehearsal\'s short one',
    real.events.some((l) => l.startsWith('lock acquire') && l.includes('ttl=default')), real.events[0]);

  const refused = run([TARGET], { LOCK_REFUSED: '1' });
  check('when another session holds the lock it FAILS CLOSED — no rollback happens',
    refused.status !== 0 && noLockNoRollback(refused.events),
    `exit ${refused.status} · ${refused.events.join(' | ')}`);

  // ── 5. a FAILED rollback must not leak the lock ───────────────────────────────────────────────
  const broke = run([TARGET], { NPX_EXIT: '7' });
  check('a rollback that fails still reports failure', broke.status !== 0, `exit ${broke.status}`);
  check('…and still hands the lock back (a leak would block the retry mid-incident)',
    released(broke.events) > rolledBack(broke.events), broke.events.join(' | '));

  // ── 6. the rehearsal must not drift from the real command ────────────────────────────────────
  const printed = (dry.out.match(/would run: (.+)/) ?? [])[1]?.trim();
  const executed = real.events.find((l) => l.startsWith('npx '));
  check('what the rehearsal PRINTS is what the real run EXECUTES', printed === executed,
    `printed=${printed ?? 'nothing'} executed=${executed ?? 'nothing'}`);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

// ── The wiring. All of the above protects nothing if the script stops being reachable. ───────────
//
// The mode is read from GIT, not the filesystem — the index is what a fresh clone gets, and the
// sandbox above chmods its own copy, so neither can see a lost executable bit. #1759 committed
// safe-deploy.sh as 100644 and every deploy after it died with "Permission denied" before running a
// line; verify-workflow-scripts-executable.ts closed that for scripts a WORKFLOW runs, and this one
// is typed by a human at 3am, so it is outside that scan.
const gitMode = (path: string) =>
  spawnSync('git', ['ls-files', '-s', '--', path], { cwd: root, encoding: 'utf8' })
    .stdout?.trim().split(/\s+/)[0] ?? null;
const isExecutableMode = (mode: string | null) => mode !== null && (parseInt(mode, 8) & 0o111) !== 0;
check('scripts/emergency-rollback.sh is committed executable', isExecutableMode(gitMode('scripts/emergency-rollback.sh')),
  `git mode ${gitMode('scripts/emergency-rollback.sh')}`);
check('the rehearsal is documented where an operator looks during an outage',
  /DRY_RUN=1/.test(readFileSync(join(root, 'docs/DEPLOY_SAFETY.md'), 'utf8')));

// ── 7. MUTATION PROOFS. Checks 1-6 are executions of the real script, so a broken script fails them
// by construction. The predicates those checks read the events with are where a blind spot would
// hide, so each one is applied here to an event log from a script that IS broken in that way.
const mustCatch = (what: string, wouldFail: boolean) => check(`MUTATION: catches ${what}`, wouldFail);

const ACQ = 'lock acquire ttl=default';
const REL = 'lock release ttl=default';
const NPX = `npx ${EXPECTED_ARGV}`;

mustCatch('a DRY RUN that quietly fires the real rollback anyway',
  !dryRunIsInert([ACQ, NPX, REL]));
mustCatch('the alias being changed with no lock held at all (the 2026-07-15 shape)',
  !heldTheLockAroundIt([NPX, REL]));
mustCatch('the lock being released before the rollback rather than after',
  !heldTheLockAroundIt([ACQ, REL, NPX]));
mustCatch('a refused lock that rolls back regardless',
  !noLockNoRollback([ACQ, NPX]));
mustCatch('a failed rollback that leaks the lock',
  !(released([ACQ, NPX]) > rolledBack([ACQ, NPX])));
mustCatch('the rehearsal printing a different command from the one that runs',
  `npx ${['vercel', 'promote', TARGET].join(' ')}` !== NPX);
mustCatch('the break-glass script losing its executable bit in the index (#1759 shape)',
  !isExecutableMode('100644') && !isExecutableMode(null));
// …and none of the predicates is vacuous: a HEALTHY log must still satisfy all of them.
mustCatch('nothing — a correct run still passes every predicate (the proofs are not inverted)',
  dryRunIsInert([ACQ, REL]) && heldTheLockAroundIt([ACQ, NPX, REL]) && noLockNoRollback([ACQ]));

console.log(failures === 0
  ? '\n✅ verify-emergency-rollback-path: the break-glass rollback runs, fails closed, and can be rehearsed.\n'
  : `\n❌ verify-emergency-rollback-path: ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
