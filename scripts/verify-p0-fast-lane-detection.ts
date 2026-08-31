// EVERY P0-CAPABLE DETECTOR MUST RUN ON THE FAST LANE, NOT ONLY IN THE LONG SWEEP.
// Routine #7 (Daily Systems Seam Engineer), 2026-08-31. Live check — see "HOW IT RUNS" below.
//
// THE DEFECT THIS PINS SHUT (issue #1408). cron.job 38 runs its five statements as ONE command
// string, which pg_cron executes in ONE transaction. `mon-p0-fast-lane` (jobid 86) is a separate
// session, so under ordinary MVCC it could not see a P0 raised inside `mon_run_all_detectors()`
// until job 38 committed — measured avg 207s / p95 430s / max 712s against a 300s SLO. The
// 2026-08-30 decoupling removed the SERIALISATION of dispatch behind the sweep; it could not
// remove transaction VISIBILITY. 20260831192229 moved P0 detection into the lane's own short
// transaction.
//
// WHY A BARRIER AND NOT JUST THE MIGRATION. The fix is a LIST — the ten P0-capable detectors named
// in mon_run_p0_detectors(). A list silently rots: the next engineer adds a detector that raises
// P0, wires it into the full-sweep roster (which mon_detect_orphaned_detectors does police), and
// never touches the lane. That detector then inherits exactly the up-to-712s latency this whole
// change exists to remove, every barrier stays green, and nothing anywhere would notice. This
// check is the only thing that would.
//
// It is deliberately derived FROM PRODUCTION rather than from a second hardcoded list: it asks
// pg_proc which public mon_detect_* functions can raise 'P0' and compares that set against the
// lane's actual array. A duplicated literal list would just move the rot.
//
// HOW IT RUNS. Reads ops_p0_lane_contract() on the PUBLIC anon key (read-only and
// anon-executable by design, exactly like ops_deploy_preflight_checks and
// ops_migration_content_digests). NOT in `npm test` — same reason AGENTS.md pins the drift checker
// out of it: `npm test` is a REQUIRED check on every PR, and a P0 detector added in one PR would
// fail every unrelated PR until the lane caught up. It rides the 15-minute
// migration-drift-guard.yml workflow instead; scripts/test-exclusions.txt records that.
//
//   node --experimental-strip-types scripts/verify-p0-fast-lane-detection.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url: URL_BASE, key: ANON_KEY } = resolvePublicSupabase();

// The lane's transaction must stay short — that is the entire property being bought. Its cron
// command sets statement_timeout to 45s; this is the far tighter budget we actually expect, so a
// detector quietly becoming expensive is caught long before it can threaten the SLO.
export const LANE_BUDGET_S = 10;
// Worst gap between consecutive lane minutes, including the wrap past the top of the hour.
export const MAX_LANE_GAP_MIN = 5;
export const P0_SLO_S = 300;

// Exported for the offline mutation proof.
export function worstGapMinutes(minutes: number[]): number {
  if (minutes.length === 0) return 60;
  const sorted = [...minutes].sort((a, b) => a - b);
  let worst = 0;
  for (let i = 1; i < sorted.length; i++) worst = Math.max(worst, sorted[i] - sorted[i - 1]);
  // The wrap: last slot of one hour to the first slot of the next.
  worst = Math.max(worst, 60 - sorted[sorted.length - 1] + sorted[0]);
  return worst;
}

export function parseMinuteField(minField: string): number[] {
  if (minField === '*') return Array.from({ length: 60 }, (_, i) => i);
  if (/^\d+$/.test(minField)) return [Number(minField)];
  if (/^\d+(,\d+)+$/.test(minField)) return minField.split(',').map(Number);
  const step = minField.match(/^(\d+)-59\/(\d+)$/);
  if (step) {
    const start = Number(step[1]);
    const by = Number(step[2]);
    const out: number[] = [];
    for (let m = start; m < 60; m += by) out.push(m);
    return out;
  }
  const every = minField.match(/^\*\/(\d+)$/);
  if (every) {
    const by = Number(every[1]);
    const out: number[] = [];
    for (let m = 0; m < 60; m += by) out.push(m);
    return out;
  }
  return [];
}

