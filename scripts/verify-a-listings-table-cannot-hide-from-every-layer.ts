// ops_incident #35 — A PHYSICAL LISTINGS TABLE MUST NOT BE ABLE TO EXIST IN NO LAYER OF THE
// SEARCH CHAIN WITHOUT ANYTHING NOTICING.
//
// THE DEFECT CLASS. The 2026-09-03 repair joined the CLIENT scope to the search INDEX
// (verify-searchable-scope-matches-inventory.ts asserts client == live inventory both ways). It
// never joined the PHYSICAL tables to the inventory view. Every guard for the class starts from
// `search_listings_ar where production_ready` — mon_detect_registry_orphans limb 3,
// mon_detect_search_scope_unreachable_inventory, mon_detect_platform_monitoring_scope_gap — and a
// table that is not an arm of active_listing_ids_v2 contributes ZERO rows to that index. So all
// three read 0 and stay green forever. The guard and the gap were on the same side of the wall,
// and alta_* / shmoualshmal_* sat in no layer at all until PR #1832 launched them.
//
// WHERE THE REAL BARRIER LIVES. In the database, executing, twice an hour:
//   mon_unreachable_listing_tables(text[])            the predicate — pure, injectable
//   mon_detect_unreachable_listing_table()            raises on a table in no layer
//   mon_detect_unreachable_listing_table_is_blind()   RUNS THE MUTATION every sweep: injects a
//                                                     table in no layer and fails if it is not
//                                                     reported, injects a reachable one and fails
//                                                     if it is
// This file is the PRE-MERGE half, and it is deliberately structural: `npm test` is a required
// check on every PR and must stay hermetic, so it cannot execute production SQL. It exists to stop
// a PR from deleting or weakening the thing that does execute. AGENTS.md is explicit that a
// source-text tripwire is not sufficient ON ITS OWN — it is not on its own here.
//
// Every predicate below is applied to the REAL shipped body for the checks, and then to that same
// body broken the way it was actually broken, in the mutation-proof section at the bottom.
//
//   node --experimental-strip-types scripts/verify-a-listings-table-cannot-hide-from-every-layer.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const MIG_DIR = join(ROOT, 'supabase', 'migrations');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
};

