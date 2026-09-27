// NO LIVE CHECK ANYWHERE IN THE FLEET MAY BE TURNED INTO A FALSE VERDICT BY SOMEBODY ELSE'S MIGRATION
// (routine #10, 2026-09-26, ops_incident #794 — routed here by routine #5).
//
// THE CLASS, and why this is the THIRD file about it. PGRST002 is PostgREST reloading its schema
// cache, which ANY function-creating migration triggers; for a few seconds every read answers 503.
// A live check that reads PostgREST without routing through scripts/lib/postgrestRetry.ts therefore
// has a verdict partly decided by whoever applied a migration in the last minute.
//
//   * ops_incident #573 built the driver and adopted it in the four live-reaching checks inside the
//     required `npm test`. It stopped there.
//   * scripts/verify-pr-gates-survive-schema-cache-reload.ts measured the PR-GATING population,
//     because a red there blocks a contributor. Its header reasons that a scheduled workflow "wakes
//     an owner and blocks nobody", so schedule-only workflows were deliberately out.
//   * scripts/verify-af-live-checks-survive-schema-cache-reload.ts measured ONE schedule-only
//     workflow — af-live-truth-check.yml — after that premise failed there: its reds are accusations
//     against the product, and its P1 had stood open and re-affirmed daily for 22 days.
//
// Each layer proved a mechanism and then measured only its OWN population. Nothing measured whether
// every population was measured, so the remainder kept being discovered by the next incident instead
// of by a check. THIS FILE IS THE COMPLEMENT, and it is defined as one: its population is «every
// workflow that invokes a PostgREST-reading check, minus the two already measured». There is no
// enumeration to keep up to date, so a workflow added tomorrow lands HERE rather than nowhere —
// AGENTS.md's enumerate-vs-discover rule, applied to the populations themselves.
//
// MEASURED the morning it landed: NINETEEN unprotected checks across twelve workflows. Eighteen
// adopted the driver in the same change (fix first — a found gap is not a finished job), leaving one
// row in scripts/fleet-live-schema-cache-baseline.txt with its reason stated there.
//
// A MEASUREMENT THAT CORRECTED ITSELF, recorded because it is the whole hazard in miniature. The
// first count taken here was FOURTEEN workflows and eighteen checks. Two separate errors:
//   1. the probe called transitivelyReaches() without its readFile/resolveFrom arguments, so the
//      `driven` arm threw and every check read as undriven. A probe that cannot see protection
//      reports the class as larger than it is — the harmless direction, and still wrong.
//   2. after the eighteen adopted `postgrestFetch`, the population fell from fourteen workflows to
//      ONE, because scripts/lib/liveReach.ts's NETWORK_CALLS knew only the name `fetch`. The correct
//      repair read as the entire class disappearing. Both wrapper names are in that list now.
// Neither number is quotable from this comment. Read what the check PRINTS.
//
// WHAT THIS FILE IS. Hermetic: it reads workflow and script SOURCE and walks the module graph. It
// opens no socket, so it belongs in `npm test` and its verdict depends only on the diff.
//
// Run: node --experimental-strip-types scripts/verify-fleet-live-checks-survive-schema-cache-reload.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { transitivelyReaches } from './lib/importGraph.ts';
import { networkCallArguments } from './lib/liveReach.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  hasPullRequestTrigger,
  scriptsInvokedBy,
  unprotectedChecksIn,
  type WorkflowFile,
} from './lib/prTriggeredLiveChecks.ts';

// THE RATCHET, pinned in SOURCE so a name cannot be appended quietly — the same device
// GRANDFATHERED_CEILING, PR_GATE_UNPROTECTED_CEILING, AF_LIVE_UNPROTECTED_CEILING and
// PRODUCTION_DEPENDENT_CEILING use.
//
// Installed at 1 on 2026-09-26, down from the nineteen measured that morning. ONE is not a target
// and not an acceptance — it is the honest size of the class after the same change repaired
// everything it could, recorded so it cannot grow while nobody is counting. LOWER IT; NEVER RAISE IT.
const FLEET_UNPROTECTED_CEILING = 1;

// The two populations already measured by their own ratchets. Each carve-out must name a barrier
// that EXISTS and that `npm test` really RUNS — otherwise this complement is excluding a population
// nothing counts, which is the exact defect this file exists to end.
const CARVE_OUTS = [
  { what: 'the AF/Trending live sweep', workflow: '.github/workflows/af-live-truth-check.yml',
    barrier: 'verify-af-live-checks-survive-schema-cache-reload.ts' },
  { what: 'every PR-gating workflow', workflow: null,
    barrier: 'verify-pr-gates-survive-schema-cache-reload.ts' },
] as const;

const AF_SUITE = CARVE_OUTS[0].workflow;
const LEDGER = 'scripts/fleet-live-schema-cache-baseline.txt';
const DRIVER = 'lib/postgrestRetry.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
const WF_DIR = join(ROOT, '.github/workflows');
console.log('\nEvery live check outside the two measured populations survives a schema-cache reload, and that set can only shrink\n');

