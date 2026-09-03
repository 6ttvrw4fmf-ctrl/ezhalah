// Barrier: LIMB 4 OF mon_detect_detector_sweep_budget() MUST STAY DISCRIMINATING — AND MUST NEVER
// BE QUIETED BY WIDENING THE OWNER-SET 300s P0 SLO.
// Systems Seam Engineer, 2026-09-01. Offline, deterministic, auto-discovered by `npm test`.
//
// THE BUG THIS PINS (found in production 2026-09-01, migration 20260901104521). LIMB 4 raised P1 on
// `detector_sweep_vs_p0_slo` whenever the slowest sweep in 24h + 40s exceeded the 300s P0 SLO. Its
// premise was that a P0 is BORN inside the sweep transaction, so sweep runtime is charged against
// the SLO before dispatch begins. That premise was true when the limb shipped and was made FALSE
// two days later by 20260831192229, which moved P0 DETECTION onto the fast lane (cron jobid 86,
// `mon_run_p0_detectors()` in its own 45s transaction). Nobody updated the limb, so it raised
// forever on a risk that no longer existed.
//
// WHY THAT IS A DISABLED BARRIER, NOT MERE NOISE. mon_raise() returns 0 for a dedup key already
// open at the same severity. Alert 1115 sat open from 2026-08-29, re-affirmed every sweep, so a
// GENUINE re-coupling of sweep duration to P0 delivery would have raised nothing and paged nobody.
//
// PRODUCTION EVIDENCE THE PREMISE WAS DEAD: P0 alerts 1243/1244 were created 04:24:00 (a LANE
// minute, not a sweep minute) and dispatched at 04:24:20 / 04:24:22 — 20s and 22s against a 300s
// SLO — while that day's sweeps ran 167.9s–656.6s.
//
// THE FIX WAS TO DISCRIMINATE, NOT TO WIDEN. Both directions are preserved: a complete healthy lane
// resolves; any P0-capable detector off the lane, a down lane, or an unreadable contract still
// raises P1. This file exists so a future edit cannot quietly collapse it back into either failure
// mode — an unconditional raise (the false positive returns) or an unconditional pass (the barrier
// goes dark, which is strictly worse).
//
// MUTATION-PROVEN — each of these turns this check RED (verified 2026-09-01, 6/6):
//   1. the 300s SLO widened in the limb's condition
//   2. the 40s filing-overhead constant widened
//   3. the exposure guard dropped, reverting to an unconditional `if v_max_s + 40 > 300 then`
//   4. the fail-safe `p_contract is null` branch removed (a broken contract would silently pass)
//   5. the off-lane membership test removed (the limb stops watching lane membership at runtime)
//   6. the live-function needle-edit replaced by a hand-pasted full body (drops concurrent edits)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

const failures: string[] = [];
const fail = (m: string) => failures.push(m);

// The migration that owns this contract. Pinned by name: if it is renamed or removed, that is
// itself a change that must be reviewed, not something to silently rediscover.
const OWNER = '20260901104521_limb4_raises_only_when_a_p0_can_still_be_born_in_the_sweep.sql';

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
if (!files.includes(OWNER)) {
  fail(
    `${OWNER} is missing from supabase/migrations/. LIMB 4's exposure guard is defined there; ` +
      `without it the limb reverts to raising on a dead premise (or the mirror has drifted).`,
  );
}

const sql = files.includes(OWNER) ? readFileSync(join(MIGRATIONS, OWNER), 'utf8') : '';

// ── 1. The owner-set SLO and the filing-overhead constant are UNCHANGED. ──────────────────────
// These are the two numbers that, widened, make the whole limb decorative. The owner forbade
// widening the SLO explicitly (docs/ops/SYSTEMS_SEAM_ENGINEER.md PART 1).
if (sql && !/coalesce\(p_max_sweep_s, 0\)\s*\+\s*40\s*>\s*300/.test(sql)) {
  fail(
    'The LIMB 4 threshold is no longer exactly `coalesce(p_max_sweep_s, 0) + 40 > 300`. The 300s ' +
      'P0 SLO is an OWNER decision and the 40s filing overhead is the measured constant behind it. ' +
      'Fix the SCHEDULE or the lane membership — never the SLO.',
  );
}

