// THE GUARD BETWEEN A DEAD LISTING AND A USER STILL SEEING IT MUST BE ABLE TO GO RED.
//
// ops_incident #27 stated the gap in its own words: "the new detector has never been observed
// firing on a real breaker trip because the breaker has never tripped ... NOT resolvable: no
// scripts/verify-*.ts barrier with a mutation proof exists yet."
//
// mon_detect_inactive_still_searchable() is the detector that finds source-confirmed-dead listings
// still being served. It could not be proven, because detection and adjudication were fused inside a
// dynamic query over live tables: the only way to ask "would you notice a leak?" was to CREATE one,
// by deactivating a real listing and leaving it in search_listings_ar. That is a destructive
// experiment on production inventory.
//
// Migration 20260906042258 splits them — ops_lifecycle_row_is_leaked() is a pure IMMUTABLE
// predicate over four facts, the generator CALLS it, and mon_detect_lifecycle_leak_detector_is_blind()
// runs it against injected facts every half hour. This file pins that apparatus so it cannot be
// quietly dismantled.
//
// WHAT THIS BARRIER CAN AND CANNOT DO. The executable proof lives in the DATABASE, because that is
// where the predicate lives; this check is hermetic and therefore necessarily reads the migration.
// It is deliberately NOT the only proof — the self-test itself runs in production on the
// mon_run_all_detectors sweep, and the migration executes it at apply time and refuses to install a
// blind one. What this file guarantees is that the apparatus is still DECLARED: the predicate
// exists, the generator asks it rather than carrying a copy of the rule, both directions are tested,
// and the whole thing is on the roster.
//
// THE BUG THAT SHAPED §5 BELOW. In PL/pgSQL, `blind := blind || 'some text'` does NOT append a
// string to a text[] — Postgres resolves it as array || array and tries to parse the literal as an
// array, so it raises `malformed array literal` AT RUNTIME. It only ever executes on the FAILURE
// path, so a self-test written that way passes every day it has nothing to report and then ERRORS
// instead of raising on the one day it detects blindness. This was found by running the mutation,
// not by reading the code.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
console.log('verify-lifecycle-leak-detector-is-self-tested: the leak guard can be watched going red.');

const file = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('_lifecycle_leak_predicate_is_injectable_and_self_tested.sql')).sort().pop();
check(Boolean(file), 'the migration installing the self-test is committed',
  'production has the apparatus but the repo has no source for it — migration drift');
const sql = file ? readFileSync(join(MIGRATIONS, file), 'utf8') : '';

