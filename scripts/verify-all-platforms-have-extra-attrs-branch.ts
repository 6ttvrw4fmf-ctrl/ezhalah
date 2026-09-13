// EVERY SEARCHABLE TABLE MUST HAVE ITS OWN BRANCH IN listing_extra_attrs.
//
// THE BUG CLASS THIS EXISTS FOR (2026-09-12/13). amlakalahsa went active — registered into
// SEARCHABLE_TABLES, ops_liveness_registry, scrapers/absence-only-prune.txt, the deal-mapping lint
// and its own RLS policies — with NO branch in listing_extra_attrs at all: a ~2,000-line, 90+-branch
// UNION-ALL view feeding street_width_m/direction/floor_number/tenant_category/license_number/amenity
// booleans into listing_native_location_v2 -> search_listings_ar -> apartment_guided_counts_ar, i.e.
// every Advanced Filter guided-question count. Fixed in
// supabase/migrations/20260913025049_amlakalahsa_extra_attrs_registration.sql. Registering a platform
// touches SEVERAL separate files/tables that nothing lists together in one place, so missing exactly
// one of them stayed invisible until an owner-reported symptom (AF silently skipped its street-width
// follow-up on الجفر/أرض سكنية because the view surfaced 0 known rows for a cohort that genuinely
// split 87/18/10/10 across the width rungs).
//
// WHY TABLE-GRAINED, NOT PLATFORM-GRAINED. verify-af-attribute-views-cover-every-platform.ts already
// guards listing_extra_attrs (+ listing_rich_attrs) fleet-wide — but via ops_af_attribute_coverage(),
// which EXISTS-checks pg_depend for EITHER of a platform's two candidate tables. A platform with both
// a residential and a commercial table reads in_extra=true the moment ONE of the two has a branch, so
// a table-level gap (one wired, the sibling not) is invisible to it. This barrier asks the question at
// the SAME grain SEARCHABLE_TABLES itself uses — one row per table, never collapsed to its platform —
// so that shape cannot hide behind a wired sibling.
//
// WHAT IS ASSERTED: every table in SEARCHABLE_TABLES (lifted, EXECUTED, out of src/data/remote.ts —
// never re-typed here) that currently holds production_ready rows has at least one row of its own
// under listing_extra_attrs. A table with zero searchable rows is not a gap (extraAttrsTableGaps) —
// there is nothing for a missing branch to lose yet, same reasoning attributeCoverageIsClean already
// applies per platform. The live half applies exactly this shared, imported predicate against
// production — never a copy that could drift from the rule this file proves.
//
//   node --experimental-strip-types scripts/verify-all-platforms-have-extra-attrs-branch.ts   (in `npm test`)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { extraAttrsTableCoverageIsClean, type ExtraAttrsTableRow } from './lib/coverageGaps.ts';
import { liftSearchScope } from './lib/liftSearchScope.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nEvery searchable TABLE has its own branch in listing_extra_attrs\n');

// ── the inventory this barrier reasons over must be the real, executed one ─────────────────────
const lifted = await liftSearchScope(ROOT);
const SEARCHABLE_TABLES = lifted.SEARCHABLE_TABLES as string[];
check('SEARCHABLE_TABLES lifted and is plausibly the fleet', SEARCHABLE_TABLES.length >= 50,
  `got ${SEARCHABLE_TABLES.length}`);

// ── THE LIVE HALF MUST STILL RUN SOMEWHERE ──────────────────────────────────────────────────────
const LIVE = 'verify-all-platforms-have-extra-attrs-branch-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── MUTATION PROOF — the REAL predicate both halves share, against broken coverage data ─────────
console.log('\n  mutation proof — the shared predicate, against broken coverage data\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const wired = (t: string): ExtraAttrsTableRow => ({ table: t, searchable_rows: 10, in_extra_attrs: true });

// M-1: EXACTLY the amlakalahsa shape — real searchable rows, no branch at all.
mustCatch('a searchable table with NO branch in listing_extra_attrs (the amlakalahsa shape)',
  !extraAttrsTableCoverageIsClean([wired('aqar_residential_listings'),
    { table: 'amlakalahsa_commercial_listings', searchable_rows: 236, in_extra_attrs: false }]));
// M-2: the platform-grained blind spot this barrier exists to close — one of a platform's two
// tables missing its branch while the SIBLING table is fully wired. ops_af_attribute_coverage()
// would call this platform "in_extra" because its sibling table has a branch; asked per table, the
// unwired one must still fail on its own.
mustCatch("one of a platform's two tables missing its branch while the sibling table is fully wired",
  !extraAttrsTableCoverageIsClean([wired('newone_residential_listings'),
    { table: 'newone_commercial_listings', searchable_rows: 4, in_extra_attrs: false }]));
// M-3: a table with ZERO searchable rows and no branch is NOT a gap — nothing for a missing branch
// to lose yet (a freshly-activated or monthly-only-by-design table, e.g. gathern_commercial_listings).
mustCatch('a table with zero searchable rows and no branch is correctly NOT flagged',
  extraAttrsTableCoverageIsClean([{ table: 'freshlaunch_residential_listings', searchable_rows: 0, in_extra_attrs: false }]));
// M-4: a gap on a small table is still a gap — small single-office platforms are exactly the ones
// that get half-wired and shrugged off.
mustCatch('a gap on a 6-row table is still a gap',
  !extraAttrsTableCoverageIsClean([{ table: 'tiny_residential_listings', searchable_rows: 6, in_extra_attrs: false }]));
// M-5: negative control — a fully-wired fleet must not be reported as broken.
mustCatch('a fully-wired fleet is not reported as a failure',
  extraAttrsTableCoverageIsClean([wired('a_residential_listings'), wired('b_commercial_listings')]) === true);

if (mutFail > 0) failed += mutFail;

console.log(failed === 0
  ? '\n✅ the extra-attrs table-coverage predicate catches every half-wiring shape, and its live half still runs.\n'
  : `\n❌ ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