// ── 2. The limb is GUARDED — it must not revert to an unconditional raise. ────────────────────
if (sql && !/if\s+public\.mon_p0_sweep_exposure_should_raise\(v_max_s,\s*v_contract\)\s+then/.test(sql)) {
  fail(
    "LIMB 4 no longer calls mon_p0_sweep_exposure_should_raise(v_max_s, v_contract). Without the " +
      'guard it raises on sweep duration alone — the exact false positive that kept alert 1115 open ' +
      'from 2026-08-29 and dedup-suppressed every genuine re-occurrence.',
  );
}

// ── 3. Every FAIL-SAFE direction survives. An unreadable contract must RAISE, never pass. ─────
// This is the half a "cleanup" refactor is most likely to delete, and deleting it is worse than
// the original bug: the limb would go dark instead of merely being loud.
const failSafes: Array<[RegExp, string]> = [
  [/p_contract is null/, 'a null contract (ops_p0_lane_contract() unavailable)'],
  [/lane_active/, 'the lane being inactive'],
  [/lane_runs_24h/, 'the lane not having run in 24h'],
  [
    /jsonb_typeof\(p_contract->'p0_capable_detectors'\)/,
    'a malformed p0_capable_detectors (not an array)',
  ],
  [/jsonb_typeof\(p_contract->'lane_detectors'\)/, 'a malformed lane_detectors (not an array)'],
];
for (const [re, what] of failSafes) {
  if (sql && !re.test(sql)) {
    fail(
      `The fail-safe branch for ${what} is gone from mon_p0_sweep_exposure_should_raise(). Every ` +
        'unreadable direction must return TRUE (raise). A guard that fails OPEN silently disables ' +
        'the limb — strictly worse than the false positive it replaced.',
    );
  }
}

// ── 4. The limb still watches fast-lane MEMBERSHIP at runtime. ────────────────────────────────
// Since the fix, LIMB 4 is the only *runtime* watchdog that a P0-capable detector has fallen off
// the lane; scripts/verify-p0-fast-lane-detection.ts covers it only at CI time, on PRs.
if (
  sql &&
  !/from jsonb_array_elements_text\(p_contract->'p0_capable_detectors'\) d\s*\n?\s*where not \(p_contract->'lane_detectors' \? d\)/.test(
    sql,
  )
) {
  fail(
    'The off-lane membership test is gone. LIMB 4 must still raise when a P0-capable detector is ' +
      'not on the fast lane — that is the real risk the limb now exists to catch, and at runtime ' +
      'it is the only thing watching it.',
  );
}

// ── 5. The live function was needle-edited, never re-created from a snapshot. ─────────────────
// Hard safety rail: a CREATE OR REPLACE built from a stale body silently drops whatever a
// concurrent session changed in limbs 1–3.
if (sql && !/pg_get_functiondef/.test(sql)) {
  fail(
    'mon_detect_detector_sweep_budget() was not patched via pg_get_functiondef() of the LIVE ' +
      'function. Re-creating it from a snapshot silently drops concurrent edits to limbs 1-3.',
  );
}
if (sql && !/refusing a no-op patch/.test(sql)) {
  fail(
    'The needle-edit no longer aborts when an anchor is missing. A replace() that matches nothing ' +
      'must raise, not apply an unchanged body and report success.',
  );
}

if (failures.length > 0) {
  console.error('✗ LIMB 4 P0-exposure guard regressed:\n');
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}

console.log(
  '✓ LIMB 4 raises only when a P0 can still be born in the sweep transaction ' +
    '(300s SLO + 40s overhead intact; all 5 fail-safe branches present; lane-membership test ' +
    'present; live function needle-edited).',
);
