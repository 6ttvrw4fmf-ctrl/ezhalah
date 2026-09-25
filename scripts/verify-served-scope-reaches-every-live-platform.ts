// OFFLINE half: prove the served-scope predicate can actually CATCH the incident, and prove the live
// half that applies it to production still runs.
//
// Pair: `scripts/verify-served-scope-reaches-every-live-platform-live.ts`.
// The incident, and why every other layer was green through it: `scripts/lib/servedSearchScope.ts`.
//
// This half is HERMETIC — no network, no production state, so it belongs in the required `npm test`
// (`docs/ops/BARRIER_ENGINEER.md`, and AGENTS.md's "the required suite is HERMETIC" rule). The verdict
// about production is the live half's, and it stays there.
//
// WHAT IS PROVEN HERE, BY EXECUTION:
//   1. `servedScopeProblems` goes RED on the real abaad shape — and stays red when the table's NAME
//      appears in the bundle somewhere other than the scope array, which is the trap a bare
//      `bundle.includes()` walks into.
//   2. `extractServedSearchableTables` finds the real minified array shape, refuses to fuse two
//      unrelated arrays into one phantom scope, and reports NOTHING rather than a wrong answer when
//      the shape is gone — with the caller failing on that, so an empty extraction can never read as
//      a clean scope.
//   3. The predicate is not vacuously red: a bundle that genuinely matches production passes.
//   4. The live half exists, is declared with a real workflow home, and that workflow really invokes
//      it — asked with liveHalfProblems(), never a string match.
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import {
  extractServedSearchableTables, servedScopeProblems, type LiveTable,
} from './lib/servedSearchScope.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  if (ok) { console.log(`  PASS  ${label}`); return; }
  failed++;
  console.error(`  FAIL  ${label}`);
  if (why) console.error(`        ${why}`);
};

console.log('\nThe served-scope predicate, and the live half that applies it\n');

// ── the live half must still run somewhere ────────────────────────────────────────────────────────
const homing = liveHalfProblems(
  'verify-served-scope-reaches-every-live-platform-live.ts',
  loadRegistry(ROOT),
  (bare) => existsSync(join(ROOT, 'scripts', bare)),
  (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; } },
);
check('the live half is homed in a workflow that actually invokes it', homing.length === 0,
  homing.join('\n        '));