const workflows: WorkflowFile[] = readdirSync(WF_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ path: `.github/workflows/${f}`, source: readFileSync(join(WF_DIR, f), 'utf8') }));

const readFile = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const readCheck = (name: string): string | null => readFile(join(ROOT, 'scripts', name));
const resolveFrom = (from: string, spec: string): string => resolve(dirname(from), spec);
const entry = (name: string) => join(ROOT, 'scripts', name);

// ── the two graph-walked arms, shared with the sibling ratchets rather than re-derived ───────────
/** Reaches the ONE measured driver through its imports, at any depth. Cycle-safe. */
const driven = (name: string): boolean =>
  transitivelyReaches(entry(name), (f) => f.replace(/\\/g, '/').endsWith(DRIVER), readFile, resolveFrom);

/**
 * This check, or a module it imports, really FETCHES a /rest/v1/ path.
 *
 * networkCallArguments() is imported, never re-implemented: it distinguishes a real call from a
 * Playwright `page.route('**\/rest/v1/…')` INTERCEPTION, which names a path and calls nothing. That
 * negative control was earned by the PR-gate ratchet's first run and re-deriving it here would be the
 * hand-copied-logic class.
 */
const reads = (name: string): boolean =>
  transitivelyReaches(
    entry(name),
    (f) => {
      const src = readFile(f);
      return src !== null && networkCallArguments(src).some((a) => a.includes('/rest/v1/'));
    },
    readFile,
    resolveFrom,
  );

// ── THE POPULATION, DEFINED AS A COMPLEMENT ─────────────────────────────────────────────────────
const inPopulation = (wf: WorkflowFile) => wf.path !== AF_SUITE && !hasPullRequestTrigger(wf.source);

// ── sanity: a renamed or unreadable world must not pass forever ──────────────────────────────────
check('the workflow directory was read and holds workflows', workflows.length > 20, `found ${workflows.length}`);
check('the driver module is present at the path both arms look for', existsSync(join(ROOT, 'scripts', DRIVER)));
check(`the AF suite named as a carve-out still exists (${AF_SUITE})`,
  workflows.some((w) => w.path === AF_SUITE),
  'if it was renamed, this complement silently absorbed its population and this ceiling is wrong');
check('at least one workflow in this population invokes a check at all (a vacuous population would pass forever)',
  workflows.filter(inPopulation).some((w) => scriptsInvokedBy(w.source).length > 0));

// ── EVERY CARVE-OUT MUST POINT AT A BARRIER THAT EXISTS AND RUNS ─────────────────────────────────
// This is the structural half. Excluding a population is only honest if something else counts it.
for (const c of CARVE_OUTS) {
  check(`the carve-out for ${c.what} names a barrier that exists (${c.barrier})`,
    existsSync(join(ROOT, 'scripts', c.barrier)));
  check(`…and \`npm test\` really RUNS it (npmTestRuns, not a grep over package.json)`,
    npmTestRuns(ROOT, c.barrier.replace(/\.ts$/, '')),
    `${c.barrier} is named as measuring a population this file excludes, but nothing runs it — so that `
    + 'population is counted by nobody. Either wire it back in or delete the carve-out.');
}

const unprotected = unprotectedChecksIn(workflows, readCheck, inPopulation, { driven, reads });

// ── the declared floor ──────────────────────────────────────────────────────────────────────────
const ledgerText = readFileSync(join(ROOT, LEDGER), 'utf8');
const rows = ledgerText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const declared = new Set(rows.map((l) => l.split('|')[0]!.trim()));
check(`the ledger file was read and is not empty (${LEDGER})`, ledgerText.trim().length > 0);
const malformed = rows.filter((l) => l.split('|').length < 2);
check('every ledger row carries `check | why it is still here` (a reshaped row would vanish silently)',
  malformed.length === 0, malformed.join('\n      '));
const ghosts = [...declared].filter((n) => !existsSync(join(ROOT, 'scripts', n)));
check('every ledger row names a file that exists', ghosts.length === 0, ghosts.join(', '));

// ── 1. NOTHING NEW. This is what stops the class growing. ───────────────────────────────────────
const undeclared = unprotected.filter((u) => !declared.has(u.check));
check('no NEW live check outside the two measured populations reads PostgREST without the driver',
  undeclared.length === 0,
  undeclared.map((u) => `${u.check} (invoked by ${u.workflow}) reads PostgREST without reaching `
    + 'scripts/' + DRIVER + ', so any session applying a function-creating migration can make it '
    + 'accuse the product. Adopt it by changing ONE identifier: `await fetch(` -> `await '
    + "postgrestFetch(`, importing { postgrestFetch } from './lib/postgrestRetry.ts'. It retries ONLY "
    + 'a 503 whose JSON code is exactly PGRST002, on ONE bounded budget, and returns the LAST probe '
    + 'as-is, so it cannot make your check more permissive about anything else. Do NOT add a ledger '
    + 'row, and do NOT remove the alert bridge to make this green.').join('\n      '));