// ── 1. The pure predicate ────────────────────────────────────────────────────────────────────────
check(/create or replace function public\.ops_lifecycle_row_is_leaked\s*\(/i.test(sql),
  'the adjudication is a named, separately-callable predicate');
// Structural claims are asserted against CODE, never prose. The first version of this check was
// `ops_lifecycle_row_is_leaked` within 400 chars of `immutable` anywhere in the file — which the
// header comment "ops_lifecycle_row_is_leaked(...) <- PURE, IMMUTABLE." satisfies on its own. The
// mutation that downgraded the real declaration to `stable` survived it. A barrier a comment can
// satisfy is the exact source-TEXT tripwire AGENTS.md warns about.
const code = sql.replace(/^\s*--.*$/gm, '');
check(/create or replace function public\.ops_lifecycle_row_is_leaked\s*\([\s\S]*?\)\s*returns boolean\s+language sql\s+immutable/i
  .test(code),
  'the predicate is declared IMMUTABLE (pure — it decides from its arguments, reads no table)',
  'a predicate that reads tables cannot be handed injected facts, which is the whole point');

// ── 2. The generator asks it, rather than keeping a second copy of the rule ──────────────────────
const generator = sql.slice(sql.indexOf('create or replace function public.ops_lifecycle_inactive_still_searchable'));
check(/public\.ops_lifecycle_row_is_leaked\s*\(/.test(generator),
  'the candidate generator CALLS the predicate',
  'if the generator keeps its own copy of the rule, the self-test proves something production does ' +
  'not do — a barrier asserting the bug');
check(!/and\s+t\.active\s+is\s+not\s+true[\s\S]{0,120}?deactivated_at\s*<\s*%2/i.test(generator),
  'the generator no longer carries an inline copy of the adjudication');

// ── 3. Both directions are tested ────────────────────────────────────────────────────────────────
const selftest = sql.slice(sql.indexOf('mon_detect_lifecycle_leak_detector_is_blind'));
check(/if not public\.ops_lifecycle_row_is_leaked\(false, false, old, cut\)/.test(selftest),
  'POSITIVE: a genuine leak must be reported');
const negatives: Array<[string, RegExp]> = [
  ['a row still ACTIVE at source', /if public\.ops_lifecycle_row_is_leaked\(false, true, null, cut\)/],
  ['a row still in the aliveness matview', /if public\.ops_lifecycle_row_is_leaked\(true, false, old, cut\)/],
  ['ordinary propagation latency', /if public\.ops_lifecycle_row_is_leaked\(false, false, fresh, cut\)/],
  ['an undatable cycle, stamped row', /if public\.ops_lifecycle_row_is_leaked\(false, false, old, null\)/],
  ['an undatable cycle, UNSTAMPED row', /if public\.ops_lifecycle_row_is_leaked\(false, null, null, null\)/],
];
for (const [label, re] of negatives) {
  check(re.test(selftest), `NEGATIVE CONTROL: ${label} must NOT be reported`,
    'a predicate that answered TRUE to everything would pass the positive half and raise P1 alerts ' +
    'naming healthy inventory — which is how a real leak learns to be ignored');
}
// The unstamped/null-cutoff control is load-bearing and was earned by a surviving mutant.
check(/an unstamped row was adjudicated as leaked/.test(selftest),
  'the UNSTAMPED null-cutoff control is present (the one that actually catches a dropped blindness guard)',
  'with a non-null deactivated_at, dropping the cutoff guard yields `stamp < null` = NULL, which is ' +
  'falsy — so only the unstamped shape detects it. The first version of this self-test passed ' +
  'against a predicate that had lost its blindness guard entirely.');

// ── 4. It is rostered, by needle-edit, and proves itself at apply time ───────────────────────────
check(/pg_get_functiondef\([\s\S]{0,200}?mon_run_all_detectors/.test(sql),
  'the roster entry is NEEDLE-EDITED from the live body, never rebuilt from a remembered one',
  'four separate roster clobbers earned that rule');
check(/the roster anchor is not unique/.test(sql),
  'the needle-edit refuses on a non-unique anchor');
check(/select public\.mon_detect_lifecycle_leak_detector_is_blind\(\) into v;[\s\S]{0,300}?raise exception/.test(sql),
  'the migration RUNS the self-test at apply time and refuses to install a blind one');

// ── 5. The append form that would make the failure path error ───────────────────────────────────
// Scoped to this migration deliberately: the same pattern exists in a committed file for the orphan
// detector whose LIVE body differs (a migration_content_parity matter owned by routine-2), and
// silently rewriting someone else's drift is not this barrier's job.
const badAppend = /\bblind\s*:=\s*blind\s*\|\|\s*'/.test(sql);
check(!badAppend,
  "the self-test appends with array_append, not `blind := blind || 'literal'`",
  "`text[] || 'literal'` is parsed as array || array and raises `malformed array literal` at " +
  'RUNTIME. It executes only on the FAILURE path, so such a self-test passes every quiet day and ' +
  'then ERRORS instead of raising on the one day it detects blindness.');

// ── MUTATION PROOF — the parsing run against inputs carrying each real defect ────────────────────
const mustCatch = (what: string, mutated: string, probe: (s: string) => boolean) =>
  check(probe(mutated), `(mutation) catches ${what}`,
    'MUTANT SURVIVED — an assertion above is blind to the defect it exists to catch');

// The generator's own body ONLY — it is followed in the file by the self-test, which also calls the
// predicate, so slicing to end-of-file would let the self-test's calls mask a detached generator.
// (Both of the mutants below survived the first time for exactly that kind of reason: the probe was
// looking at the wrong region, and the IMMUTABLE mutation was hitting the word in a header comment.)
const genOf = (s: string) => {
  const a = s.indexOf('create or replace function public.ops_lifecycle_inactive_still_searchable');
  const b = s.indexOf('create or replace function public.mon_detect_lifecycle_leak_detector_is_blind');
  return a < 0 ? '' : s.slice(a, b > a ? b : undefined);
};
const stOf = (s: string) => s.slice(s.indexOf('mon_detect_lifecycle_leak_detector_is_blind'));

// The generator region must be non-empty, or every assertion over it would pass vacuously.
check(genOf(sql).length > 0 && /public\.ops_lifecycle_row_is_leaked\s*\(/.test(genOf(sql)),
  'the generator region is isolated correctly from the self-test that follows it');

mustCatch('the generator detached from the predicate (a copy of the rule inlined again)',
  sql.replace(/public\.ops_lifecycle_row_is_leaked\(\s*\n?\s*m\.listing_id is not null[^)]*\)/,
    'm.listing_id is null and t.active is not true'),
  (m) => !/public\.ops_lifecycle_row_is_leaked\s*\(/.test(genOf(m)));

mustCatch('the predicate losing IMMUTABLE (so it could read tables and stop being injectable)',
  sql.replace(/\) returns boolean\nlanguage sql\nimmutable/, ') returns boolean\nlanguage sql\nstable'),
  (m) => !/create or replace function public\.ops_lifecycle_row_is_leaked\s*\([\s\S]*?\)\s*returns boolean\s+language sql\s+immutable/i
    .test(m.replace(/^\s*--.*$/gm, '')));

mustCatch('a negative control deleted (the predicate could then flag healthy inventory)',
  sql.replace(/if public\.ops_lifecycle_row_is_leaked\(false, false, fresh, cut\)/, 'if false'),
  (m) => !/if public\.ops_lifecycle_row_is_leaked\(false, false, fresh, cut\)/.test(stOf(m)));

mustCatch('the load-bearing UNSTAMPED null-cutoff control deleted',
  sql.replace(/if public\.ops_lifecycle_row_is_leaked\(false, null, null, null\)/, 'if false'),
  (m) => !/if public\.ops_lifecycle_row_is_leaked\(false, null, null, null\)/.test(stOf(m)));

mustCatch('the apply-time self-check removed',
  sql.replace(/select public\.mon_detect_lifecycle_leak_detector_is_blind\(\) into v;/, 'v := 0;'),
  (m) => !/select public\.mon_detect_lifecycle_leak_detector_is_blind\(\) into v;[\s\S]{0,300}?raise exception/.test(m));

mustCatch('the runtime-erroring append form reintroduced',
  sql.replace(/array_append\(blind, ('(?:[^']|'')*')\)/, 'blind || $1'),
  (m) => /\bblind\s*:=\s*blind\s*\|\|\s*'/.test(m));

mustCatch('the roster needle-edit replaced by a blind rebuild',
  sql.replace(/the roster anchor is not unique/, 'x'),
  (m) => !/the roster anchor is not unique/.test(m));

console.log(failed === 0
  ? '\n✅ verify-lifecycle-leak-detector-is-self-tested: the guard is injectable, tested both ways, and rostered.'
  : `\n❌ verify-lifecycle-leak-detector-is-self-tested: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