// ── mutation proofs ───────────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — the shared predicate, against the real incident shape\n');
let mut = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  (mutation) catches ${label}`); return; }
  mut++;
  console.error(`  FAIL  (mutation) BLIND to ${label}`);
};

/** A plausible fleet, big enough to clear the predicate's own implausibility floors. */
const fleet = (extra: string[] = []): string[] => {
  const names = [
    'aalbarrak', 'abeea', 'abralosol', 'aqar', 'aqaratikom', 'arkaan', 'awal', 'azdad',
    'dealapp', 'gathern', 'hajer', 'masar', 'october', 'rakez', 'sakan', 'sakani',
    'tamyaz', 'wadod', 'wasalt', 'wslnaa', 'yameen', 'therc',
  ];
  return [...names.flatMap((n) => [`${n}_commercial_listings`, `${n}_residential_listings`]), ...extra];
};
const liveOf = (tables: readonly string[], rows = 10): LiveTable[] =>
  tables.map((t) => ({ table: t, productionReadyRows: rows }));

const healthy = fleet();

// M-1: THE INCIDENT, with its real numbers. abaad holds 368 + 12 production_ready rows and the
// served scope does not name either table.
const abaadLive: LiveTable[] = [
  ...liveOf(healthy),
  { table: 'abaad_residential_listings', productionReadyRows: 368 },
  { table: 'abaad_commercial_listings', productionReadyRows: 12 },
];
const incident = servedScopeProblems(healthy, abaadLive);
mustCatch('THE INCIDENT: a platform with 380 live rows that the served scope never names',
  incident.some((p) => p.startsWith('UNREACHABLE') && p.includes('abaad_residential_listings')));
mustCatch('…and it reports the row count, so the cost is in the message, not just the name',
  incident.some((p) => p.includes('380') || (p.includes('368') && p.includes('12'))));

// M-2: THE GREP TRAP. The word «abaad» is all over a real bundle — a logo key, an i18n label, a
// SOURCE_TOKENS entry — while the scope array stays 207 long. A name-anywhere check passes; this one
// must not, because it reads the ARRAY.
const bundleMentioningAbaadElsewhere =
  `var LOGOS={abaad:"/logos/abaad.png"};var T={abaad_label:"أبعاد"};`
  + `var S=[${healthy.map((t) => `'${t}'`).join(',')}];`
  + `console.log("abaad_residential_listings loaded");`;
mustCatch('a table name present ELSEWHERE in the bundle while absent from the scope array',
  servedScopeProblems(extractServedSearchableTables(bundleMentioningAbaadElsewhere), abaadLive)
    .some((p) => p.startsWith('UNREACHABLE')));

// M-3: the extraction must find the real minified shape at all — otherwise M-2 could pass for the
// wrong reason (an extractor that always returns [] is "red" for everything).
check('the extractor recovers the full scope array out of a minified bundle',
  extractServedSearchableTables(bundleMentioningAbaadElsewhere).length === healthy.length,
  `got ${extractServedSearchableTables(bundleMentioningAbaadElsewhere).length}, expected ${healthy.length}`);

// M-4: PHANTOM — the other direction. A table shipped in the scope that production does not have.
mustCatch('a served table production does not have (a rename or drop that shipped)',
  servedScopeProblems([...healthy, 'ghostplatform_residential_listings'], liveOf(healthy),
    ['ghostplatform_residential_listings'])
    .some((p) => p.startsWith('PHANTOM') && p.includes('ghostplatform_residential_listings')));

// M-4b: THE الحميدان REGRESSION — this barrier's own first live run accused a healthy platform.
// الحميدان's tables EXIST in production and hold three rows, all «تم الإيجار», so it contributes no
// production_ready inventory and drops out of loader_active_platforms_ar() while its tables are
// perfectly present. Deriving PHANTOM as `served \ activeFleet` reddened over it — a recorded open
// owner question (2026-09-24, PR #4298), i.e. exactly the wolf-crying its sibling's comment warns
// about. PHANTOM must come from EXISTENCE, so a platform that is merely inactive is silent here.
mustCatch('…while a served table that EXISTS but has left the active fleet is NOT called a phantom '
  + '(the الحميدان shape: tables present, all rows transacted)',
  servedScopeProblems(
    [...healthy, 'alhumaidan_commercial_listings', 'alhumaidan_residential_listings'],
    liveOf(healthy),
    [], // production HAS both tables; they simply carry no production_ready rows
  ).length === 0);

// M-5: A BROKEN EXTRACTION MUST NEVER READ AS A CLEAN SCOPE. Zero served tables yields zero
// PHANTOMs by construction, so without this the check would be at its most confident exactly when
// it understood the least.
mustCatch('an extraction that produced NOTHING (an empty check is a broken check, not a clean one)',
  servedScopeProblems([], liveOf(healthy)).some((p) => p.includes('BLIND')));
mustCatch('an implausibly small extraction treated as a tiny scope',
  servedScopeProblems(['aqar_residential_listings', 'aqar_commercial_listings'], liveOf(healthy))
    .some((p) => p.includes('below any plausible')));

// M-6: two unrelated arrays must not fuse into one phantom scope. If they did, the extractor could
// manufacture a scope long enough to hide a real gap.
const twoArrays =
  `var A=['aqar_commercial_listings','aqar_residential_listings'];`
  + `var B=['wasalt_commercial_listings','wasalt_residential_listings'];`;
mustCatch('two separate arrays being fused into one longer "scope"',
  extractServedSearchableTables(twoArrays).length === 2);

// M-7: a platform whose rows are all NON-production_ready is NOT a gap. Absent this control the
// barrier would cry wolf over every legitimately staged platform, and a barrier nobody believes is
// worse than none (the same distinction verify-searchable-scope-matches-inventory.ts draws).
mustCatch('a zero-row platform absent from the served scope is NOT reported as unreachable',
  servedScopeProblems(healthy, [
    ...liveOf(healthy),
    { table: 'staging_residential_listings', productionReadyRows: 0 },
  ]).length === 0);

// M-8: THE NEGATIVE CONTROL. Without it, a predicate that is red for everything would look like a
// working barrier — the vacuously-red half of PART 3.2's rule.
mustCatch('…while a served scope that genuinely matches production is NOT flagged',
  servedScopeProblems(healthy, liveOf(healthy)).length === 0);

if (mut > 0) failed += mut;

console.log(
  failed === 0
    ? '\n✅ the served-scope predicate catches the unreachable-platform shape, refuses to read a broken\n'
      + '   extraction as a clean scope, and its live half still runs against production.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
