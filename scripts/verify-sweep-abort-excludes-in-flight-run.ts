// LIMB 1 of mon_detect_detector_sweep_budget() must not count a RUNNING sweep as an aborted one
// (routine #7, systems seam, 2026-09-03).
//
// THE DEFECT. LIMB 1 counted an abort with:
//
//     where jobid = v_jobid
//       and status is distinct from 'succeeded'
//       and start_time > now() - interval '24 hours'
//
// pg_cron writes the `cron.job_run_details` row when a job STARTS, with `end_time` NULL and status
// 'starting'/'running'. `status is distinct from 'succeeded'` matches that row, so any evaluation
// racing a live sweep counts the in-flight run as a KILL.
//
// Observed live: alert 1308 (P1, `detector_sweep_aborted`, 2026-09-03 10:57:12). Its payload carries
// the exact signature — `observed_abort_seconds: [null]` (there is no end_time to subtract) and
// `last_abort_at: 2026-09-03T10:59:00.015746`, which is the START of the 10:59 sweep. Every
// scheduled sweep that day succeeded (`cron.job_run_details` for jobid 38: 161.9 s at 10:59,
// 284.4 s at 10:29, 171.1 s at 09:59 — all `succeeded`), so nothing had been aborted at all.
//
// WHY IT IS NOT MERELY NOISE. `mon_raise()` returns 0 for a dedup key already open at the same
// severity. While `detector_sweep_aborted` stands open on an in-flight run, a GENUINE sweep abort
// raises nothing, dispatches nothing and pages nobody — and a real abort is a half-hour in which
// nothing is monitored and nothing is dispatched. Same wound as the day-scoped stuck_open_alert
// false positive (20260901073449) and the bimodal run_duration_explosion one (20260902063604):
// a spuriously-true barrier is a disabled barrier.
//
// THE FIX DISCRIMINATES; IT DOES NOT NARROW. A genuinely killed run always lands with `end_time`
// set, so requiring it loses no real abort. The single case that requirement WOULD lose — a run
// wedged in 'running' forever because its backend died — is added back explicitly as "still running
// past the declared statement_timeout", which LIMB 1 could not detect at all before. Detection
// strictly improves.
//
// OFFLINE ON PURPOSE. This runs in `npm test`, which is a required check on every PR, so it must
// not depend on production being reachable. It proves the decision table directly and pins the
// shipped migration's SQL, which is what a refactor would actually break.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
// Located by NAME, not by version: apply_migration mints its own server-side version timestamp, so
// the committed mirror is named <that version>_sweep_abort_must_not_count_an_in_flight_run.sql and
// pinning a literal prefix here would go red the moment the file is named correctly.
const MIGRATION_SUFFIX = '_sweep_abort_must_not_count_an_in_flight_run.sql';
function findMigration(): string | null {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null;
  const hit = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(MIGRATION_SUFFIX))
    .sort()
    .pop();
  return hit ? path.join(MIGRATIONS_DIR, hit) : null;
}

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

// ── The decision LIMB 1 now makes, expressed purely so both directions are provable offline. ──
// A run counts as an abort iff it FINISHED unsuccessfully, or it is still running past the sweep's
// own declared budget. Must stay semantically identical to the SQL pinned below.
export function isAbortedRun(
  status: string,
  endTime: Date | null,
  startTime: Date,
  now: Date,
  budgetSeconds: number,
): boolean {
  if (status === 'succeeded') return false;
  if (endTime !== null) return true;
  return startTime.getTime() < now.getTime() - budgetSeconds * 1000;
}

function provePredicate(): void {
  const now = new Date('2026-09-03T11:00:00Z');
  const B = 900;
  const d = (s: string) => new Date(s);

  // The exact live case that produced alert 1308: the 10:59 sweep, in flight, no end_time.
  add(
    'an in-flight sweep is NOT an abort (the alert-1308 case)',
    isAbortedRun('running', null, d('2026-09-03T10:59:00Z'), now, B) === false,
  );
  add(
    "pg_cron's 'starting' state is NOT an abort either",
    isAbortedRun('starting', null, d('2026-09-03T10:59:30Z'), now, B) === false,
  );
  // Both directions of the real signal must survive.
  add(
    'a run that FINISHED unsuccessfully IS an abort',
    isAbortedRun('failed', d('2026-09-03T10:44:00Z'), d('2026-09-03T10:29:00Z'), now, B) === true,
  );
  add(
    'a successful run is never an abort',
    isAbortedRun('succeeded', d('2026-09-03T10:33:44Z'), d('2026-09-03T10:29:00Z'), now, B) === false,
  );
  // The case the old predicate could never catch, added by this fix.
  add(
    'a run wedged in running PAST the budget IS an abort (newly detectable)',
    isAbortedRun('running', null, d('2026-09-03T10:40:00Z'), now, B) === true,
  );
  add(
    'a run still inside the budget is not yet an abort',
    isAbortedRun('running', null, d('2026-09-03T10:50:00Z'), now, B) === false,
  );
}

function proveShippedSql(): void {
  const migration = findMigration();
  if (migration === null) {
    add(
      'the migration that applies this fix is committed',
      false,
      `no supabase/migrations/*${MIGRATION_SUFFIX} — the production fix has no mirror in git`,
    );
    return;
  }
  const sql = fs.readFileSync(migration, 'utf8');

  // Scope the predicate assertions to the REPLACEMENT body ($repl$…$repl$) — the SQL that actually
  // becomes LIMB 1. Matching the whole file let a mutation survive: the migration's own proof block
  // also contains the literal `end_time is not null`, so deleting the guard from the replacement
  // still left the string present somewhere in the file (proven 2026-09-03).
  const repl = sql.match(/\$repl\$([\s\S]*?)\$repl\$/)?.[1] ?? '';
  add(
    'the migration carries a $repl$ replacement body',
    repl.length > 0,
    'the edit must be a needle replacement, not a rewritten function',
  );
  add(
    'LIMB 1 requires a finished run before calling it an abort',
    // \b matters too: without it this matches `end_time is not NULLIFIED`.
    /end_time\s+is\s+not\s+null\b/i.test(repl),
    'without this, any evaluation racing a live sweep counts it as a kill again',
  );
  add(
    'LIMB 1 keeps the stuck-running branch',
    /start_time\s*<\s*now\(\)\s*-\s*make_interval/i.test(repl),
    'dropping it would narrow detection instead of sharpening it',
  );
  add(
    'the edit is derived from the LIVE function body, never pasted',
    /pg_get_functiondef/.test(sql),
    'a full-body replace from a stale copy silently drops a concurrent session’s limb',
  );
  add(
    'the edit asserts its anchor is unique before rewriting',
    /exactly\s+1|<>\s*1|!=\s*1/.test(sql),
    'an anchor matching 0 or 2 places must refuse rather than guess',
  );
  add(
    'the 300s P0 SLO is not touched by this migration',
    !/p0_slo_s['"]?\s*,\s*(?!300)\d+/.test(sql),
    'never widen the SLO to quiet a limb',
  );
}

provePredicate();
proveShippedSql();

for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok || !c.detail ? '' : ` — ${c.detail}`}`);
}
const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log(`\n✗ ${failed.length} check(s) failed — LIMB 1 can miscount sweep aborts again`);
  process.exit(1);
}
console.log(
  `\n✓ sweep-abort LIMB 1 discriminates in-flight runs from real aborts (${checks.length} checks)`,
);
