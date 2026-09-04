// THE SCOPE REGISTRY MUST STAY FRESH, AND ITS DETECTOR MUST STAY HONEST ABOUT AGE.
// Offline contract barrier (§19/§26 of docs/ops/SEARCH_MATCH_QA_ENGINEER.md).
//
// WHAT BROKE, 2026-09-04. `ops_qa_scope` holds the source_table[] the real client sends per scope
// label. Three separate layers reason from it: mon_detect_search_scope_unreachable_inventory judges
// "is this inventory reachable at all", and ops_qa_cohort_catalog() joins it to build every
// p_tables the daily RPC coverage layer and the narrowing probe send.
//
// §41.6 says that registry is re-harvested from real browser requests EACH RUN. Nothing ever did.
// It was hand-populated on 2026-08-20 and drifted for fifteen days, and because it is a snapshot
// with no freshness contract the drift was silent in both directions:
//
//   • Five platforms (abralosol/arkaan/therc/rawasidark/aouj) shipped in RES_TABLES/COM_TABLES on
//     2026-09-03. The detector, reading the stale registry, raised TEN P1s claiming 4,320
//     production-ready listings were "stored, indexed and invisible". They were not — the served
//     bundle carries all ten tables. Fifteen days of a P1 crying wolf.
//   • The registry also drove this routine's OWN coverage, so every search the daily layer fired
//     excluded those 4,320 rows. Self-consistent, so no oracle ever flagged it: a silent hole.
//   • And the dangerous direction — had the client DROPPED a table, the stale registry would still
//     have listed it and the detector would have reported it reachable. The one bug class it exists
//     to catch would have walked straight through it.
//
// Re-harvesting once fixes none of that; it only resets the clock. So the fix has three parts and
// this barrier pins all three, because each is individually silent when it rots:
//   1. e2e/qa-coverage/harvest-scope.mjs exists and refuses a PARTIAL harvest (a half-written
//      registry is worse than a stale one: an empty label reads as "everything reachable").
//   2. The live sweep workflow actually RUNS it, so freshness is maintained by machine and not by
//      an engineer remembering.
//   3. The detector distinguishes EMPTY / STALE / FRESH instead of making equally confident claims
//      from fifteen-day-old evidence, and SELF-HEALS — the old body never resolved a per-table
//      claim, so today's ten false P1s would have stayed open forever even after the fix.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns, workflowInvokes } from './lib/testRegistry.ts';

const root = join(import.meta.dirname, '..');
const harvester = readFileSync(join(root, 'e2e/qa-coverage/harvest-scope.mjs'), 'utf8');
const sweepWf = readFileSync(join(root, '.github/workflows/live-search-sweep.yml'), 'utf8');

// The detector lives in the newest migration that redefines it — read it by name rather than
// pinning a timestamp, so a later hardening pass does not have to edit this barrier to stay green.
const MIG = join(root, 'supabase/migrations');
const detectorFile = readdirSync(MIG)
  .filter((f) => f.endsWith('.sql'))
  .filter((f) => readFileSync(join(MIG, f), 'utf8')
    .includes('create or replace function public.mon_detect_search_scope_unreachable_inventory'))
  .sort()
  .pop();
