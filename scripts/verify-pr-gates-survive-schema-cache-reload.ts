// A CHECK THAT GATES SOMEBODY ELSE'S PR MUST SURVIVE A SCHEMA-CACHE RELOAD (routine #10, 2026-09-23).
//
// MEASURED. At 23:31:46Z scripts/verify-p0-fast-lane-detection.ts reported
// `UNREADABLE — HTTP 503 {"code":"PGRST002"}` on TWO unrelated PRs simultaneously, 96 seconds after
// an unrelated session applied migration 20260923233010. Four function-creating migrations landed
// from three concurrent sessions inside twelve minutes that evening. PGRST002 is PostgREST reloading
// its schema cache, which is what any such migration triggers — so each window fails whoever happens
// to have a PR open, exactly the global blast radius AGENTS.md documents for the drift gate.
//
// WHY NOTHING CAUGHT IT. ops_incident #573 built the repair (scripts/lib/postgrestRetry.ts) and
// wired it into the four live-reaching checks inside the REQUIRED `npm test`. Checks that gate a PR
// from a WORKFLOW have the same blast radius and got nothing. #573's own barrier
// (verify-schema-cache-retry-is-not-fail-open.ts) proves the DRIVER is not fail-open; it says
// nothing about who uses it. A proof about a mechanism is not a measurement of its coverage — the
// PART 1.11 shape, one layer down: the driver existing reads as the class being handled.
//
// REPRODUCED, both directions, against a stub holding PGRST002 for 8 seconds — longer than the old
// 3-attempt/~4.5s budget, shorter than the driver's ~30s:
//     pre-fix  → ✗ UNREADABLE — HTTP 503 {"code":"PGRST002"…}   exit 1   (the CI error, verbatim)
//     post-fix → ✓ every P0-capable detector is on the roster    exit 0
// And fail-closed is NOT softened, proven against a window that never closes (900s):
//     post-fix → ✗ UNREADABLE — HTTP 503 {"code":"PGRST002"…}   exit 1
//
// THIS FILE is the coverage measurement that was missing. It is hermetic — it reads workflow and
// script SOURCE, opens no socket — so it belongs in `npm test`.
//
// Run: node --experimental-strip-types scripts/verify-pr-gates-survive-schema-cache-reload.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';
import {
  hasPullRequestTrigger,
  scriptsInvokedBy,
  unprotectedPrGates,
  type WorkflowFile,
} from './lib/prTriggeredLiveChecks.ts';

// The ratchet. Pinned in SOURCE so a name cannot be appended quietly — the same device
// GRANDFATHERED_CEILING and PRODUCTION_DEPENDENT_CEILING use. 2026-09-23: installed at 3. The class
// had TWO members when this barrier was written; verify-p0-fast-lane-detection.ts — the one that
// actually bit — was repaired in the same change rather than baselined, taking it 2 → 1. Lower it as
// the others adopt the driver; never raise it.
//
// 1 → 0 on 2026-09-26 (routine #5, ops_incident #563). The last row was
// verify-af-independent-oracle.ts, whose own ledger entry said converting it meant threading the
// driver's Probe through two differently-shaped readers and was "a change worth making on its own" —
// so it was made, on the run that found the same class reddening the AF live sweep. At 0 there is no
// ledger left to hide in: a new unprotected PR gate is red on the diff that adds it.
const PR_GATE_UNPROTECTED_CEILING = 0;

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
const WF_DIR = join(ROOT, '.github/workflows');
console.log('\nEvery PR-gating live check survives a schema-cache reload, and that set can only shrink\n');

// ── the world, read once ────────────────────────────────────────────────────────────────────────
const workflows: WorkflowFile[] = readdirSync(WF_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => ({ path: `.github/workflows/${f}`, source: readFileSync(join(WF_DIR, f), 'utf8') }));