const files = readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
check('the migrations directory is visible', files.length > 100,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

// `\s*\(` after the name keeps mon_detect_unreachable_listing_table from matching its own
// _is_blind sibling, and keeps a migration that merely NAMES a function from being mistaken for
// the one that defines it (the any-mention trap verify-district-contradicts-source-detector.ts
// documents, which retargeted that whole check at the wrong file once).
const definesRe = (fn: string) =>
  new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\s*\(`, 'i');

/**
 * Migrations that DEFINE this function, oldest first. Two different questions need two different
 * files: the roster wiring belongs to the migration that FIRST defined the detector, while the
 * body content must be read from the one that defined it LAST — a later create-or-replace is the
 * current truth and does not have to re-add a roster entry that is already there.
 */
const definingMigrations = (fn: string): { file: string; sql: string }[] =>
  files
    .filter((f) => definesRe(fn).test(readFileSync(join(MIG_DIR, f), 'utf8')))
    .map((f) => ({ file: f, sql: readFileSync(join(MIG_DIR, f), 'utf8') }));

/**
 * The function BODY, comments stripped. Scanning the whole migration file instead would let the
 * detector's own alert text — which names search_listings_ar and the three blind detectors on
 * purpose — satisfy or break a check about what the code does. A comment is not a code path.
 */
const bodyOf = (sql: string, fn: string): string => {
  const m = definesRe(fn).exec(sql);
  if (!m) return '';
  const rest = sql.slice(m.index);
  const open = rest.indexOf('$function$');
  if (open < 0) return '';
  const close = rest.indexOf('$function$', open + '$function$'.length);
  if (close < 0) return '';
  return rest.slice(open, close).replace(/--[^\n]*/g, '');
};

const lastOf = (fn: string) => {
  const all = definingMigrations(fn);
  return all.length ? all[all.length - 1] : { file: '', sql: '' };
};
const firstOf = (fn: string) => definingMigrations(fn)[0] ?? { file: '', sql: '' };

const predicate = lastOf('mon_unreachable_listing_tables');
const detector = lastOf('mon_detect_unreachable_listing_table');
const blind = lastOf('mon_detect_unreachable_listing_table_is_blind');

const predicateBody = bodyOf(predicate.sql, 'mon_unreachable_listing_tables');
const detectorBody = bodyOf(detector.sql, 'mon_detect_unreachable_listing_table');
const blindBody = bodyOf(blind.sql, 'mon_detect_unreachable_listing_table_is_blind');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE PREDICATES. Named, so the mutation proofs at the bottom can apply the SAME function to a
// deliberately broken body rather than re-describing the rule in a second place.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const P = {
  /** Judges physical tables from the catalog. An index-driven predicate is blind by construction. */
  readsCatalogNotIndex: (b: string) => /pg_class/.test(b) && !/search_listings_ar/.test(b),
  decidesAgainstInventoryView: (b: string) => b.includes('active_listing_ids_v2'),
  /** A dependency WALK, so an intermediate view is a refactor and not 81 false positives. */
  reachabilityIsAWalk: (b: string) =>
    /with\s+recursive/i.test(b) && b.includes('pg_depend') && b.includes('pg_rewrite'),
  physicalTablesOnly: (b: string) => /relkind\s*=\s*'r'/.test(b),
  /** Only positive evidence excuses a table: a MISSING registry row is silence. */
  onlyRetiredExcuses: (b: string) => /status\s*=\s*'retired'/.test(b),
  /** The exemption is keyed on the stripped suffix, never on the first token. */
  exemptionCannotBleed: (b: string) =>
    b.includes(`regexp_replace(c.name, '_(residential|commercial)_listings$', '')`)
      && !/split_part\(\s*c\.name/.test(b),
  neverMutatesTheSearchChain: (b: string) =>
    !/\b(drop|truncate|alter)\s+table\b/i.test(b)
      && !/create\s+or\s+replace\s+view\s+public\.active_listing_ids_v2/i.test(b),
  selfHeals: (b: string) => b.includes(`mon_resolve_stale_keys('unreachable_listing_table'`),
  escalatesStrandedRows: (b: string) =>
    /case when coalesce\(v_rows, 0\) > 0 then 'P1' else 'P2' end/.test(b),
  namesTheFourLayers: (b: string) => b.includes('SEARCHABLE_TABLES') && b.includes('liveness'),
  emptyCatalogIsUnjudgeable: (b: string) => b.includes('v_total = 0') && /ZERO physical/.test(b),
  viewReachingNothingIsOneFinding: (b: string) => b.includes('cardinality(v_orphans) = v_total'),
  injectsAnUnreachableProbe: (b: string) => b.includes('mon_unreachable_listing_tables(array[probe])'),
  holdsANegativeControl: (b: string) => b.includes('mon_unreachable_listing_tables(array[control])'),
  checksRaiserStillCallsDecider: (b: string) =>
    b.includes(`position('public.mon_unreachable_listing_tables(' in`),
  /** By KEY — a kind+platform resolve would clear the sibling blind guard's finding too. */
  resolvesByKeyNotByPlatform: (b: string) =>
    b.includes(`mon_resolve_key('blind_guard', 'blind_guard:mon_detect_unreachable_listing_table')`)
      && !/mon_resolve\('blind_guard',\s*'all'\)/.test(b),
  rosteredInSameMigration: (sql: string, name: string) =>
    sql.includes('mon_run_all_detectors') && sql.includes(`fn constant text := '${name}'`),
  /** Reads the LIVE body and splices — so it cannot drop entries it never read. */
  rosterEditIsAGuardedNeedle: (sql: string) =>
    sql.includes('pg_get_functiondef') && /\breplace\s*\(/.test(sql)
      && sql.includes('refusing to guess at the array shape'),
};

check('the function bodies were actually extracted',
  predicateBody.length > 200 && detectorBody.length > 200 && blindBody.length > 200,
  `predicate=${predicateBody.length} detector=${detectorBody.length} blind=${blindBody.length} ` +
  `chars — an empty body would make every check below pass or fail for the wrong reason`);

// ── 1. ALL THREE PIECES EXIST IN THE TREE ────────────────────────────────────────────────────────
check('#1 a migration defines the predicate mon_unreachable_listing_tables', !!predicate.file);
check('#1 a migration defines mon_detect_unreachable_listing_table', !!detector.file);
check('#1 a migration defines mon_detect_unreachable_listing_table_is_blind', !!blind.file);

// ── 2. THE PREDICATE JOINS PHYSICAL -> VIEW, WHICH IS THE DIRECTION NOTHING ELSE ASSERTS ──────────
check('#2 the predicate reads the CATALOG, not the search index',
  P.readsCatalogNotIndex(predicateBody),
  'a table in no layer has zero rows in search_listings_ar, so an index-driven predicate is blind ' +
  'to it by construction — that is the whole defect #35 recorded');
check('#2 it decides reachability against the inventory view',
  P.decidesAgainstInventoryView(predicateBody));
check('#2 reachability is a dependency WALK, so an intermediate view is a refactor not 81 alerts',
  P.reachabilityIsAWalk(predicateBody));
check('#2 it considers physical tables only (relkind = r)', P.physicalTablesOnly(predicateBody));

// ── 3. THE EXEMPTION IS POSITIVE EVIDENCE, AND CANNOT BE CLAIMED BY PREFIX BLEED ─────────────────
// Measured on production 2026-09-06 against the shipped first version: injecting
// 'deal_special_residential_listings' and 'toor_x_commercial_listings' returned NEITHER, because
// split_part(name,'_',1) let them borrow retired 'deal' and 'toor'. Two false negatives in the one
// detector whose entire purpose is that this class hides silently.
check('#3 only a RETIRED registry row can excuse a table', P.onlyRetiredExcuses(predicateBody),
  'a missing registry row is silence, and silence must never exempt a table (SOURCE IS TRUTH)');
check('#3 the exemption strips the known suffix and never guesses at the first token',
  P.exemptionCannotBleed(predicateBody),
  "split_part(name, '_', 1) lets deal_special_* claim retired deal's exemption — restore the " +
  'suffix-strip derivation; never widen the exemption to clear a red');

// ── 4. DETECT-ONLY. Reaching a table into search is a four-layer launch, never a monitor's job ────
for (const [what, b] of [['detector', detectorBody], ['predicate', predicateBody]] as const) {
  check(`#4 the ${what} never mutates the search chain`, P.neverMutatesTheSearchChain(b),
    'this class is closed by finishing a launch or recording a retirement — a monitor must not do ' +
    'either for itself, and must never drop a table to clear its own alert');
}

// ── 5. THE ALERT MUST BE ACTIONABLE AND SELF-HEALING ─────────────────────────────────────────────
check('#5 the detector self-heals on its evaluated path', P.selfHeals(detectorBody),
  'without this a cleared condition reads as a standing alert forever, and mon_raise() returns 0 ' +
  'for a genuine recurrence while the key sits open');
check('#5 a table holding rows is escalated above an empty one',
  P.escalatesStrandedRows(detectorBody),
  'stranded inventory (the 4,314-row shape of 2026-09-03) is not the same finding as an empty ' +
  'scaffold, and the exact count is cheap because the loop is empty when healthy');
check('#5 it tells the reader a launch is FOUR layers', P.namesTheFourLayers(detectorBody));

// ── 6. FAIL CLOSED — the two ways this detector could read "clean" while blind ────────────────────
check('#6 zero listings tables is unjudgeable, not clean',
  P.emptyCatalogIsUnjudgeable(detectorBody));
check('#6 a view that reaches NOTHING is one shape failure, not one alert per table',
  P.viewReachingNothingIsOneFinding(detectorBody),
  'reporting 81 independent findings would bury the single fact that actually broke');

// ── 7. THE MUTATION RUNS FOREVER, NOT ONCE ───────────────────────────────────────────────────────
// The whole point: production is clean today, and a clean production is indistinguishable from a
// predicate weakened until it cannot see. The blind guard is what tells them apart.
check('#7 the blind guard injects a table in no layer and fails if it is not reported',
  P.injectsAnUnreachableProbe(blindBody));
check('#7 it also holds a NEGATIVE control, so "report everything" cannot pass',
  P.holdsANegativeControl(blindBody),
  'a predicate returning every table satisfies the positive half and is just as useless');
check('#7 it checks the raising half still calls the deciding half',
  P.checksRaiserStillCallsDecider(blindBody));
check('#7 it resolves BY KEY, so it cannot clear the sibling blind guard',
  P.resolvesByKeyNotByPlatform(blindBody),
  'mon_detect_orphan_detector_is_blind() raises blind_guard/all — a kind-and-platform resolve here ' +
  'would silently clear its finding too');

// ── 8. A DETECTOR OUTSIDE THE ROSTER IS DECORATION, AND THE ROSTER GOES IN THE SAME MIGRATION ─────
// Asked of the migration that FIRST defined each detector: that is where the rule applies. A later
// create-or-replace is the current body and must not be required to re-add an entry already there.
for (const name of
  ['mon_detect_unreachable_listing_table', 'mon_detect_unreachable_listing_table_is_blind'] as const) {
  const mig = firstOf(name);
  check(`#8 ${name} is wired into mon_run_all_detectors in the SAME migration that defines it`,
    P.rosteredInSameMigration(mig.sql, name),
    'AGENTS.md: add the mon_detect_* wrapper AND its roster entry in the same migration');
  check(`#8 ${name}'s roster wiring is a guarded needle-edit that cannot drop entries`,
    P.rosterEditIsAGuardedNeedle(mig.sql),
    'read the LIVE body and splice one name in — a pasted body silently drops every entry it predates');
}

// ── 9. This guard is worthless if nothing runs it ────────────────────────────────────────────────
check('#9 npm test runs this guard',
  npmTestRuns(ROOT, 'verify-a-listings-table-cannot-hide-from-every-layer'),
  'see scripts/test-exclusions.txt — the guard is inert');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// MUTATION PROOF. Each predicate is applied to the REAL shipped body, broken the way it was really
// broken — not to a hand-written fake that only resembles it. If a proof stops catching its defect,
// the check above it has become decoration.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each check must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// The real regression of 2026-09-06: two false negatives, measured against production's registry.
mustCatch('the split_part prefix bleed — deal_special_* borrowing retired deal\'s exemption',
  !P.exemptionCannotBleed(predicateBody.replace(
    `regexp_replace(c.name, '_(residential|commercial)_listings$', '')`,
    `split_part(c.name, '_', 1)`)));

// The exemption widened to "any registry row", which would excuse a live scaffolded platform.
mustCatch('the exemption widened past status = retired',
  !P.onlyRetiredExcuses(predicateBody.replace(/and pr\.status = 'retired'/, '')));

// #35 itself: a predicate rebuilt on the search index is blind to this class by construction.
mustCatch('the predicate rebuilt on the search index (the #35 blindness)',
  !P.readsCatalogNotIndex(predicateBody.replace('pg_class', 'search_listings_ar')));

// A literal arm list instead of a walk: correct today, 81 false positives after a view refactor.
mustCatch('reachability downgraded from a dependency walk to a flat lookup',
  !P.reachabilityIsAWalk(predicateBody.replace(/with\s+recursive/i, 'with')));

// relkind dropped: views and matviews named *_listings would be reported as stranded inventory.
mustCatch('the physical-table restriction dropped',
  !P.physicalTablesOnly(predicateBody.replace(/relkind\s*=\s*'r'/, "relkind in ('r','v','m')")));

// A monitor that repairs its own finding: a launch decision made at 02:29 by nobody.
mustCatch('the detector given a DROP TABLE to clear its own alert',
  !P.neverMutatesTheSearchChain(detectorBody + '\n  drop table public.some_listings;'));

// Without the resolve, a cleared condition reads as a standing alert and mon_raise() dedups a
// genuine recurrence to 0 — the detector goes quiet exactly when it matters again.
mustCatch('the self-heal removed, so the alert becomes a ratchet',
  !P.selfHeals(detectorBody.replace(`mon_resolve_stale_keys('unreachable_listing_table'`, 'perform 1 --(')));

// Flat severity: 4,314 stranded rows would page the same as an empty scaffold.
mustCatch('severity flattened, so stranded inventory reads like an empty scaffold',
  !P.escalatesStrandedRows(detectorBody.replace(
    /case when coalesce\(v_rows, 0\) > 0 then 'P1' else 'P2' end/, "'P2'")));

// The two fail-closed branches — each is how this detector could report clean while blind.
mustCatch('an empty catalog allowed to read as "no orphans"',
  !P.emptyCatalogIsUnjudgeable(detectorBody.replace('v_total = 0', 'false')));
mustCatch('a view reaching nothing fanned out into one alert per table',
  !P.viewReachingNothingIsOneFinding(detectorBody.replace('cardinality(v_orphans) = v_total', 'false')));

// The blind guard is the thing that makes all of the above more than a comment — so prove that IT
// cannot be hollowed out either, in both directions.
mustCatch('the blind guard losing its positive probe',
  !P.injectsAnUnreachableProbe(blindBody.replace('mon_unreachable_listing_tables(array[probe])', "'{}'::text[]")));
mustCatch('the blind guard losing its negative control (a predicate flagging everything passes)',
  !P.holdsANegativeControl(blindBody.replace('mon_unreachable_listing_tables(array[control])', "'{}'::text[]")));
mustCatch('the blind guard no longer checking the raiser still calls the decider',
  !P.checksRaiserStillCallsDecider(blindBody.replace(
    `position('public.mon_unreachable_listing_tables(' in`, 'position(\'x\' in')));
mustCatch('the blind guard resolving by kind+platform and clearing its sibling\'s finding',
  !P.resolvesByKeyNotByPlatform(blindBody.replace(
    `mon_resolve_key('blind_guard', 'blind_guard:mon_detect_unreachable_listing_table')`,
    `mon_resolve('blind_guard', 'all')`)));

// A detector nothing calls is decoration; a pasted roster body silently drops what it predates.
const firstDetectorSql = firstOf('mon_detect_unreachable_listing_table').sql;
mustCatch('a detector defined without its roster entry in the same migration',
  !P.rosteredInSameMigration(
    firstDetectorSql.replace(/fn constant text := 'mon_detect_unreachable_listing_table'/, "fn constant text := 'x'"),
    'mon_detect_unreachable_listing_table'));
mustCatch('the roster wired by a hand-pasted body instead of a needle-edit',
  !P.rosterEditIsAGuardedNeedle(firstDetectorSql.replace(/pg_get_functiondef/g, 'x')));

console.log('\na-listings-table-cannot-hide-from-every-layer: ops_incident #35\n');
if (failed || mutFail) {
  if (failed) {
    console.error(`❌ ${failed} check(s) failed — a platform table could be scaffolded, scraped ` +
      `into, and stay invisible with every barrier green.`);
  }
  if (mutFail) {
    console.error(`❌ ${mutFail} mutation proof(s) BLIND — a check above no longer catches its ` +
      `own defect, so its green means nothing.`);
  }
  process.exit(1);
}
console.log('✅ passed.');
