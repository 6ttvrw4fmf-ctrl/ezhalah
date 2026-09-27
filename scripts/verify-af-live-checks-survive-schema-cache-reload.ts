// THE AF LIVE SWEEP MUST NOT REPORT SOMEBODY ELSE'S MIGRATION AS AN AF DEFECT
// (routine #5, 2026-09-26, ops_incident #563 · alert 1434).
//
// THE DEFECT, measured on production. `af-live-truth-check.yml` run 36230103230 (head c532f96) had
// five red steps. Reading the jobs rather than inferring from the log tail, the failures were:
//
//     FAIL  Warehouse/Buy: cell completed without a harness error
//     FAIL  Warehouse/RentAnnual: …          ← all three at 10:05:48–49Z, i.e. CONCURRENCY=3 at once
//     FAIL  Workshop/Buy: …
//           HTTP 503: {"code":"PGRST002","message":"Could not query the database for the schema
//                      cache. Retrying."}
//     FAIL  Villa/Buy @region:1 · amenities(chat-only):separate_electricity_meter
//     Error: RPC location_search_candidates_ar 503: {"code":"PGRST002"…}   ← killed that whole sweep
//
// Five `wahadat_*` migrations landed between 09:40 and 10:13 that morning — another routine
// onboarding a platform, wiring functions into search. PGRST002 is PostgREST reloading its schema
// cache, which is what ANY function-creating migration triggers. So an ordinary, correct piece of
// someone else's work made this suite name healthy AF cohorts as defective, and 5,527 real passing
// checks were thrown away with the sweep that crashed.
//
// WHY THIS IS WORTH A BARRIER RATHER THAN THREE FIXES. This workflow's only channel to a human is an
// `alert_event` row, so a red does not block anything and nobody is forced to look: the P1
// `af_live_check_failed` had stood open and been re-affirmed daily since 2026-09-04. Twenty-two days
// of an AF live gate whose verdict was partly decided by whoever applied a migration in the last
// minute — which is the state in which a GENUINE AF regression arrives and is not noticed.
//
// WHY NOTHING CAUGHT IT, and this is the third time this exact shape has been written down:
//   * ops_incident #573 built the driver (scripts/lib/postgrestRetry.ts) and adopted it in the four
//     live-reaching checks inside the required `npm test`. It stopped there.
//   * routine #10 then measured the PR-GATING population (verify-pr-gates-survive-schema-cache-
//     reload.ts), because a red there blocks a contributor. Its header reasons that a scheduled
//     workflow "wakes an owner and blocks nobody", so schedule-only workflows are deliberately out.
//   * That premise is the gap. This suite wakes nobody EITHER, and its reds are accusations against
//     the product rather than a stalled merge. Different harm, not smaller.
// Each layer proved a mechanism; none measured who uses it. AGENTS.md calls that the PART 1.11 shape
// — a pointer reads as coverage — and this file is the missing measurement for my own population.
//
// WHAT THIS FILE IS. Hermetic: it reads workflow and script SOURCE and walks the module graph. It
// opens no socket, so it belongs in `npm test` and its verdict depends only on the diff.
//
// THE PREDICATE IS COMPUTED, NOT GREPPED, and that was earned on this very change. The text arms in
// scripts/lib/prTriggeredLiveChecks.ts are blind to one hop: after the three repairs moved their
// reads onto scripts/lib/afLiveProbe.ts (which imports the driver), a single-file `from
// 'lib/postgrestRetry.ts'` test called all three UNPROTECTED, and `readsPostgrest` then called two of
// them non-readers because their own `fetch(` calls were gone. Together those arms would have
// punished the correct refactor and rewarded copy-pasting an import next to a hand-rolled budget. So
// both arms here walk the real module graph via scripts/lib/importGraph.ts.
//
// Run: node --experimental-strip-types scripts/verify-af-live-checks-survive-schema-cache-reload.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { transitivelyReaches } from './lib/importGraph.ts';
import { networkCallArguments } from './lib/liveReach.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  scriptsInvokedBy,
  unprotectedChecksIn,
  type WorkflowFile,
} from './lib/prTriggeredLiveChecks.ts';

// The workflow this routine owns: the AF + Trending live sweep, which raises alert_event on failure.
const SUITE = '.github/workflows/af-live-truth-check.yml';

