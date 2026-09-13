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
// WHAT THIS FILE CLAIMS, AND WHAT IT REFUSES TO CLAIM.
//
// It makes the second route VISIBLE and SHRINK-ONLY. It does NOT declare any of the 22 to be
// production-DEPENDENT, because that verdict has not been taken. The documented measurement (run the
// check normally, then again with the endpoint blackholed, and compare exit codes) cannot be
// performed in the routine-10 container: Supabase REST is blocked by the egress proxy and the python
// environment is incomplete, so the "normal" run already fails and the comparison is meaningless.
// Asserting a verdict nobody measured is the failure this repo calls a manufactured negative, and
// raising the production-dependent ceiling to swallow 22 unmeasured names would be exactly that
// wearing the ratchet's own syntax (BARRIER_ENGINEER.md PART 6, Prohibition 1).
//
// So: NO ceiling was raised and NO check was loosened. The class is pinned where it stands, the
// remaining work is recorded as ops_incident #244, and a session with production access takes each
// verdict one at a time — shrinking this floor by SPLITTING, never by weakening.
//
// IMPORTING IS NOT CALLING, and that distinction is preserved rather than flattened: db.py creates
// the client lazily, so some of the 22 may load the seam without ever reaching production. That is
// the same distinction the hermetic barrier already draws for the TypeScript route, and it is why
// each name needs its own measurement instead of a blanket verdict.
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

// ── THE DECLARED SET — a FLOOR, exactly like scripts/test-baseline.txt ──────────────────────────
// Measured 2026-09-13 over the required run set. A name may LEAVE this list (the check was split,
// or proven offline-safe); a name arriving is a NEW production-reaching check entering the required
// suite through the route nothing was watching, and that must be a deliberate, reviewed act.
const DECLARED = [
  'verify-absence-oracles-are-measured.ts',
  'verify-aqar-city-slug-scope.ts',
  'verify-aqargate-absence-cannot-deactivate.ts',
  'verify-aqarmonthly-coverage-beats-row-floor.ts',
  'verify-aqarmonthly-district-suffix-guard.ts',
  'verify-authoritative-null-price.ts',
  'verify-cleanup-anomaly-gate.ts',
  'verify-gathern-brackets-its-canary.ts',
  'verify-gathern-canary-pool-cannot-deadlock.ts',
  'verify-gathern-liveness-trust-gate.ts',
  'verify-http-liveness-law.ts',
  'verify-liveness-contract.ts',
  'verify-liveness-registry-describes-real-evidence.ts',
  'verify-liveness-registry-mirror.ts',
  'verify-mustqr-absence-cannot-deactivate.ts',
  'verify-prune-without-oracle-is-declared.ts',
  'verify-raghdan-absence-cannot-deactivate.ts',
  'verify-rent-scrapers-annualise.ts',
  'verify-sanadak-absence-cannot-deactivate.ts',
  'verify-sanadak-rsc-object-match.ts',
  'verify-scrape-run-finalized-on-kill.ts',
  'verify-wasalt-kills-are-auditable-fleet-wide.ts',
];

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

const undeclared = found.filter((f) => !DECLARED.includes(f));
check(`no NEW check reaches production through the python route (${found.length} found, ${DECLARED.length} declared)`,
  undeclared.length === 0,
  undeclared.map((f) => `${f} — reaches production by spawning python into scrapers.common.db, but is `
    + 'not declared here. Either split its live half out to a workflow home (scripts/test-exclusions.txt) '
    + 'or add it to DECLARED with the reason.').join('\n      '));

// A name that no longer reaches must LEAVE, or the floor stops describing reality and starts
// flattering it — the stale-row rule verify-required-suite-is-hermetic.ts already enforces.
const stale = DECLARED.filter((f) => !found.includes(f));
check('no stale declaration (a name here that no longer takes the python route)',
  stale.length === 0,
  stale.map((f) => `${f} no longer reaches production this way — delete its line so the floor keeps `
    + 'meaning something').join('\n      '));

console.log(`\n  python route: ${found.length} declared · TS route: see `
  + 'scripts/live-reaching-required-checks.txt · production-dependence of these 22 is UNMEASURED '
  + '(ops_incident #244)\n');

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
