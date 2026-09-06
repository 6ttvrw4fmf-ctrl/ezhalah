// IMAGE COVERAGE IS A RATCHET, AND ONBOARDING AN IMAGELESS PLATFORM IS A RED BUILD.
// Auto-discovered barrier (owner directive 2026-09-05: «we never want this issue again»).
//
// THE INCIDENT CLASS. alta and shmoualshmal shipped with a hardcoded-empty photo list; the owner
// found it on the live site. The follow-up fleet sweep then found platforms whose sources publish
// photos sitting at 31-77% DB coverage (mustqr 31%, souq24 32%, abralosol 43%, hajer 61%, …).
// Nothing failed anywhere, because an unphotographed row is VALID at every pipeline layer — the
// only honest detector is the coverage NUMBER itself, snapshotted daily (mon_image_coverage, cron
// 03:35 UTC) and held to a committed floor.
//
// THE THREE RULES (all live in evaluateImageCoverage(), scripts/lib/coverageGaps.ts):
//   1. FRESHNESS — the newest snapshot must be < 48h old. A guard whose input silently stops
//      arriving is a guard that always passes; staleness is therefore a FAILURE, not a skip.
//   2. RATCHET — every platform's live coverage must be >= its floor_pct in
//      scripts/image-coverage-baseline.json. Floors are raised when a fix lands and NEVER lowered
//      to clear a red: a drop below floor means a scraper regressed or a source changed shape,
//      and both are incidents to investigate, not thresholds to adjust.
//   3. ONBOARDING GATE — a platform present in production but ABSENT from the baseline fails the
//      build. Adding a platform now requires deliberately declaring its expected image coverage
//      (or `imageless_at_source: true` with a reason, for a source that genuinely publishes no
//      photos — PRICE=SOURCE has a sibling: IMAGES=SOURCE, and an honest zero stays a zero).
//
// Baselines live in the repo so the ratchet moves through review, never through a dashboard edit.
//
// ── THE SPLIT (2026-09-06, routine #10, ops_incident #104) ──────────────────────────────────────
// Applying those three rules requires production's newest snapshot, and this file used to fetch it
// from inside `npm test` — the REQUIRED status check on every PR. Measured 2026-09-06: main GREEN at
// 03:00, the PR RED at 03:55 on the same tree, because platform `amaall` went live in production in
// between and was not yet in the baseline. That is rule 3 doing exactly its job, but firing at the
// wrong target: it failed an unrelated PR rather than the platform activation that caused it.
//
// THE LIVE HALF'S NEW HOME IS STRICTLY BETTER FOR THIS RULE, not merely quieter.
// loader-active-platforms-check.yml runs every 6h AND carries a failure→alert_event bridge, so an
// undeclared platform now reaches a human within 6 hours of going live. In `npm test` it reached
// only whoever opened the next unrelated PR — someone with no context and every incentive to re-run
// until green, which is how a real finding gets trained into noise.
//
// NOTHING WAS WEAKENED: the live half still fails CLOSED on an unreachable RPC, and no floor moved.
// What `npm test` keeps is the half that was ever a statement about the DIFF — evaluateImageCoverage()
// itself, mutation-proven below against all three rules and both directions.
//
// AND THE SPLIT CANNOT SILENTLY BECOME A DELETION. The live half's existence, its declared home, and
// that the home ACTUALLY INVOKES it are asserted below — EXECUTED against the registry and the real
// workflow file via liveHalfProblems(), never string-matched.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRegistry } from './lib/testRegistry.ts';
import { liveHalfProblems } from './lib/liveHalf.ts';
import {
  evaluateImageCoverage,
  MAX_SNAPSHOT_AGE_HOURS,
  type ImageBaseline,
  type ImageCoverageRow,
} from './lib/coverageGaps.ts';

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

const ROOT = join(import.meta.dirname, '..');
console.log('\nImage coverage: the ratchet predicate, and the live half that applies it to production\n');

// ── THE LIVE HALF MUST STILL RUN SOMEWHERE ──────────────────────────────────────────────────────
const LIVE = 'verify-image-coverage-ratchet-live.ts';
const homing = liveHalfProblems(
  LIVE,
  loadRegistry(ROOT),
  (name) => existsSync(join(ROOT, 'scripts', name)),
  (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null),
);
check(`the LIVE half is homed in a workflow that actually invokes it (${LIVE})`,
  homing.length === 0, homing.join('\n      '));