// ── 2. THE RATCHET. ─────────────────────────────────────────────────────────────────────────────
const exceedsCeiling = (n: number) => n > FLEET_UNPROTECTED_CEILING;
check(`the unprotected set has not grown (${unprotected.length} <= ${FLEET_UNPROTECTED_CEILING})`,
  !exceedsCeiling(unprotected.length),
  'raising FLEET_UNPROTECTED_CEILING is a reviewable source change; adopting the driver is the fix.');

// ── 3. THE LEDGER MAY NOT READ BETTER THAN THE TREE. ────────────────────────────────────────────
// A row for a check that HAS adopted the driver is RED as stale — otherwise the ledger keeps taking
// credit for a repair and the real count drifts below it unnoticed, which is how a floor becomes a
// story about the past.
const stale = [...declared].filter((n) => !unprotected.some((u) => u.check === n));
check('no ledger row is STALE (a check that has adopted the driver must leave this file)',
  stale.length === 0,
  stale.map((n) => `${n} now routes through the driver — delete its row and let the count fall`).join('\n      '));

console.log(`\n  population: ${workflows.filter(inPopulation).length} workflow(s) · unprotected: `
  + `${unprotected.length} (ceiling ${FLEET_UNPROTECTED_CEILING}) · ledger rows: ${declared.size}`);

// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
// Each applies THIS file's own predicates to a broken world. The synthetic worlds hand
// unprotectedChecksIn its sources directly, which is what the PR-gate ratchet's own proofs do — the
// graph arms are optional there for exactly this reason.
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  ok  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  (mutation) BLIND to ${label}`);
};

const SCHEDULED = (name: string): WorkflowFile => ({
  path: '.github/workflows/new-sweep.yml',
  source: `on:\n  schedule:\n    - cron: '0 6 * * *'\njobs:\n  x:\n    steps:\n      - run: node --experimental-strip-types scripts/${name}\n`,
});
const NAKED = "await fetch(`${U}/rest/v1/rpc/f`);";
const DRIVEN_SRC = `import { postgrestFetch } from './lib/postgrestRetry.ts';\nawait postgrestFetch(\`\${U}/rest/v1/rpc/f\`);`;
const world = (src: string | null) => unprotectedChecksIn([SCHEDULED('verify-new.ts')], () => src, inPopulation);

// the healthy control: a check that really adopted the driver is NOT flagged
mustCatch('…while a check that DOES route through the driver is NOT flagged (the rule is not vacuously red)',
  world(DRIVEN_SRC).length === 0);
mustCatch('a NEW schedule-only workflow whose check reads PostgREST nakedly — the recurrence this complement exists for',
  world(NAKED).length === 1);
mustCatch('an UNREADABLE check reported rather than assumed clean (a rule that treats «I could not look» as «nothing wrong» is the manufactured negative)',
  world(null).length === 1);
mustCatch('a check that merely MENTIONS a /rest/v1 path without calling anything is NOT flagged (a Playwright interception is not a read)',
  world("await page.route('**/rest/v1/rpc/f', (r) => r.abort());").length === 0);
mustCatch('the ceiling being exceeded',
  exceedsCeiling(FLEET_UNPROTECTED_CEILING + 1));
mustCatch('…while the ceiling being UNDERSHOT is allowed — the direction this ratchet exists to encourage',
  !exceedsCeiling(FLEET_UNPROTECTED_CEILING - 1));
// The complement must really be a complement: the two carve-outs, and nothing else, are excluded.
mustCatch('a PR-gating workflow staying OUT of this population (it is measured by its own ratchet)',
  !inPopulation({ path: '.github/workflows/x.yml', source: 'on:\n  pull_request:\n' }));
mustCatch('the AF suite staying OUT of this population (same reason)',
  !inPopulation({ path: AF_SUITE, source: 'on:\n  schedule:\n    - cron: 0 6 * * *\n' }));
mustCatch('…and ANY OTHER workflow being INSIDE it, which is what makes this a complement rather than a third list',
  inPopulation(SCHEDULED('verify-new.ts')) && inPopulation({ path: '.github/workflows/anything.yml', source: 'on:\n  workflow_dispatch:\n' }));
// The ledger cannot read better than the tree.
const staleOf = (declaredNames: string[], stillUnprotected: string[]) =>
  declaredNames.filter((n) => !stillUnprotected.includes(n));
mustCatch('a STALE ledger row — a check that has been fixed but is still counted (the ledger reading better than reality)',
  staleOf(['verify-a.ts'], []).length === 1);
mustCatch('…while a row that is genuinely still unprotected is NOT called stale',
  staleOf(['verify-a.ts'], ['verify-a.ts']).length === 0);

if (mutFail) { console.error(`\n✗ ${mutFail} mutation(s) went UNCAUGHT — a predicate above cannot fail`); process.exit(1); }
if (failed) { console.error(`\n✗ ${failed} check(s) FAILED`); process.exit(1); }
console.log('\n✅ no live check outside the two measured populations can be reddened into a false verdict by somebody else\u2019s migration without this file going red first');
