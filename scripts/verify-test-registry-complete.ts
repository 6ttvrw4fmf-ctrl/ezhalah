// NO CHECK MAY GO DARK — the registry, the exclusions and what actually runs must stay in sync.
//
// WHY THIS EXISTS (owner-approved 2026-08-28)
// ------------------------------------------
// `npm test` used to be a single 201-command `&&` chain on one line of package.json. Every routine
// adding a barrier edited that line, so concurrent sessions conflicted essentially every time — PR
// #1196 took five conflict rounds, #1177 three. The chain is now replaced by discovery: a check runs
// BECAUSE IT EXISTS on disk (scripts/lib/testRegistry.ts).
//
// Discovery removes the conflict but introduces a new way to lose a test — a rename, a bad glob, an
// over-broad exclusion — so it is only safe with this guard. Three properties, all fail-closed:
//
//   1. THE BASELINE IS A FLOOR. Every one of the 201 checks the old chain ran must still be
//      discovered and run. A test can therefore only be removed by deleting its baseline line: a
//      deliberate, reviewed act, never a side effect. This is the "no test may silently disappear"
//      requirement, enforced permanently rather than checked once at migration time.
//   2. EVERY EXCLUSION IS JUSTIFIED AND REAL. An excluded check must name a reason AND a place it
//      actually runs, that place must exist, and the file itself must exist — so the exclusions file
//      cannot become a graveyard, and cannot quietly retire a check by naming nowhere.
//   3. THE RUNNER IS THE ONLY ENTRY POINT. package.json's "test" must invoke the runner and must NOT
//      regrow an inline chain, or the hotspot comes straight back.
//
//   node --experimental-strip-types scripts/verify-test-registry-complete.ts   (in `npm test`)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, argvFor } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('verify-test-registry-complete: every check on disk either runs or is excluded with a');
console.log('  stated home, and nothing the old chain ran has gone missing.');

const { run, excluded, baseline } = loadRegistry(root);
const runSet = new Set(run);

// ── 1. THE BASELINE FLOOR ────────────────────────────────────────────────────────────────────────
check('the zero-loss baseline is present and substantial', baseline.length >= 200, `${baseline.length} entries`);
const missing = baseline.filter((b) => !runSet.has(b));
check('EVERY baseline check is still discovered and run (no test silently disappeared)',
  missing.length === 0,
  missing.length ? `MISSING: ${missing.join(', ')}` : `all ${baseline.length} still run`);

// A baseline entry whose file is gone is a deletion that skipped review.
const onDisk = new Set(readdirSync(join(root, 'scripts')).filter((f) => /^verify-.*\.(ts|mjs)$/.test(f)));
const vanished = baseline.filter((b) => !onDisk.has(b));
check('no baseline check has been deleted from disk without removing its baseline line',
  vanished.length === 0, vanished.join(', ') || 'none');

// ── 2. EXCLUSIONS ARE JUSTIFIED, REAL, AND NOT A HIDING PLACE ────────────────────────────────────
check('there is at least one exclusion (live checks legitimately cannot run in npm test)', excluded.length > 0);
for (const e of excluded) {
  check(`exclusion is a real file: ${e.name}`, onDisk.has(e.name), onDisk.has(e.name) ? '' : 'no such file — stale exclusion');
  check(`exclusion states a reason: ${e.name}`, e.reason.length >= 15, e.reason || '(empty)');
  // "where it runs instead" must be a workflow that exists, an npm script that exists, or an
  // explicit admission that nothing schedules it — never a comforting blank.
  const wf = e.where.startsWith('.github/') && existsSync(join(root, e.where));
  const npmScript = e.where.startsWith('npm run ')
    && Object.keys(JSON.parse(read('package.json')).scripts ?? {}).includes(e.where.replace('npm run ', '').trim());
  const manual = /^manual/i.test(e.where);
  check(`exclusion names a home that exists: ${e.name}`, wf || npmScript || manual, e.where || '(nowhere)');
}
// An exclusion must never cover a check the baseline says must run — that is the contradiction that
// would let someone retire a guaranteed test by adding one line.
const contradiction = excluded.filter((e) => baseline.includes(e.name));
check('no exclusion contradicts the baseline floor', contradiction.length === 0,
  contradiction.map((e) => e.name).join(', ') || 'none');