// THE RATCHET, pinned in SOURCE so a name cannot be appended quietly — the same device
// PR_GATE_UNPROTECTED_CEILING, GRANDFATHERED_CEILING and PRODUCTION_DEPENDENT_CEILING use.
//
// Installed at 19 on 2026-09-26. The suite had TWENTY-TWO members that morning by the graph-walked
// arm; the three with measured production evidence were repaired in the same change rather than
// baselined (verify-af-full-surface-differential.ts, verify-af-matrix-truth-live.ts,
// verify-af-independent-oracle.ts), taking it 22 → 19 — and one of those three was also routine
// #10's last PR-gate ledger row, which reached 0 the same day.
//
// THE NUMBER IS 19 AND NOT 17 BECAUSE THE ARM WALKS THE GRAPH. A single-file scan for `fetch(`
// counted 17; asking the module graph "does this check, or anything it imports, really fetch a
// /rest/v1/ path" named three more (verify-af-agent-cta-live.ts, verify-af-card-evidence-live.ts,
// verify-combined-budget-live.ts) and also revealed one row as already protected. The first draft of
// this file was installed at 17 and this barrier refused it — which is the ratchet earning its keep
// on its own author before it ever saw a real regression.
//
// LOWER IT AS THE REST ADOPT THE DRIVER; NEVER RAISE IT. Nineteen is not a target and not an
// acceptance — it is the honest size of the class on the day it was first measured, recorded so it
// cannot grow while nobody is counting.
const AF_LIVE_UNPROTECTED_CEILING = 19;

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
const WF_DIR = join(ROOT, '.github/workflows');
console.log('\nEvery AF/Trending live check survives a schema-cache reload, and that set can only shrink\n');

// ── the world, read once ────────────────────────────────────────────────────────────────────────
const workflows: WorkflowFile[] = readdirSync(WF_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ path: `.github/workflows/${f}`, source: readFileSync(join(WF_DIR, f), 'utf8') }));

const readFile = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const readCheck = (name: string): string | null => readFile(join(ROOT, 'scripts', name));
const resolveFrom = (from: string, spec: string): string => resolve(dirname(from), spec);

// ── the two graph-walked arms ───────────────────────────────────────────────────────────────────
const DRIVER = 'lib/postgrestRetry.ts';
const entry = (name: string) => join(ROOT, 'scripts', name);

/** Reaches the ONE measured driver through its imports, at any depth. Cycle-safe. */
const driven = (name: string): boolean =>
  transitivelyReaches(entry(name), (f) => f.replace(/\\/g, '/').endsWith(DRIVER), readFile, resolveFrom);

/**
 * This check, or a module it imports, really FETCHES a /rest/v1/ path.
 *
 * The per-file arm is networkCallArguments(), imported rather than re-implemented: it distinguishes a
 * real call from a Playwright `page.route('**\/rest/v1/…')` INTERCEPTION, which names a path, calls
 * nothing, and could not be routed through a Node driver anyway. That negative control was earned by
 * the PR-gate ratchet's own first run, and re-deriving it here would be the hand-copied-logic class.
 */
const readsPostgrestDeep = (name: string): boolean =>
  transitivelyReaches(
    entry(name),
    (f) => {
      const src = readFile(f);
      return src !== null && networkCallArguments(src).some((a) => a.includes('/rest/v1/'));
    },
    readFile,
    resolveFrom,
  );

const inSuite = (wf: WorkflowFile) => wf.path === SUITE;

// ── sanity: an unreadable or renamed world must not pass forever ─────────────────────────────────
const suite = workflows.find(inSuite);
check(`the suite workflow exists and was read (${SUITE})`, !!suite && suite.source.length > 0);
const invoked = suite ? scriptsInvokedBy(suite.source) : [];
check('the suite invokes checks (a workflow that ran nothing would pass vacuously)', invoked.length > 5,
  `found ${invoked.length}`);
