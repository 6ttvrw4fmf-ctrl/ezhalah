// EVERY SEARCHABLE PLATFORM MUST APPEAR IN **BOTH** ADVANCED-FILTER ATTRIBUTE VIEWS.
// Auto-discovered barrier. Found 2026-09-05 while auditing AF coverage across all 38 platforms.
//
// THE GAP THIS PINS. awal was searchable with only HALF its Advanced Filter wiring: 51 rows in
// listing_extra_attrs and ZERO in listing_rich_attrs. It was the only platform in that state, and
// nothing could see it — searching for awal listings worked perfectly, because area / price /
// bedrooms / bathrooms travel through active_listing_ids_v2, not through these views.
//
// HOW IT HAPPENED, AND WHY IT WILL HAPPEN AGAIN WITHOUT THIS FILE. awal was UN-RETIRED, not
// onboarded. Its two tables were already union arms from before the 2026-07-28 retirement, so
// flipping platform_registry to 'active' made search work instantly — and that success hid the
// missing layer. listing_extra_attrs still carried an awal arm from before; listing_rich_attrs
// never did. A REVIVAL has a different shape from an ONBOARDING, and the difference is precisely
// the layer no one re-checks.
//
// WHAT THE GAP COSTS: listing_rich_attrs and listing_extra_attrs are the two views
// sync_all_rich_attrs reads to fill the AF columns of search_listings_ar. A platform missing from
// one of them can never contribute the fields that view carries (property_age, street_width_m,
// direction, majlis rooms, the installment mapping, the additional_info lat/long extraction), so
// its listings answer UNKNOWN to those AF questions instead of answering with what the source
// actually published. That is invisible from the search side — which is the whole problem.
//
// ── THE SPLIT (2026-09-06, routine #10, ops_incident #104) ──────────────────────────────────────
// This file used to ask PRODUCTION the question, from inside `npm test` — the REQUIRED status check
// on every PR. Measured that morning:
//   • EXPLAIN ANALYZE ops_af_attribute_coverage(): 9,803 ms execution, 9,930 shared buffers, 40 rows.
//   • Three consecutive anon PostgREST calls: HTTP 200 at 8,971 / 10,076 / 11,283 ms.
//   • The same call from CI at 05:05 UTC: HTTP 500 — a statement timeout, which this barrier
//     correctly reported as «FAIL the coverage RPC could be reached — HTTP 500 — fails CLOSED».
//   • The privileged call returns all 40 rows, so the FUNCTION IS CORRECT; only its cost is a
//     problem. On one unchanged commit, `npm test` went RED, GREEN on re-run, then RED again.
// A ~10-second production RPC sitting on the statement-timeout boundary cannot decide the verdict on
// an unrelated diff. So the LIVE half moved to a workflow home, exactly as scripts/test-exclusions.txt
// already does for verify-migration-drift-vs-production.ts and for the same stated reason.
//
// NOTHING WAS WEAKENED, AND NO COVERAGE OF A DIFF WAS LOST. The live half still fails CLOSED on an
// unreachable RPC; it simply fails the RIGHT job now — a 6-hourly workflow that carries a
// failure→alert_event bridge, so a real half-wired platform reaches a human within 6h instead of
// reaching whichever unrelated PR author happened to be next. What `npm test` keeps is the half that
// was ever a statement about the DIFF: the predicate, mutation-proven below.
//
// AND THE SPLIT CANNOT SILENTLY BECOME A DELETION. The live half's existence, its declared home, and
// that the home ACTUALLY INVOKES it are asserted below — EXECUTED against the registry and the real
// workflow file via liveHalfProblems(), never string-matched.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import { attributeCoverageIsClean, type AttrCoverageRow } from './lib/coverageGaps.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nEvery searchable platform appears in BOTH Advanced Filter attribute views\n');

// ── THE LIVE HALF MUST STILL RUN SOMEWHERE ──────────────────────────────────────────────────────
const LIVE = 'verify-af-attribute-views-cover-every-platform-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── MUTATION PROOF — the REAL predicate both halves share, against broken coverage data ─────────
// attributeCoverageIsClean() is imported from scripts/lib/coverageGaps.ts, which is the same
// function the live half runs against production. A copy here would prove nothing about the code
// that decides production's verdict — that is the drift class that made verify-extract-price pass
// while production broke on 2026-08-29.
console.log('\n  mutation proof — the shared predicate, against broken coverage data\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const ok = (p: string): AttrCoverageRow => ({ platform: p, in_rich: true, in_extra: true, searchable_rows: 10 });

// M-1: EXACTLY the awal shape — present in extra, absent from rich. The half-wired revival.
mustCatch('a platform in listing_extra_attrs but NOT listing_rich_attrs (the awal shape)',
  !attributeCoverageIsClean([ok('aqar'), { platform: 'awal', in_rich: false, in_extra: true, searchable_rows: 51 }]));
// M-2: the mirror image — an onboarding that wires rich and forgets extra.
mustCatch('a platform in listing_rich_attrs but NOT listing_extra_attrs',
  !attributeCoverageIsClean([ok('aqar'), { platform: 'newone', in_rich: true, in_extra: false, searchable_rows: 7 }]));
// M-3: missing from both — a fully un-wired platform that search still reaches via the union.
mustCatch('a platform missing from BOTH views',
  !attributeCoverageIsClean([{ platform: 'ghost', in_rich: false, in_extra: false, searchable_rows: 900 }]));
// M-4: a gap on a platform with FEW rows is still a gap — small platforms are exactly the ones
// that get half-wired and shrugged off.
mustCatch('a gap on a 6-row platform is still a gap',
  !attributeCoverageIsClean([{ platform: 'tiny', in_rich: false, in_extra: true, searchable_rows: 6 }]));
// M-5: and a genuinely clean fleet must NOT be reported as broken — the negative control, without
// which a predicate that is red for everything would look like a working barrier.
mustCatch('a fully-wired fleet is not reported as a failure', attributeCoverageIsClean([ok('a'), ok('b')]) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the attribute-coverage predicate catches every half-wiring shape, and its live half still runs.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
