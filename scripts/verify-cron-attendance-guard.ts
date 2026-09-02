// LIMB 5 — CRON ATTENDANCE must stay wired, and its threshold must never be widened.
// Routine #7 (Daily Systems Seam Engineer), 2026-09-02. Offline, deterministic, in `npm test`.
//
// THE HOLE THIS CLOSES. mon_detect_cron_health() had four limbs and every one of them measured
// FAILURE or STALENESS: the last run failed, it failed twice today, last success is older than its
// cadence, it never fired at all. A run that pg_cron never STARTS writes no row anywhere — so
// there is no 'failed' status for limbs 1-2, and the next period's success refreshes last_success
// before limb 3's grace expires. A job silently skipping a fraction of its runs was invisible to
// the one detector that exists to watch it.
//
// Measured on the live roster 2026-09-02: jobid 17 (refresh_listing_native_location_v1, the matview
// refresh behind location search) started 20 of its 24 due runs in 24h, skipping 12:00, 23:00,
// 01:00 and 05:00 outright, while all four limbs read green because every run that DID start
// succeeded. jobid 50 (refresh-mon-audit-counts) sat at 42/48. Both raised the moment LIMB 5 ran.
//
// This is the merge-time half: it proves the attendance predicate still behaves, mutation-proves
// it, and pins the pieces that must keep pointing at each other — the parser migration, the
// needle-edit migration, and the raise/resolve pair. A refactor that renames or unhooks any one of
// them would otherwise silently disable attendance while the detector still LOOKS complete.
//
// Run: node --experimental-strip-types scripts/verify-cron-attendance-guard.ts
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const PARSER_MIGRATION = 'supabase/migrations/20260902104952_cron_minutes_in_hour_parser.sql';
const LIMB5_MIGRATION = 'supabase/migrations/20260902105054_cron_health_limb5_attendance.sql';

// THE THRESHOLD IS A CEILING, NOT A DIAL. Widening it is exactly how a real absence gets silenced,
// so the number lives here as well as in the migration and the two must agree. Changing it takes a
// deliberate edit in a reviewed diff. A cron SCHEDULE change is owner-only; fixing contention is
// the remedy, never relaxing the measurement.
const ATTENDANCE_FLOOR = 0.9;

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

// ── 1. Both halves of the change exist ────────────────────────────────────────────────────────
for (const f of [PARSER_MIGRATION, LIMB5_MIGRATION]) {
  check(existsSync(join(ROOT, f)), `${f} exists`, `${f} is missing — LIMB 5 has a dead link`);
}
const parser = existsSync(join(ROOT, PARSER_MIGRATION)) ? readFileSync(join(ROOT, PARSER_MIGRATION), 'utf8') : '';
const limb5 = existsSync(join(ROOT, LIMB5_MIGRATION)) ? readFileSync(join(ROOT, LIMB5_MIGRATION), 'utf8') : '';

// Strip whole-line comments before pattern-matching, so the prose ABOVE the code can never satisfy
// a check about the code. This repo has been burned by that twice.
const codeOf = (sql: string) =>
  sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const parserCode = codeOf(parser);
const limb5Code = codeOf(limb5);

// ── 2. The denominator exists and fails CLOSED ────────────────────────────────────────────────
check(
  parserCode.includes('create or replace function mon_cron_minutes_in_hour'),
  'the minute-field parser ships',
  'mon_cron_minutes_in_hour() is gone — LIMB 5 has no denominator and cannot compute attendance',
);
check(
  /return 0;/.test(parserCode),
  'the parser returns 0 for a minute-field it cannot count exactly',
  'the parser no longer returns 0 on an unparseable schedule — it would guess a denominator and invent absences',
);

// ── 3. LIMB 5 raises AND resolves on the same key ─────────────────────────────────────────────
// mon_raise() returns 0 on an already-open dedup key, so a limb with no resolve path leaves a
// stuck-open alert that silently suppresses every future raise of its own class. That is the
// nine-dark-detectors shape (AGENTS.md). mon_detect_unresolvable_detector covers the static half;
// this pins it for the limb this file owns.
check(
  limb5Code.includes("mon_raise('P2','cron_health', null, 'cron_absent:'"),
  'LIMB 5 raises on the cron_absent key',
  'LIMB 5 no longer raises — attendance is measured and then thrown away',
);
check(
  limb5Code.includes("mon_resolve_key('cron_health', 'cron_absent:'"),
  'LIMB 5 resolves the same key when attendance recovers',
  'LIMB 5 has no resolve path — a recovered job would read as permanently absent AND suppress its own re-raise',
);

