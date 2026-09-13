// THERE ARE TWO ROUTES FROM THE REQUIRED SUITE TO PRODUCTION. THE RATCHET COUNTED ONE.
//
// WHY THIS EXISTS (routine #10, ops_incident #244, measured 2026-09-13).
//
// scripts/verify-required-suite-is-hermetic.ts is the ratchet that stops production-dependent checks
// entering the REQUIRED `npm test`. It discovers them by walking the TypeScript MODULE GRAPH for
// scripts/lib/public-supabase.ts, and its header states that file is "the ONE canonical way a check
// obtains the live endpoint".
//
// That premise is FALSE. A check can spawn `python3`, which imports `scrapers.common.db`, which
// builds a live Supabase client straight out of the environment:
//
//     scrapers/common/db.py:93-95
//         url = os.environ["SUPABASE_URL"]
//         key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
//         _client = create_client(url, key)
//
// No TypeScript import is involved anywhere on that path, so `transitivelyReaches()` cannot see it.
// Measured 2026-09-13: 22 checks in the required suite take the python route and are therefore not
// CANDIDATES at all — they can never appear in scripts/live-reaching-required-checks.txt, and the
// ratchet prints "production-dependent: 4 (ceiling 4)" beside them while reading as a complete
// census of production-reaching checks in the required suite.
//
// This is the routine-10 shape in its purest form: coverage that reads as protection while
// protecting one of two paths. The number was not wrong about what it measured; it was wrong about
// what it appeared to measure.
//
// THE MEASUREMENT, AND WHAT IT FOUND (completed 2026-09-13, ops_incident #244).
//
// All 22 were measured by the documented method — run the check normally, run it again with the
// endpoint blackholed (SUPABASE_URL=https://127.0.0.1:9), compare exit codes; different codes mean
// production-dependent. **All 22 are OFFLINE-SAFE**: normal=0 and blackhole=0 for every one.
//
// The comparison is NON-DEGENERATE, which is the part that makes it worth anything. A check that is
// already failing fails identically blackholed, so "same exit code" from a red check measures
// nothing. Six of the 22 were red on the first attempt — not for any reason of their own, but
// because the container's `supabase` python package was half-installed and `from supabase import
// Client` resolved to "unknown location". Measuring them in that state and recording offline-safe
// would have been a verdict taken from a broken instrument. They were re-measured against a clean
// virtualenv, where all six PASS normally and PASS blackholed.
//
// WHY THE ANSWER IS THE REASSURING ONE, mechanically rather than by luck: IMPORTING IS NOT CALLING.
// scrapers/common/db.py builds its client lazily, inside a function, so importing the module never
// opens a connection. These 22 import the seam to INSPECT it — AST reads, function inspection, stubs
// — and never call it. Confirmed independently: not one of the 22 reads SUPABASE_URL or
// SUPABASE_SERVICE_ROLE_KEY anywhere, so none of them can be branching on credentials and skipping
// its assertions when they are absent, which is the way a check could pass here vacuously.
//
// So the required suite is NOT secretly production-dependent through this route. That is a real
// result and not a shrug: the census was wrong about its SCOPE, and now that the second route is
// measured, the census is honest. NO ceiling was raised and NO check was loosened to get here.
//
// WHAT STAYS ENFORCED. Each declared name carries its measured verdict below, and a name arriving
// with no verdict is RED. So a NEW python-route check cannot enter the required suite on the
// assumption that it is like the others: it has to be measured, exactly as the TypeScript route's
// ledger requires. If one ever measures PRODUCTION-DEPENDENT, it is split — the hermetic predicate
// stays in `npm test`, the live assertion moves to a workflow home — never weakened.
//
//   node --experimental-strip-types scripts/verify-python-route-to-production-is-declared.ts

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  mutation caught: ${label}`);
  if (!caught) failed++;
};

console.log('\nThe python route from the required suite to production is declared and can only shrink\n');

/**
 * Does this check source reach production through the PYTHON seam?
 *
 * Pure and injected so it can be fed synthetic sources and watched to fail. Both halves are
 * required: spawning an interpreter is not a production reach, and naming a scrapers module in a
 * comment is not either — it is the conjunction that puts scrapers.common.db on the path.
 */
export function usesPythonRoute(src: string): boolean {
  // The interpreter may be the whole command (`execSync('python3 -c ...')`) or just argv[0]
  // (`execFileSync('python3', [...])`), so the name may be followed by a closing quote OR by a
  // space. Requiring the quote missed the first shape entirely — caught by this file's own third
  // mutation proof on its first run.
  const spawnsPython = /(?:spawnSync|execFileSync|execSync|spawn)\(\s*['"`]python3?(?:['"`]|\s)/.test(src);
  const referencesScrapers = /(?:from|import)\s+scrapers[.\s]/.test(src) || /scrapers\.common/.test(src);
  return spawnsPython && referencesScrapers;
}

// ── THE DECLARED SET — every name with its MEASURED verdict ─────────────────────────────────────
// Measured 2026-09-13 over the required run set: `normal` vs `blackhole` exit codes, with the six
// initially-red checks re-measured against a clean virtualenv so no verdict rests on a broken
// interpreter. A name may LEAVE this list (the check was split, or no longer takes the route); a
// name ARRIVING is a new production-reaching check entering the required suite through the route
// nothing was watching, and it is RED until someone measures it and records the verdict here.
type Verdict = 'offline-safe' | 'production-dependent';
const DECLARED: Record<string, Verdict> = {
  'verify-absence-oracles-are-measured.ts': 'offline-safe',  // re-measured in a clean venv (first run was red on a broken interpreter)
  'verify-aqar-city-slug-scope.ts': 'offline-safe',
  'verify-aqargate-absence-cannot-deactivate.ts': 'offline-safe',  // re-measured in a clean venv (first run was red on a broken interpreter)
  'verify-aqarmonthly-coverage-beats-row-floor.ts': 'offline-safe',  // re-measured in a clean venv (first run was red on a broken interpreter)
  'verify-aqarmonthly-district-suffix-guard.ts': 'offline-safe',
  'verify-authoritative-null-price.ts': 'offline-safe',
  'verify-cleanup-anomaly-gate.ts': 'offline-safe',
  'verify-gathern-brackets-its-canary.ts': 'offline-safe',
  'verify-gathern-canary-pool-cannot-deadlock.ts': 'offline-safe',
  'verify-gathern-liveness-trust-gate.ts': 'offline-safe',
  'verify-http-liveness-law.ts': 'offline-safe',
  'verify-liveness-contract.ts': 'offline-safe',
  'verify-liveness-registry-describes-real-evidence.ts': 'offline-safe',
  'verify-liveness-registry-mirror.ts': 'offline-safe',
  'verify-mustqr-absence-cannot-deactivate.ts': 'offline-safe',
  'verify-prune-without-oracle-is-declared.ts': 'offline-safe',
  'verify-raghdan-absence-cannot-deactivate.ts': 'offline-safe',  // re-measured in a clean venv (first run was red on a broken interpreter)
  'verify-rent-scrapers-annualise.ts': 'offline-safe',
  'verify-sanadak-absence-cannot-deactivate.ts': 'offline-safe',  // re-measured in a clean venv (first run was red on a broken interpreter)
  'verify-sanadak-rsc-object-match.ts': 'offline-safe',
  'verify-scrape-run-finalized-on-kill.ts': 'offline-safe',
  'verify-wasalt-kills-are-auditable-fleet-wide.ts': 'offline-safe',  // re-measured in a clean venv (first run was red on a broken interpreter)
};

const { run } = loadRegistry(ROOT);
// This file is excluded from its own scan: its mutation proofs contain the very idiom it looks for,
// exactly as verify-no-unguarded-deleter.ts excludes itself for containing its own delete patterns.
// A guard that flags itself for describing what it guards teaches people to describe it vaguely.
const SELF = 'verify-python-route-to-production-is-declared.ts';
const found = run.filter((f) => {
  if (f === SELF) return false;
  const p = join(ROOT, 'scripts', f);
  return existsSync(p) && usesPythonRoute(readFileSync(p, 'utf8'));
});

// Discovery must not silently collapse. Zero candidates means the detector broke, not that the
// class vanished — the same fail-closed rule verify-required-suite-is-hermetic.ts applies to its own
// module-graph walk.
check('discovery still sees the python route at all',
  found.length > 0,
  'zero candidates found — if the spawn idiom or the scrapers import syntax changed, this barrier '
  + 'has gone blind and is reporting that as health');

const undeclared = found.filter((f) => !(f in DECLARED));
check(`no NEW check reaches production through the python route (${found.length} found, ${Object.keys(DECLARED).length} declared)`,
  undeclared.length === 0,
  undeclared.map((f) => `${f} — reaches production by spawning python into scrapers.common.db, but is `
    + 'not declared here. MEASURE it (normal vs SUPABASE_URL=https://127.0.0.1:9, compare exit codes; '
    + 'a check that is already RED measures nothing, so fix it first) and record the verdict in '
    + 'DECLARED. If it measures production-dependent, SPLIT it instead.').join('\n      '));

// A name that no longer reaches must LEAVE, or the floor stops describing reality and starts
// flattering it — the stale-row rule verify-required-suite-is-hermetic.ts already enforces.
const stale = Object.keys(DECLARED).filter((f) => !found.includes(f));
check('no stale declaration (a name here that no longer takes the python route)',
  stale.length === 0,
  stale.map((f) => `${f} no longer reaches production this way — delete its line so the floor keeps `
    + 'meaning something').join('\n      '));

const dependent = Object.entries(DECLARED).filter(([, v]) => v === 'production-dependent');
// The whole point of measuring was to be able to say this number out loud. If it ever moves off
// zero, the named check belongs in a workflow home, not in the required per-PR suite.
check('no declared python-route check measures production-dependent',
  dependent.length === 0,
  dependent.map(([f]) => `${f} is production-dependent and must be SPLIT: hermetic predicate + `
    + 'mutation proofs stay in npm test, the live assertion moves to a workflow home declared in '
    + 'scripts/test-exclusions.txt').join('\n      '));

console.log(`\n  python route: ${found.length} declared, all measured offline-safe · TS route: see `
  + 'scripts/live-reaching-required-checks.txt\n');

// ── MUTATION PROOFS ─────────────────────────────────────────────────────────────────────────────
mustCatch('a check that spawns python into a scrapers module (the route the ratchet cannot see)',
  usesPythonRoute("execFileSync('python3', ['-c', 'import scrapers.common.db']);") === true);
mustCatch('the same via spawnSync rather than execFileSync',
  usesPythonRoute("spawnSync('python', ['-c', HARNESS]); // from scrapers.common import db") === true);
mustCatch('a python harness written as `from scrapers.common import db`',
  usesPythonRoute("execSync('python3 -c \"x\"'); const H = 'from scrapers.common import db';") === true);

// Negative controls — the predicate must DISTINGUISH, not flag everything that mentions python.
check('a check that spawns python but never touches scrapers is NOT flagged',
  usesPythonRoute("execFileSync('python3', ['-c', 'print(1)'])") === false);
check('a check that merely NAMES a scrapers module in prose is NOT flagged',
  usesPythonRoute('// scrapers.common.db is the seam this describes') === false);
check('a check that does neither is NOT flagged',
  usesPythonRoute('const x = 1;') === false);
// The real corpus is the strongest control: if the predicate were over-broad it would flag most of
// the suite, and this floor would be meaningless.
check(`the predicate is selective over the real suite (${found.length} of ${run.length} checks)`,
  found.length < run.length / 4);

console.log(failed === 0
  ? '\n✅ the second route to production is visible, declared, and shrink-only\n'
  : `\n❌ ${failed} failure(s)\n`);
process.exit(failed === 0 ? 0 : 1);