// ── 3. EVERY FILE IS ACCOUNTED FOR, ONE WAY OR THE OTHER ─────────────────────────────────────────
const exNames = new Set(excluded.map((e) => e.name));
const orphans = [...onDisk].filter((f) => !runSet.has(f) && !exNames.has(f));
check('every verify-* file on disk either RUNS or is explicitly excluded (none merely forgotten)',
  orphans.length === 0, orphans.join(', ') || `${onDisk.size} files all accounted for`);

// ── 4. THE RUNNER IS THE ONLY ENTRY POINT ────────────────────────────────────────────────────────
const testScript = JSON.parse(read('package.json')).scripts.test as string;
check('package.json "test" invokes the runner', /run-tests\.mjs/.test(testScript), testScript.slice(0, 90));
check('package.json "test" has NOT regrown an inline chain (the conflict hotspot)',
  (testScript.match(/scripts\/verify-/g) ?? []).length === 0,
  `${(testScript.match(/scripts\/verify-/g) ?? []).length} inline verify-* invocation(s)`);
const runner = read('scripts/run-tests.mjs');
// STRICT equality to 0 is the whole mechanism, and it is why a signal-killed child cannot pass:
// spawnSync reports `status === null` when a child dies on a signal (timeout, OOM), and `null === 0`
// is false, so the run fails. A looser form — `r.status !== 0` is equivalent, but `!r.status` or a
// truthiness test would let null through as "no error". Assert the mechanism, not the vocabulary:
// an earlier version of this check merely grepped for `r.signal`, which matched the text inside an
// error MESSAGE and stayed green when the failure RECORD dropped it. A check that matches incidental
// prose is not a check.
const okLine = runner.match(/const ok = ([^;]+);/)?.[1]?.trim() ?? '';
check('the runner decides pass/fail by strict equality to exit code 0',
  okLine === 'r.status === 0', `const ok = ${okLine || '(not found)'}`);
check('…so a signal-killed child (status === null) cannot be counted as a pass',
  okLine === 'r.status === 0' && !/!r\.status|r\.status \?\?/.test(runner));
check('the runner refuses to report success over an empty run set', /run\.length === 0/.test(runner));
check('the runner uses the shared registry rather than its own list', /loadRegistry/.test(runner));

// ── 5. NO CHECK MAY ASSERT ITS OWN WIRING BY STRING-MATCHING package.json ────────────────────────
// Fifteen barriers proved their own liveness with `pkg.includes('verify-me')` against the mega
// chain. That predicate is now false for EVERY check in the suite, and the naive repair is worse
// than the break: matching `run-tests` instead would pass for every file including one nothing
// runs — a wiring check that cannot fail, on barriers whose whole point is noticing a dark check.
// `npmTestRuns()` asks the registry the question they meant to ask. Reading package.json for a real
// reason (a dependency, a script name) stays fine; asserting one's own wiring from it does not.
const selfWiring: string[] = [];
for (const f of onDisk) {
  const src = read(`scripts/${f}`);
  const bare = f.replace(/\.(ts|mjs)$/, '');
  // Only the file's own name matters: a check legitimately asserting that some OTHER script is
  // wired is a different (and rarer) thing, and would still be caught by that script's own guard.
  const asserts = new RegExp(`(pkg|package\\.json'?,? ?'?utf8'?\\))[^\\n]{0,120}${bare}|${bare}[^\\n]{0,120}\\.test\\(pkg\\)`);
  if (asserts.test(src)) selfWiring.push(f);
}
check('no check proves its own wiring by string-matching package.json (it must ask npmTestRuns)',
  selfWiring.length === 0,
  selfWiring.join(', ') || `${onDisk.size} files clean`);

// ── 6. THE INVOCATION IS RIGHT FOR EACH FILE TYPE ────────────────────────────────────────────────
check('.ts checks are invoked with type stripping', argvFor('verify-x.ts').includes('--experimental-strip-types'));
check('.mjs checks are invoked without it', !argvFor('verify-x.mjs').includes('--experimental-strip-types'));
check('the run order is deterministic (sorted)', run.join(',') === [...run].sort().join(','));

console.log(`\n  ${run.length} run · ${excluded.length} excluded · ${baseline.length} baseline floor`);
console.log(failures === 0
  ? '✅ verify-test-registry-complete: all checks passed.'
  : `❌ verify-test-registry-complete: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