check('this suite really does raise alert_event on failure — the premise of the whole rule',
  !!suite && /raise-workflow-alert|mon_raise|alert_event/.test(suite.source.replace(/^\s*#.*$/gm, '')),
  'if this workflow stopped bridging its result to alert_event, its reds would reach nobody at all '
  + 'and that is a bigger finding than this file measures');
check('the driver module itself is present at the path both arms look for',
  existsSync(join(ROOT, 'scripts', DRIVER)));

const unprotected = unprotectedChecksIn(workflows, readCheck, inSuite, { driven, reads: readsPostgrestDeep });
const names = unprotected.map((u) => u.check);

// ── the declared floor ──────────────────────────────────────────────────────────────────────────
const LEDGER = 'scripts/af-live-schema-cache-baseline.txt';
const ledgerText = readFileSync(join(ROOT, LEDGER), 'utf8');
const rows = ledgerText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const declared = new Set(rows.map((l) => l.split('|')[0].trim()));
check(`the ledger file was read and is not empty (${LEDGER})`, ledgerText.trim().length > 0);
const malformed = rows.filter((l) => l.split('|').length < 2);
check('every ledger row carries `check | what its reads are` (a reshaped row would vanish silently)',
  malformed.length === 0, malformed.join('\n      '));

// ── 1. NOTHING NEW. This is what stops the class growing. ───────────────────────────────────────
const undeclared = unprotected.filter((u) => !declared.has(u.check));
check('no NEW check in this suite reads PostgREST without the schema-cache driver',
  undeclared.length === 0,
  undeclared.map((u) => `${u.check} reads PostgREST without reaching scripts/lib/postgrestRetry.ts, so `
    + 'any session applying a function-creating migration can make it accuse the product. Import '
    + 'scripts/lib/afLiveProbe.ts (afProbeOk / afRpcOk): it retries ONLY a 503 whose JSON code is '
    + 'exactly PGRST002, on ONE measured budget, and raises SchemaCacheUnresolved when even that is '
    + 'outlasted so the cell is reported UNMEASURED instead of as a cohort defect. It cannot make your '
    + 'check more permissive about anything else. Do NOT add a ledger row, and do NOT remove the '
    + 'alert bridge to make this green.').join('\n      '));

// ── 2. THE RATCHET. ─────────────────────────────────────────────────────────────────────────────
const exceedsCeiling = (n: number) => n > AF_LIVE_UNPROTECTED_CEILING;
check(`the unprotected set has not grown (${unprotected.length} <= ${AF_LIVE_UNPROTECTED_CEILING})`,
  !exceedsCeiling(unprotected.length),
  'raising AF_LIVE_UNPROTECTED_CEILING is a reviewable source change; adopting the driver is the fix.');

// ── 3. NO STALE ROWS. A ledger that over-reports hides real growth underneath it. ───────────────
const stale = [...declared].filter((n) => !names.includes(n));
check('no ledger row names a check that is already protected (stale rows must be deleted)',
  stale.length === 0,
  stale.map((n) => `${n} no longer needs its row — delete it, and lower the ceiling, or this ratchet `
    + 'reads worse than reality').join('\n      '));

// ── 4. THE THREE REPAIRED TODAY MUST STAY REPAIRED. ─────────────────────────────────────────────
//
// NOT REDUNDANT WITH 1–3, and the mutation proofs measured exactly why. Reverting
// verify-af-matrix-truth-live.ts's driver import tripped ONLY this assertion: with the import gone,
// its reads sit behind helper names that `networkCallArguments` does not recognise as network calls,
// so the population arm no longer counted it as a reader at all and it fell out of 1–3 silently.
// A check can therefore leave this class by becoming UNREADABLE to the population arm rather than by
// being fixed — so the three with measured evidence are pinned by name as well as by rule.
for (const n of ['verify-af-full-surface-differential.ts', 'verify-af-matrix-truth-live.ts', 'verify-af-independent-oracle.ts']) {
  check(`${n} still routes its reads through the driver (repaired 2026-09-26 on production evidence)`,
    driven(n), 'this is one of the three with a measured production failure — a regression here is the '
    + 'defect itself coming back, not a new finding');
}

check('this check runs in `npm test` (asked with npmTestRuns, not a grep over package.json)',
  npmTestRuns(ROOT, 'verify-af-live-checks-survive-schema-cache-reload'));

console.log(`\n  suite checks invoked: ${invoked.length} · unprotected: ${unprotected.length} `
  + `(ceiling ${AF_LIVE_UNPROTECTED_CEILING}) · declared: ${declared.size}\n`);

// ── MUTATION PROOFS — the real predicates, against worlds they must judge ───────────────────────
console.log('  mutation proof — the real rule, against worlds it must catch\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// A synthetic module graph, so these proofs never touch the filesystem.
const graphOf = (files: Record<string, string>) => {
  const read = (p: string): string | null => files[p.replace(/\\/g, '/')] ?? null;
  const rf = (from: string, spec: string) => resolve(dirname(from), spec).replace(/\\/g, '/');
  return {
    driven: (n: string) => transitivelyReaches(`/s/${n}`, (f) => f.endsWith(DRIVER), read, rf),
    reads: (n: string) => transitivelyReaches(`/s/${n}`, (f) => {
      const s = read(f);
      return s !== null && networkCallArguments(s).some((a) => a.includes('/rest/v1/'));
    }, read, rf),
  };
};
const SUITE_WF: WorkflowFile = {
  path: SUITE,
  source: 'on:\n  schedule:\n    - cron: \'0 9 * * *\'\njobs:\n  a:\n    steps:\n      - run: node scripts/verify-x.ts\n',
};
const OTHER_WF: WorkflowFile = {
  path: '.github/workflows/unrelated.yml',
  source: 'on:\n  schedule:\n    - cron: \'0 9 * * *\'\njobs:\n  a:\n    steps:\n      - run: node scripts/verify-x.ts\n',
};
const NAKED = { '/s/verify-x.ts': 'await fetch(`${U}/rest/v1/rpc/f`);' };
const DIRECT = {
  '/s/verify-x.ts': "import { fetchRetryingSchemaCacheReload } from './lib/postgrestRetry.ts';\nawait fetch(`${U}/rest/v1/rpc/f`);",
  '/s/lib/postgrestRetry.ts': 'export const x = 1;',
};
// The refactor this rule must NOT punish: reads behind a shared module that imports the driver.
const VIA_WRAPPER = {
  '/s/verify-x.ts': "import { afProbeOk } from './lib/afLiveProbe.ts';\nawait afProbeOk('a', `${U}/rest/v1/rpc/f`);",
  '/s/lib/afLiveProbe.ts': "import { fetchRetryingSchemaCacheReload } from './postgrestRetry.ts';\nawait fetch(url);",
  '/s/lib/postgrestRetry.ts': 'export const x = 1;',
};
// The dangerous near-miss: a shared reader that does NOT reach the driver. Must still be caught.
const VIA_UNDRIVEN_WRAPPER = {
  '/s/verify-x.ts': "import { read } from './lib/myReader.ts';\nawait read(`${U}/rest/v1/rpc/f`);",
  '/s/lib/myReader.ts': 'export const read = (u) => fetch(`${u}/rest/v1/x`);',
};
const HERMETIC = { '/s/verify-x.ts': "const x = readFileSync('a.ts');" };

const runOn = (files: Record<string, string>, wfs: WorkflowFile[] = [SUITE_WF]) =>
  unprotectedChecksIn(wfs, (n) => files[`/s/${n}`] ?? null, inSuite, graphOf(files));

mustCatch('a suite check that reads PostgREST with no driver — THE DEFECT that bit on production',
  runOn(NAKED).length === 1);
mustCatch('…while the same check importing the driver DIRECTLY is not flagged (not vacuously red)',
  runOn(DIRECT).length === 0);
mustCatch('…and reads behind a SHARED READER that imports the driver are not flagged either — the '
  + 'one-hop case the text arms got wrong on this very change',
  runOn(VIA_WRAPPER).length === 0);
mustCatch('a shared reader that does NOT reach the driver is still caught (the dangerous near-miss: '
  + 'it LOOKS like the good refactor)',
  runOn(VIA_UNDRIVEN_WRAPPER).length === 1);
mustCatch('a hermetic check that never reads PostgREST is not flagged',
  runOn(HERMETIC).length === 0);
mustCatch('a check run by some OTHER workflow is out of this population (that is another owner\'s ledger)',
  runOn(NAKED, [OTHER_WF]).length === 0);
mustCatch('an UNREADABLE check is reported, never skipped as healthy',
  runOn({}).length === 1);
mustCatch('a check named only in a YAML COMMENT is not treated as run (the 2026-09-03 shape)',
  unprotectedChecksIn(
    [{ path: SUITE, source: 'on:\n  schedule:\n# deliberately NOT run here: scripts/verify-x.ts\n' }],
    (n) => NAKED[`/s/${n}`] ?? null, inSuite, graphOf(NAKED)).length === 0);
mustCatch('a Playwright route INTERCEPTION naming /rest/v1/ is not mistaken for a PostgREST read',
  runOn({ '/s/verify-x.ts': "await page.route('**/rest/v1/rpc/f', r => r.abort());" }).length === 0);
mustCatch('…while a real fetch of the SAME path in the same file still counts',
  runOn({ '/s/verify-x.ts': "await page.route('**/rest/v1/rpc/f', r => r.abort());\nawait fetch(`${U}/rest/v1/rpc/f`);" }).length === 1);
mustCatch('the ceiling predicate catches the set GROWING',
  exceedsCeiling(AF_LIVE_UNPROTECTED_CEILING + 1));
mustCatch('…and the set SHRINKING is not a failure (this ratchet must welcome its own progress — the '
  + 'assertion the PR-gate sibling had to have repaired when its own class reached zero)',
  !exceedsCeiling(AF_LIVE_UNPROTECTED_CEILING - 1));
mustCatch('an import CYCLE between two readers does not hang the walk',
  runOn({
    '/s/verify-x.ts': "import { a } from './lib/a.ts';\nawait fetch(`${U}/rest/v1/f`);",
    '/s/lib/a.ts': "import { b } from './b.ts';\nexport const a = 1;",
    '/s/lib/b.ts': "import { a } from './a.ts';\nexport const b = 1;",
  }).length === 1);

const ok = failed === 0 && mutFail === 0;
console.log(
  ok
    ? '\n✓ no AF/Trending live check can be reddened into a false product verdict by somebody else\'s migration without this file going red first\n'
    : `\n✗ ${failed} failure(s), ${mutFail} mutation(s) survived\n`,
);
process.exit(ok ? 0 : 1);
