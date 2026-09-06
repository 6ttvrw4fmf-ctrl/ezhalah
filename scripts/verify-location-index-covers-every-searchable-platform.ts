// EVERY SEARCHABLE PLATFORM MUST HAVE ARMS IN listing_location_index.
// Auto-discovered barrier. Found 2026-09-05 while verifying the alta/shmoualshmal activation.
//
// THE GAP THIS PINS. souq24 had 44 Buy/Rent rows in active_listing_ids_v2 and ZERO in
// listing_location_index — it has never had an arm there. Nothing caught it because the two
// objects are activated by SEPARATE migration halves, and only one of them is obviously
// user-facing, so an onboarding that wires the search union and forgets the location index looks
// completely healthy from the search side.
//
// WHY IT IS A REAL DEFECT EVEN THOUGH SEARCH STILL WORKS. souq24's rows ARE findable: measured
// 2026-09-05 they carry city 44/44, district 42/44, region 44/44, and 0 orphans fleet-wide,
// because listing_native_location_v2 resolves their location through fallback resolvers rather
// than the location index. So this is NOT a "listings are invisible" bug — it is a coverage hole:
// listing_location_index feeds listing_location_canonical, and refresh_city_name_bridge /
// refresh_district_name_bridge read from there. A platform missing from it never contributes its
// city/district spellings to those bridges, so its location vocabulary is invisible to the very
// catalogs that canonicalise future listings.
//
// ── THE SPLIT (2026-09-06, routine #10, ops_incident #104) ──────────────────────────────────────
// The question this barrier asks is a fact about PRODUCTION's live union definitions, not about the
// diff under test — and `npm test` is the REQUIRED status check on every PR. Measured 2026-09-06: on
// a single unchanged commit this file's «the coverage RPC could be reached» assertion went RED, then
// GREEN on immediate re-run, then RED again. The RED was reproduced with the only changed file
// reverted to its origin/main version — identical failure — so it was provably independent of any
// diff under test. A predicate whose verdict is decided by a stopwatch cannot gate an offline diff.
//
// So the LIVE half moved to a workflow home, exactly as scripts/test-exclusions.txt already does for
// verify-migration-drift-vs-production.ts and for the same stated reason.
//
// NOTHING WAS WEAKENED, AND NO COVERAGE OF A DIFF WAS LOST. The live half still fails CLOSED on an
// unreachable RPC — unreachable production is never reported as "no gaps found" (AGENTS.md: A FAILED
// FETCH IS NOT AN EMPTY ANSWER). It simply fails the RIGHT job now: a 6-hourly workflow with a
// failure→alert_event bridge, so a genuinely uncovered platform reaches a human within 6h instead of
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
import { locationIndexIsClean } from './lib/coverageGaps.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nlisting_location_index covers every platform active_listing_ids_v2 makes searchable\n');

// ── THE LIVE HALF MUST STILL RUN SOMEWHERE ──────────────────────────────────────────────────────
const LIVE = 'verify-location-index-covers-every-searchable-platform-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── MUTATION PROOF — the REAL predicate both halves share, against broken coverage data ─────────
// locationIndexIsClean() is imported from scripts/lib/coverageGaps.ts, which is the same function
// the live half runs against production. A copy here would prove nothing about the code that decides
// production's verdict — the drift class that made verify-extract-price pass while production broke
// on 2026-08-29.
console.log('\n  mutation proof — the shared predicate, against broken coverage data\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};

// M-1: exactly the souq24 shape this barrier was written for.
mustCatch('a searchable platform absent from the location index (the souq24 shape)',
  !locationIndexIsClean([{ platform: 'souq24', searchable_rows: 44 }]));
// M-2: several at once — e.g. an onboarding that wires the union for two platforms and forgets lli.
mustCatch('several platforms missing at once',
  !locationIndexIsClean([{ platform: 'alta', searchable_rows: 7 }, { platform: 'shmoualshmal', searchable_rows: 6 }]));
// M-3: a platform with ZERO searchable rows still counts — the RPC only returns genuine gaps, and
// treating "0 rows" as harmless would re-open the hole for a freshly-activated platform.
mustCatch('a gap reported with a zero row count is still a gap',
  !locationIndexIsClean([{ platform: 'newplatform', searchable_rows: 0 }]));
// M-4: and the clean case must still be clean — the negative control, without which a predicate that
// is red for everything would look like a working barrier.
mustCatch('a genuinely clean result is NOT reported as a failure', locationIndexIsClean([]) === true);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the location-index coverage predicate catches every gap shape, and its live half still runs.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