const readCheck = (name: string): string | null => {
  const p = join(ROOT, 'scripts', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

check('the workflow directory was readable and non-empty (an unreadable world would pass forever)',
  workflows.length > 0);
check('the trigger reader is not vacuous (it still finds PR-triggered workflows)',
  workflows.some((w) => hasPullRequestTrigger(w.source)));

// ── the declared floor ──────────────────────────────────────────────────────────────────────────
const baselineText = readFileSync(join(ROOT, 'scripts/pr-gate-schema-cache-baseline.txt'), 'utf8');
const baselineRows = baselineText
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const declared = new Set(baselineRows.map((l) => l.split('|')[0].trim()));

// THIS USED TO ASSERT `declared.size > 0`, AND THAT COULD NOT WELCOME ITS OWN PROGRESS
// (repaired 2026-09-26 when the class actually reached zero). The guard exists to catch a ledger
// that silently stopped being READ — an unreadable file, a moved path, a parser that returns nothing
// — because the stale-row check below is vacuous against an empty set. But "some rows exist" is the
// wrong proxy for "the file was read": it also demands the class never be finished, which is the
// AGENTS.md shape where a barrier fails on the very change it exists to encourage.
//
// So: the FILE must be non-empty (an unreadable or truncated ledger is still caught), and every
// non-comment row must carry the documented three fields (a row silently losing its shape would
// otherwise vanish from `declared` and read as progress). An EMPTY class is allowed, and at that
// point PR_GATE_UNPROTECTED_CEILING is 0, which is a strictly stronger position than any ledger.
check('the baseline file was read and is not empty (an unreadable ledger would pass forever)',
  baselineText.trim().length > 0);
const malformed = baselineRows.filter((l) => l.split('|').length < 3);
check('every baseline row carries `check | workflow | what its reads are` (a reshaped row would vanish silently)',
  malformed.length === 0, malformed.join('\n      '));

const unprotected = unprotectedPrGates(workflows, readCheck);
const names = unprotected.map((u) => u.check);

// ── 1. NOTHING NEW. This is what stops the class growing. ───────────────────────────────────────
const undeclared = unprotected.filter((u) => !declared.has(u.check));
check('no NEW PR-gating check reads PostgREST without scripts/lib/postgrestRetry.ts',
  undeclared.length === 0,
  undeclared.map((u) => `${u.check} (run by ${u.workflow}) gates a PR and reads PostgREST without `
    + 'the schema-cache driver, so any session applying a function-creating migration will fail '
    + 'unrelated diffs with PGRST002. Import fetchRetryingSchemaCacheReload — it retries ONLY a 503 '
    + 'whose JSON code is exactly PGRST002, is bounded, and returns the last probe as-is, so it '
    + 'cannot make your check more permissive about anything. Do NOT add a baseline row, and do NOT '
    + 'drop the pull_request trigger to make this green.').join('\n      '));

// ── 2. THE RATCHET. ─────────────────────────────────────────────────────────────────────────────
const exceedsCeiling = (n: number) => n > PR_GATE_UNPROTECTED_CEILING;
check(`the unprotected set has not grown (${unprotected.length} <= ${PR_GATE_UNPROTECTED_CEILING})`,
  !exceedsCeiling(unprotected.length),
  'raising PR_GATE_UNPROTECTED_CEILING is a reviewable source change; adopting the driver is the fix.');

// ── 3. NO STALE ROWS. A ledger that over-reports hides real growth. ─────────────────────────────
const stale = [...declared].filter((n) => !names.includes(n));
check('no baseline row names a check that is already protected (stale rows must be deleted)',
  stale.length === 0,
  stale.map((n) => `${n} no longer needs its row — delete it, or this ratchet reads worse than `
    + 'reality and a genuine regression can hide underneath it').join('\n      '));

check('this check runs in `npm test` (asked with npmTestRuns, not a grep over package.json)',
  npmTestRuns(ROOT, 'verify-pr-gates-survive-schema-cache-reload'));

console.log(`\n  PR-gating workflows: ${workflows.filter((w) => hasPullRequestTrigger(w.source)).length} `
  + `· unprotected PR gates: ${unprotected.length} (ceiling ${PR_GATE_UNPROTECTED_CEILING})\n`);

// ── MUTATION PROOF — the real predicate, against worlds it must judge ───────────────────────────
console.log('  mutation proof — unprotectedPrGates(), against a world that must be caught\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

const PR_WF = { path: 'w.yml', source: 'on:\n  pull_request:\n\njobs:\n  a:\n    steps:\n      - run: node scripts/verify-x.ts\n' };
const CRON_WF = { path: 'c.yml', source: "on:\n  schedule:\n    - cron: '0 1 * * *'\n\njobs:\n  a:\n    steps:\n      - run: node scripts/verify-x.ts\n" };
const NAKED = "await fetch(`${U}/rest/v1/rpc/f`)";
const DRIVEN = "import { fetchRetryingSchemaCacheReload } from './lib/postgrestRetry.ts';\n" + NAKED;
const HERMETIC = "const x = readFileSync('a.ts');";

mustCatch('a PR-gating check that reads PostgREST with no driver — THE DEFECT that bit today',
  unprotectedPrGates([PR_WF], () => NAKED).length === 1);
mustCatch('…while the same check WITH the driver is NOT flagged (the rule is not vacuously red)',
  unprotectedPrGates([PR_WF], () => DRIVEN).length === 0);
mustCatch('a hermetic PR-gating check that never reads PostgREST is NOT flagged',
  unprotectedPrGates([PR_WF], () => HERMETIC).length === 0);
mustCatch('a SCHEDULE-only workflow is out of the population (it blocks nobody\'s merge)',
  unprotectedPrGates([CRON_WF], () => NAKED).length === 0);
mustCatch('a check named only in a YAML COMMENT is not treated as run (the 2026-09-03 shape)',
  unprotectedPrGates(
    [{ path: 'w.yml', source: 'on:\n  pull_request:\n# deliberately NOT run here: scripts/verify-x.ts\n' }],
    () => NAKED).length === 0);
mustCatch('an UNREADABLE check is reported, never skipped as healthy',
  unprotectedPrGates([PR_WF], () => null).length === 1);
mustCatch('the same check reached from two PR workflows is reported ONCE, not twice',
  unprotectedPrGates([PR_WF, { ...PR_WF, path: 'w2.yml' }], () => NAKED).length === 1);
mustCatch('the ceiling predicate catches the set GROWING',
  exceedsCeiling(PR_GATE_UNPROTECTED_CEILING + 1));
mustCatch('…and the set SHRINKING is NOT a failure (this ratchet must welcome its own progress)',
  !exceedsCeiling(PR_GATE_UNPROTECTED_CEILING - 1));
mustCatch('scriptsInvokedBy strips comments before looking (a mention is not a run)',
  scriptsInvokedBy('# scripts/verify-a.ts\nrun: node scripts/verify-b.ts').join() === 'verify-b.ts');
mustCatch('the REAL repaired check is no longer in the unprotected set (the fix that shipped today)',
  !names.includes('verify-p0-fast-lane-detection.ts'));
// The negative control this barrier earned on its own first run. A bare /\/rest\/v1\//.test(source)
// counted scripts/verify-web-runtime-smoke.mjs, whose only matches are Playwright INTERCEPTION
// patterns — they name a path and call nothing, and a browser's own requests cannot be routed
// through a Node driver anyway. That false positive went onto the baseline before the predicate was
// narrowed to arguments of a real network call; a ratchet that over-reports hides real growth.
mustCatch('a Playwright route INTERCEPTION naming /rest/v1/ is not mistaken for a PostgREST read',
  unprotectedPrGates([PR_WF], () => "await page.route('**/rest/v1/rpc/f', r => r.abort());").length === 0);
mustCatch('…while a real fetch of the SAME path in the same file still counts',
  unprotectedPrGates([PR_WF],
    () => "await page.route('**/rest/v1/rpc/f', r => r.abort());\nawait fetch(`${U}/rest/v1/rpc/f`);").length === 1);

const ok = failed === 0 && mutFail === 0;
console.log(
  ok
    ? '\n✓ no PR gate can be reddened by somebody else\'s migration without this file going red first'
    : `\n✗ ${failed} failure(s), ${mutFail} mutation(s) survived`,
);
process.exit(ok ? 0 : 1);
