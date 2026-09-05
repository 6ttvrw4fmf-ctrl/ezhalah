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
//   4. THE FLOOR MAY ONLY MOVE THROUGH A NAMED DEPARTURE. The floor is not a number typed here — it
//      is 200 minus BASELINE_DEPARTURES below, and every entry states the script, the PR, its new
//      home, and whether per-PR coverage was LOST. Lowering the floor without adding an entry fails
//      this file, and every run PRINTS the departures so the trade is never tribal knowledge.
//
// THE DISCLOSURE RULE (added 2026-09-03, after a review of PR #1527). A PR that lowers the floor
// MUST say so in its BODY, naming the moved script and its new home. #1527 moved
// verify-af-independent-oracle.ts out of the required `npm test` into af-live-truth-check.yml and
// took the floor 200 → 199; the diff was correct and the justification was sound, but the PR body
// never mentioned it, so the one fact a reviewer most needed — "a check stopped running on PRs" —
// was reachable only by diffing three files. The list below is where that fact now lives.
//
//   node --experimental-strip-types scripts/verify-test-registry-complete.ts   (in `npm test`)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry, argvFor, workflowInvokes } from './lib/testRegistry.ts';

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
// The floor started at 200 (the checks the old `&&` chain ran). It moves ONLY by naming a departure
// here, and the run prints them — so "why is the floor 199?" is answered by running the barrier,
// not by archaeology through three files and a merge commit.
const ORIGINAL_FLOOR = 200;
const BASELINE_DEPARTURES = [
  {
    script: 'verify-af-independent-oracle.ts',
    pr: '#1527',
    date: '2026-09-02',
    home: '.github/workflows/af-oracle-pr-check.yml',
    why: 'wholly live: 9 hand-written PostgREST predicates + the UNKNOWN partition against production '
      + 'through the committed anon key, inside the REQUIRED npm test — the pattern #1486 removed. Unlike '
      + '#1486 there was no offline half to split off and leave behind, so the whole file moved.',
    // Say the cost plainly. A relocation with a real home is not a loss; leaving PRs uncovered is.
    // 2026-09-04: the cost is PAID BACK, not re-narrated. #1527 left the oracle in
    // af-live-truth-check.yml, which has no pull_request trigger, so for two days it gated nothing
    // at review time — recorded here as PARTIAL LOSS. af-oracle-pr-check.yml now runs this one
    // script (7.8s, no browser, no agent message, no secret) on every pull_request, as its own
    // status check outside `npm test`. Both of #1527's properties hold at once: the live call is
    // still not in the required hermetic suite, AND the oracle gates a PR. The floor stays 199
    // because the script is still not RUN BY `npm test` — which is what the baseline measures.
    perPrCoverage: 'NO LOSS — .github/workflows/af-oracle-pr-check.yml runs it on every pull_request (and on '
      + 'push to main, and on dispatch) as its own required status check, retried 3x so a production hiccup '
      + 'cannot fail an unrelated PR. It ALSO still runs post-deploy in af-live-truth-check.yml. Its hermetic '
      + 'siblings verify-af-oracle-filter-translator.ts and verify-af-oracle-soundness.ts stay in npm test, so '
      + 'the oracle LOGIC is gated there and its live AGREEMENT with production is gated here.',
  },
];
const BASELINE_FLOOR = ORIGINAL_FLOOR - BASELINE_DEPARTURES.length;
console.log(`\n  Baseline floor ${BASELINE_FLOOR} = ${ORIGINAL_FLOOR} original − ${BASELINE_DEPARTURES.length} named departure(s):`);
for (const d of BASELINE_DEPARTURES) {
  console.log(`    • ${d.script} — left in ${d.pr} (${d.date}) → ${d.home}`);
  console.log(`      why:  ${d.why}`);
  console.log(`      cost: ${d.perPrCoverage}`);
}
console.log('');
check('the zero-loss baseline is present and substantial', baseline.length >= BASELINE_FLOOR, `${baseline.length} entries`);
// The ledger must describe reality, not intent: a departed script is really gone from the baseline,
// really excluded, and really has the home the entry claims. Otherwise the floor could be lowered by
// writing a paragraph. (Every exclusion's home is separately proven to EXIST in §2 below.)
for (const d of BASELINE_DEPARTURES) {
  check(`departure is out of the baseline: ${d.script}`, !baseline.includes(d.script),
    baseline.includes(d.script) ? 'still in the baseline — raise the floor back instead of listing it here' : '');
  const ex = excluded.find((e) => e.name === d.script);
  check(`departure is a stated exclusion with the home this ledger claims: ${d.script}`,
    !!ex && ex.where === d.home, ex ? `exclusions say ${ex.where}` : 'not in test-exclusions.txt');
  check(`departure states whether per-PR coverage was lost: ${d.script}`,
    /LOSS|NO LOSS/.test(d.perPrCoverage), d.perPrCoverage.slice(0, 60));
}
// A LEDGER LINE IS A CLAIM; EXECUTE IT. «NO LOSS» is only true if the home this entry names really
// is triggered by pull_request and really invokes the script. That is the exact property #1527 lost
// in silence — the entry could have claimed anything and nothing in the repo would have disagreed.
for (const d of BASELINE_DEPARTURES) {
  const homeSrc = existsSync(join(root, d.home)) ? read(d.home) : '';
  // Strip comments at the READER: this repo documents heavily inside workflows, and «pull_request»
  // appears in prose in several of them.
  const code = homeSrc.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#.*$/, '')).join('\n');
  const onPullRequest = /^\s+pull_request:/m.test(code);
  const claimsNoLoss = /NO LOSS/.test(d.perPrCoverage);
  check(`per-PR claim matches the home's actual triggers: ${d.script}`, claimsNoLoss === onPullRequest,
    `${d.perPrCoverage.slice(0, 11)}… but ${d.home} ${onPullRequest ? 'HAS' : 'has NO'} pull_request trigger`);
  check(`the home actually invokes it (not just names it in a comment): ${d.script}`,
    workflowInvokes(homeSrc, d.script), d.home);
}

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
  //
  // THE HOME MUST INVOKE THE SCRIPT, NOT MERELY EXIST (hardened 2026-09-04 by routine #10).
  // This asked `existsSync(home)` for a workflow and `scripts[name] !== undefined` for an npm script
  // — both of which a row can satisfy while naming a place the check never actually runs. That is
  // the shortcut BARRIER_ENGINEER.md §PART 4.7 names by incident: on 2026-09-03 a bare existence/
  // includes test left two checks named only by a workflow COMMENT saying they were deliberately NOT
  // run there, and neither had executed anywhere for weeks. The departures check above was already
  // asking `workflowInvokes()`; the exclusions loop — the bigger list, 39 rows against 4 — was not.
  // Measured before hardening: all 32 workflow-homed rows genuinely invoke their script and all 3
  // npm-script homes genuinely name their file, so this closes the hole without excusing one.
  const wf = e.where.startsWith('.github/') && existsSync(join(root, e.where))
    && workflowInvokes(read(e.where), e.name);
  const npmCmd = e.where.startsWith('npm run ')
    ? (JSON.parse(read('package.json')).scripts ?? {})[e.where.replace('npm run ', '').trim()]
    : undefined;
  const npmScript = typeof npmCmd === 'string' && npmCmd.includes(e.name);
  const manual = /^manual/i.test(e.where);
  check(`exclusion names a home that RUNS it: ${e.name}`, wf || npmScript || manual,
    `${e.where || '(nowhere)'} — the home must actually invoke ${e.name}, not merely exist`);
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