const detector = detectorFile ? readFileSync(join(MIG, detectorFile), 'utf8') : '';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) { failures++; console.error(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`);
};

console.log('search scope registry — freshness contract');

// ── 1. THE HARVESTER HARVESTS, RATHER THAN RE-DERIVING ───────────────────────────────────────────
// The whole point is that it reads the client's OWN serialization out of the intercepted request.
// A harvester that rebuilt the table lists itself would be a second copy of RES_TABLES/COM_TABLES —
// precisely the drift that put Trending and the results screen on different inventory (remote.ts).
check('harvests p_tables from the intercepted production request',
  /r\.p_tables/.test(harvester) && /Number\(r\.p_limit\) > 1/.test(harvester));
check('ignores autocomplete, which fires the SAME RPC with p_limit:1 (§41.5)',
  /Number\(r\.p_limit\) > 1/.test(harvester));
check('refuses a PARTIAL harvest rather than writing the labels that happened to work',
  /if \(failures\.length\)/.test(harvester) && /REFUSING TO WRITE/.test(harvester));
check('refuses an EMPTY p_tables (an empty label reads as "everything is reachable")',
  /client sent an EMPTY p_tables/.test(harvester));
check('writes through the anon-callable RPC, never a service-role key in a browser job',
  /ops_qa_record_scope/.test(harvester) && !/SUPABASE_SERVICE_ROLE_KEY/.test(harvester));
check('announces an unreadable registry instead of printing a diff it cannot compute',
  /harvesting without a diff/.test(harvester));
check('reports REMOVED tables, not only added ones',
  /REMOVED/.test(harvester) && /before\.filter\(\(t\) => !tables\.includes\(t\)\)/.test(harvester));

// ── 2. SOMETHING ACTUALLY RUNS IT ────────────────────────────────────────────────────────────────
// A harvester nobody invokes is how the registry went stale in the first place. The detector's
// staleness branch turns that into a loud P2 within 3 days, but the scheduled run is what keeps it
// from ever getting there.
check('the live sweep workflow invokes the harvester',
  workflowInvokes(sweepWf, 'e2e/qa-coverage/harvest-scope.mjs'));
check('it harvests BEFORE driving the sweep, so the run tests the scope production really uses',
  sweepWf.indexOf('harvest-scope.mjs') < sweepWf.indexOf('node e2e/live-sweep/run.mjs'));

// ── 3. THE DETECTOR IS HONEST ABOUT THE AGE OF ITS EVIDENCE ──────────────────────────────────────
check('a detector definition was found in supabase/migrations', !!detectorFile);
check('EMPTY registry still refuses to judge', /search_scope_registry_empty/.test(detector));
check('STALE registry refuses to judge and says so', /search_scope_registry_stale/.test(detector));
check('staleness is measured from the OLDEST label, not the newest',
  /min\(q\.harvested_at\)/.test(detector));
check('a stale registry WITHDRAWS standing per-table claims (evidence no longer supports them)',
  /Withdraw every standing per-table claim/.test(detector));
check('a fresh registry SELF-HEALS claims whose table is reachable again',
  /SELF-HEAL/.test(detector) && /mon_resolve_key\('search_scope_unreachable', r\.dedup_key\)/.test(detector));
check('it still raises P1 for genuinely unreachable production-ready inventory',
  /mon_raise\('P1', 'search_scope_unreachable'/.test(detector));

// ── 4. THIS BARRIER ITSELF RUNS ──────────────────────────────────────────────────────────────────
// Never proven by string-matching package.json: since the registry replaced the mega `&&` chain,
// that predicate is false for every check, and matching 'run-tests' instead would be true for a
// file nothing runs — a wiring check that cannot fail.
check('this barrier is discovered by npm test', npmTestRuns(root, 'verify-search-scope-registry-freshness'));

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────────
// Each mutation is a realistic way this fix rots back into the 2026-09-04 defect. Every one must be
// caught by at least one assertion above; a mutation nothing catches means the assertion is
// decorative.
const harvesterMutations: [string, string, string][] = [
  ['partial harvest is allowed to land', 'if (failures.length) {', 'if (false) {'],
  ['an empty p_tables is accepted', "throw new Error('client sent an EMPTY p_tables')", 'void 0'],
  ['autocomplete requests count as result searches', 'Number(r.p_limit) > 1', 'true'],
  ['removals stop being reported', 'before.filter((t) => !tables.includes(t))', '[]'],
];
console.log('  mutation proof — harvester:');
for (const [label, from, to] of harvesterMutations) {
  if (!harvester.includes(from)) { failures++; console.error(`  ✗ mutation anchor missing: ${label}`); continue; }
  const m = harvester.replace(from, to);
  const caught =
    !(/r\.p_tables/.test(m) && /Number\(r\.p_limit\) > 1/.test(m))
    || !(/if \(failures\.length\)/.test(m) && /REFUSING TO WRITE/.test(m))
    || !/client sent an EMPTY p_tables/.test(m)
    || !(/REMOVED/.test(m) && /before\.filter\(\(t\) => !tables\.includes\(t\)\)/.test(m));
  check(`    caught: ${label}`, caught);
}

const detectorMutations: [string, string, string][] = [
  ['staleness branch removed — confident claims from any age of evidence',
    'search_scope_registry_stale', 'search_scope_registry_ignored'],
  ['self-heal removed — a corrected registry never clears the alarm',
    'SELF-HEAL', 'note'],
  ['staleness read from the NEWEST label, hiding a label left behind',
    'min(q.harvested_at)', 'max(q.harvested_at)'],
  ['the real P1 is dropped, leaving a detector that can only ever say "stale"',
    "mon_raise('P1', 'search_scope_unreachable'", "mon_note('P1', 'search_scope_unreachable'"],
];
console.log('  mutation proof — detector:');
for (const [label, from, to] of detectorMutations) {
  if (!detector.includes(from)) { failures++; console.error(`  ✗ mutation anchor missing: ${label}`); continue; }
  // replaceAll, not replace: these anchors also appear in the migration's header comment, and a
  // first-occurrence-only mutation would edit the PROSE and leave the code intact — a mutation
  // that never mutates anything reads as "caught by nothing" and hides a decorative assertion.
  const m = detector.replaceAll(from, to);
  const caught =
    !/search_scope_registry_stale/.test(m)
    || !(/SELF-HEAL/.test(m) && /mon_resolve_key\('search_scope_unreachable', r\.dedup_key\)/.test(m))
    || !/min\(q\.harvested_at\)/.test(m)
    || !/mon_raise\('P1', 'search_scope_unreachable'/.test(m);
  check(`    caught: ${label}`, caught);
}

if (failures) {
  console.error(`\n✗ search scope registry freshness: ${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ search scope registry freshness contract intact');