async function callRpc(url: string, apikey: string, body: unknown, timeoutMs = 20000) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${apikey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

if (import.meta.filename === process.argv[1]) {
  let c: {
    p0_capable_detectors: string[];
    lane_detectors: string[];
    lane_schedule: string | null;
    lane_command: string | null;
    lane_active: boolean | null;
    lane_max_runtime_s: number | null;
    lane_runs_24h: number | null;
    lane_failures_24h: number | null;
    sweep_still_has_them: boolean;
  };
  try {
    c = await callRpc(`${URL_BASE}/rest/v1/rpc/ops_p0_lane_contract`, ANON_KEY, {});
  } catch (e) {
    // Same posture as the drift checker: never silently pass in CI for want of network.
    console.warn(`⚠ p0-fast-lane-detection SKIPPED (network unavailable: ${e}) — CI must not skip.`);
    process.exit(0);
  }

  const problems: string[] = [];
  const ok: string[] = [];
  const check = (cond: boolean, pass: string, fail: string) =>
    cond ? ok.push(pass) : problems.push(fail);

  // ── 1. THE MEMBERSHIP INVARIANT — the whole point ────────────────────────────────────────────
  const lane = new Set(c.lane_detectors ?? []);
  const missing = (c.p0_capable_detectors ?? []).filter((d) => !lane.has(d));
  check(
    missing.length === 0,
    `all ${c.p0_capable_detectors?.length ?? 0} P0-capable detectors run on the fast lane`,
    `P0-CAPABLE DETECTOR(S) NOT ON THE FAST LANE: ${missing.join(', ')} — each inherits the ` +
      `full-sweep transaction latency (up to 712s measured) against a ${P0_SLO_S}s SLO. Add them to ` +
      `mon_run_p0_detectors().`,
  );
  check(
    (c.p0_capable_detectors?.length ?? 0) > 0,
    'the P0-capable detector set is non-empty (the probe itself works)',
    'NO P0-CAPABLE DETECTORS FOUND — the introspection is broken, so this check cannot fail ' +
      'honestly and must not be trusted',
  );

  // ── 2. THE LANE IS ACTUALLY WIRED AND RUNNING ────────────────────────────────────────────────
  check(c.lane_active === true, 'the P0 fast lane is an active cron job', 'THE P0 FAST LANE IS NOT ACTIVE');
  check(
    (c.lane_command ?? '').includes('mon_run_p0_detectors'),
    'the lane cron command runs mon_run_p0_detectors()',
    'THE LANE NO LONGER RUNS P0 DETECTION — detection has fallen back into the long sweep',
  );
  check(
    (c.lane_command ?? '').includes('mon_dispatch_p0_fast'),
    'the lane cron command still dispatches',
    'the lane no longer dispatches — detection without delivery tells nobody',
  );
  // Detection must precede dispatch in the same command, or a P0 found this run waits a whole
  // cadence gap for the next run to send it.
  const cmd = c.lane_command ?? '';
  check(
    cmd.indexOf('mon_run_p0_detectors') < cmd.indexOf('mon_dispatch_p0_fast'),
    'detection runs BEFORE dispatch in the same command',
    'DISPATCH RUNS BEFORE DETECTION — a P0 found this run waits a full cadence gap to be sent',
  );

  // ── 3. THE SWEEP REMAINS A BACKSTOP ──────────────────────────────────────────────────────────
  // The lane is the fast path, not the only path. If the lane stops, the sweep must still find P0s.
  check(
    c.sweep_still_has_them === true,
    'the P0 detectors are still on the full-sweep roster too (defence in depth)',
    'THE P0 DETECTORS WERE REMOVED FROM THE FULL SWEEP — the lane is now a single point of failure',
  );

  // ── 4. CADENCE STILL FITS THE SLO ────────────────────────────────────────────────────────────
  const minutes = parseMinuteField((c.lane_schedule ?? '').split(' ')[0] ?? '');
  const gap = worstGapMinutes(minutes);
  check(
    gap <= MAX_LANE_GAP_MIN,
    `worst lane gap including the wrap is ${gap} min (<= ${MAX_LANE_GAP_MIN})`,
    `THE LANE CADENCE SLOWED: worst gap including the wrap is ${gap} min. Fix the SCHEDULE, ` +
      `never the SLO.`,
  );

  // ── 5. THE LANE TRANSACTION IS STILL SHORT ───────────────────────────────────────────────────
  // A P0 is only visible when this transaction COMMITS, so its runtime is the term this change
  // bought down from 712s. If it creeps back up, the fix is quietly undoing itself.
  if (c.lane_max_runtime_s != null && (c.lane_runs_24h ?? 0) > 0) {
    check(
      c.lane_max_runtime_s <= LANE_BUDGET_S,
      `lane worst-case runtime ${c.lane_max_runtime_s}s is within the ${LANE_BUDGET_S}s budget`,
      `THE P0 LANE TRANSACTION IS GETTING LONG (${c.lane_max_runtime_s}s vs ${LANE_BUDGET_S}s ` +
        `budget) — a P0 stays invisible until it commits. Make the lane detectors cheaper; do not ` +
        `raise this budget.`,
    );
    check(
      (c.lane_failures_24h ?? 0) === 0,
      `lane ran ${c.lane_runs_24h}x in 24h with 0 failures`,
      `THE P0 LANE IS FAILING (${c.lane_failures_24h} of ${c.lane_runs_24h} runs in 24h)`,
    );
  }

  for (const o of ok) console.log(`  PASS  ${o}`);
  if (problems.length) {
    console.error(`\n✗ p0-fast-lane-detection: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  console.log(`\n✓ p0-fast-lane-detection: ${ok.length} checks passed`);
}