// ── mutation proofs for the exclusion-home rule (added 2026-09-04 by routine #10) ────────────────
// Re-applied to a REAL workflow and a REAL npm script, with the invocation removed.
{
  const mustCatch = (label: string, caught: boolean) =>
    check(`MUTATION catches ${label}`, caught, 'the mutant survived — the home check is blind');

  const sample = excluded.find((e) => e.where.startsWith('.github/'));
  check('there is a workflow-homed exclusion to prove the rule against', !!sample);
  if (sample) {
    const wfSrc = read(sample.where);
    mustCatch(`an exclusion naming a workflow that EXISTS but never invokes it (${sample.name})`,
      workflowInvokes(wfSrc, sample.name)
      && !workflowInvokes(wfSrc.replaceAll(sample.name, 'verify-something-else.ts'), sample.name));
    mustCatch('a home naming the script only inside a YAML COMMENT (the 2026-09-03 incident)',
      !workflowInvokes(`jobs:\n  x:\n    steps:\n      # ${sample.name} is deliberately not run here\n      - run: echo hi\n`,
        sample.name));
    mustCatch(`…while the real home is still accepted, not vacuously red (${sample.where})`,
      workflowInvokes(wfSrc, sample.name));
  }

  const npmRow = excluded.find((e) => e.where.startsWith('npm run '));
  if (npmRow) {
    const cmd = (JSON.parse(read('package.json')).scripts ?? {})[npmRow.where.replace('npm run ', '').trim()];
    mustCatch(`an npm-script home that exists but runs a DIFFERENT file (${npmRow.name})`,
      typeof cmd === 'string' && cmd.includes(npmRow.name)
      && !cmd.replace(npmRow.name, 'verify-something-else.ts').includes(npmRow.name));
  }
}

console.log(`\n  ${run.length} run · ${excluded.length} excluded · ${baseline.length} baseline floor`);
console.log(failures === 0
  ? '✅ verify-test-registry-complete: all checks passed.'
  : `❌ verify-test-registry-complete: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