// ── 4. The threshold and its anti-flap guard are intact ───────────────────────────────────────
check(
  limb5Code.includes(`< ${ATTENDANCE_FLOOR}`) || limb5Code.includes('< 0.90'),
  `the ${ATTENDANCE_FLOOR * 100}% attendance floor is unchanged`,
  `the attendance floor is no longer ${ATTENDANCE_FLOOR * 100}% — widening it is how a real absence gets silenced`,
);
check(
  limb5Code.includes('rec.expected_24h - 1'),
  'a one-run shortfall is tolerated (the 24h window edge cannot cry wolf)',
  'the one-run tolerance is gone — the rolling-window boundary will produce false absences',
);

// ── 5. The needle-edit discipline, which is what keeps concurrent sessions safe ───────────────
// A CREATE OR REPLACE built from a body pasted into the file silently drops whatever another
// session added to the live function in the meantime. The migration must derive from the LIVE
// definition instead.
check(
  limb5Code.includes('pg_get_functiondef'),
  'LIMB 5 is needle-edited from the live function definition',
  'LIMB 5 no longer builds from pg_get_functiondef — a concurrent session\'s limb would be silently dropped',
);
check(
  !/create\s+or\s+replace\s+function\s+mon_detect_cron_health/i.test(limb5Code),
  'LIMB 5 does not full-body-replace mon_detect_cron_health',
  'LIMB 5 now carries a full mon_detect_cron_health body — that is the stale-body replace the hard rails forbid',
);
check(
  limb5Code.includes('v_hits <> 1'),
  'the needle-edit asserts its anchor is unique before editing',
  'the anchor uniqueness assertion is gone — the edit could land in the wrong place or not at all',
);

// ── 6. Scope: hourly jobs only ────────────────────────────────────────────────────────────────
// A daily job's attendance over 24h is 0 or 1 and cannot be thresholded; including them would
// produce a stream of false absences and teach everyone to ignore the alert.
check(
  limb5Code.includes("split_part(j.schedule, ' ', 2) = '*'"),
  'LIMB 5 is scoped to schedules whose hour field is *',
  'LIMB 5 is no longer scoped to hourly jobs — daily/weekly jobs will produce false absences',
);

// ── 7. The pure predicate, and its MUTATION PROOF ─────────────────────────────────────────────
// Mirrors the SQL condition exactly. Kept here so a change to the rule has to break a test rather
// than merely edit a string.
export function isAbsent(expected: number, actual: number, floor = ATTENDANCE_FLOOR): boolean {
  return expected >= 24 && actual < expected - 1 && actual / expected < floor;
}

// The two real, measured cases this shipped for.
check(isAbsent(24, 20), 'jobid 17 (20/24) is flagged absent', 'the measured 20-of-24 absence is NOT flagged — LIMB 5 is blind to the case it was built for');
check(isAbsent(48, 42), 'jobid 50 (42/48) is flagged absent', 'the measured 42-of-48 absence is NOT flagged');
// Healthy, and the near-misses that must stay quiet.
check(!isAbsent(24, 24), 'a fully-attended job is quiet', 'a fully-attended job raises — LIMB 5 cries wolf');
check(!isAbsent(24, 23), 'a one-run shortfall is quiet (window edge)', 'a one-run shortfall raises — the rolling window will false-alarm hourly');
check(!isAbsent(96, 90), 'jobid 22 (90/96 = 93.8%) stays above the floor', 'a 93.8%-attendance job raises — the floor moved');
check(!isAbsent(144, 138), 'a 95.8%-attendance job stays quiet', 'a 95.8%-attendance job raises — the floor moved');
// Daily jobs can never be judged by this rule.
check(!isAbsent(1, 0), 'a daily job (expected 1) is never judged on attendance', 'a daily job is being thresholded — 0-or-1 attendance is not a signal');
// MUTATION: widening the floor to 0.5 must stop catching the real case this exists for.
check(!isAbsent(24, 20, 0.5), 'MUTATION: widening the floor to 50% stops catching jobid 17 — the floor is load-bearing', 'the floor is not load-bearing: the predicate ignores it');

// ── 8. Wiring. Never string-match package.json — ask the registry ─────────────────────────────
check(
  npmTestRuns(ROOT, 'verify-cron-attendance-guard'),
  'this barrier runs in `npm test`',
  'this barrier is not discovered by the test registry — it would never run',
);

for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length) {
  console.error(`\n✗ cron attendance (LIMB 5) barrier is not intact:`);
  for (const p of problems) console.error(`   - ${p}`);
  process.exit(1);
}
console.log(`\n✓ cron attendance (LIMB 5) barrier intact — ${ok.length} checks passed.`);