// ── THE BASELINE IS A DECLARATION, AND AN UNDECLARED ENTRY IS NOT ONE ───────────────────────────
// This IS a statement about the diff — a PR that adds a platform row with neither a floor nor an
// honest-zero reason has declared nothing, and rule 3 would then wave it through on the live side.
// Checked here because it needs no network at all.
const baseline: { platforms: Record<string, ImageBaseline> } =
  JSON.parse(readFileSync(join(ROOT, 'scripts/image-coverage-baseline.json'), 'utf8'));
const undeclared = Object.entries(baseline.platforms).filter(
  ([, b]) => !b.imageless_at_source && typeof b.floor_pct !== 'number',
);
check('every baseline entry declares a floor_pct or an explicit imageless_at_source',
  undeclared.length === 0,
  undeclared.map(([p]) => `${p}: neither floor_pct nor imageless_at_source`).join('; '));
const unreasoned = Object.entries(baseline.platforms).filter(
  ([, b]) => b.imageless_at_source && !b.reason,
);
check('every imageless_at_source claim carries its reason (IMAGES=SOURCE is a finding, not a shrug)',
  unreasoned.length === 0, unreasoned.map(([p]) => p).join('; '));

// ── MUTATION PROOF — the REAL evaluate(), against states that must fail ─────────────────────────
// evaluateImageCoverage() is imported from scripts/lib/coverageGaps.ts, which is the same function
// the live half runs against production's snapshot. A copy here would prove nothing about the code
// that decides production's verdict — the drift class that made verify-extract-price pass while
// production broke on 2026-08-29.
console.log('\n  mutation proof — the shared evaluate(), against broken states\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++; console.error(`  FAIL  BLIND to: ${label}`);
};
const row = (p: string, pct: number, age = 1): ImageCoverageRow =>
  ({ platform: p, active_rows: 100, with_images: pct, pct, snapshot_age_hours: age });

// RULE 2 — the ratchet.
mustCatch('a platform dropping below its floor',
  evaluateImageCoverage([row('aqar', 50)], { aqar: { floor_pct: 95 } }).length > 0);
mustCatch('a one-point drop below the floor is still a drop (no silent tolerance band)',
  evaluateImageCoverage([row('aqar', 94)], { aqar: { floor_pct: 95 } }).length > 0);
// RULE 3 — the onboarding gate.
mustCatch('THE ONBOARDING GAP: a new platform not in the baseline (the alta/shmoualshmal shape)',
  evaluateImageCoverage([row('newplat', 0)], {}).length > 0);
mustCatch('THE amaall SHAPE: a platform that went live at FULL coverage is still undeclared',
  evaluateImageCoverage([row('amaall', 100)], { aqar: { floor_pct: 95 } }).length > 0);
// RULE 1 — freshness. A guard whose input stops arriving is a guard that always passes.
mustCatch('a stale snapshot (dead cron = blind guard)',
  evaluateImageCoverage([row('aqar', 100, MAX_SNAPSHOT_AGE_HOURS + 1)], { aqar: { floor_pct: 95 } }).length > 0);
mustCatch('an EMPTY snapshot (never ran)',
  evaluateImageCoverage([], { aqar: { floor_pct: 95 } }).length > 0);
// The negative controls — without these a predicate that is red for everything would look like a
// working barrier, and the honest-zero rule would be indistinguishable from a swallowed failure.
mustCatch('a declared imageless-at-source platform at 0% is NOT a failure (honest zero)',
  evaluateImageCoverage([row('quiet', 0)], { quiet: { imageless_at_source: true } }).length === 0);
mustCatch('a platform exactly AT its floor is NOT a failure (the ratchet is >=, not >)',
  evaluateImageCoverage([row('aqar', 95)], { aqar: { floor_pct: 95 } }).length === 0);
mustCatch('a snapshot exactly at the age limit is NOT stale',
  evaluateImageCoverage([row('aqar', 100, MAX_SNAPSHOT_AGE_HOURS)], { aqar: { floor_pct: 95 } }).length === 0);
mustCatch('a healthy fleet is NOT reported broken',
  evaluateImageCoverage([row('aqar', 100)], { aqar: { floor_pct: 95 } }).length === 0);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ the image-coverage ratchet holds all three rules, and its live half still runs.\n'
    : `\n❌ ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
