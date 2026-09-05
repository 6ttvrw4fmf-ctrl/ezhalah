// EVERY P0-CAPABLE DETECTOR MUST RUN ON THE FAST LANE.
//
// THE PROMISE THIS FINALLY KEEPS. mon_run_p0_detectors()'s own body says its roster "is
// machine-checked against reality by scripts/verify-p0-fast-lane-detection.ts, which enumerates
// every public mon_detect_* whose body can raise 'P0' and FAILS if one is missing here." That file
// did not exist. It was a KNOWN_GAPS entry in verify-ops-remediation-scripts-exist.ts, routed to
// routine-7-seam, and its absence is exactly why the drift below happened.
//
// WHAT DRIFTED WHILE NOTHING WATCHED (measured 2026-09-05). Production had 12 mon_detect_* functions
// able to raise P0; the lane roster listed 10. mon_detect_alert_queue_unworked and
// mon_detect_stalled_incident were evaluated ONLY inside mon_run_all_detectors().
//
// WHY THAT MATTERS, AND WHY IT IS AN SLO BUG RATHER THAN A TIDINESS ONE. alert_event.created_at
// defaults to now() = TRANSACTION START, and the row is invisible to any dispatcher until that
// transaction commits. A P0 raised only inside the sweep therefore spends the whole sweep runtime
// before dispatch can even begin. Over the 24h to 2026-09-05 the sweep ran 48 times, averaging 241s
// with a maximum of 731s — 11 of those 48 already exceed the entire 300s P0 delivery budget on their
// own. Detectors ON the lane do not have this problem: mon-p0-fast-lane (jobid 86) calls
// mon_run_p0_detectors() in its own short transaction across 24 minute-slots, worst gap 3 minutes,
// and every P0 actually raised in that window was delivered in 15-26s.
//
// THE FIX IS NEVER TO WIDEN THE SLO. The owner set 300s and forbade widening it, this limb, or
// hand-stamping dispatched_at. If this check fails, add the named detector to the lane roster.
//
// IT EXECUTES THE INVARIANT — it does not read the roster's source text. ops_p0_detectors_off_fast_lane()
// computes the answer from pg_proc, so this stays true if mon_run_p0_detectors is rewritten,
// renamed or deleted, and a detector added tomorrow is covered without anyone remembering. That
// distinction is the whole point: AGENTS.md records that on 2026-09-04 five defects each had a
// barrier over the exact line and every one of those barriers passed for as long as the defect was
// live.
//
// AN EMPTY RESULT IS THE PASS STATE, SO A FAILED FETCH MUST NEVER LOOK LIKE ONE. This is the precise
// shape the "A FAILED FETCH IS NOT AN EMPTY ANSWER" rule exists to stop: `data ?? []` here would
// turn every outage into a clean bill of health. Every non-200, non-array body and thrown request is
// therefore a FAILURE, never a pass.
//
// LIVE, so deliberately NOT in the hermetic `npm test` — the same reason AGENTS.md pins the
// migration drift guard out of it: a required check must not go red on every unrelated PR because
// production is momentarily unreachable. Its home is .github/workflows/p0-fast-lane-coverage.yml
// (recorded in scripts/test-exclusions.txt), which runs it on pull_request, on push to main, and
// every 15 minutes — the cadence that matters, since this invariant breaks when someone APPLIES a
// migration, not when someone opens a PR.
//
//   node --experimental-strip-types scripts/verify-p0-fast-lane-detection.ts
import { resolvePublicSupabase } from './lib/public-supabase.ts';

const { url, key } = resolvePublicSupabase();
const ENDPOINT = `${url}/rest/v1/rpc/ops_p0_detectors_off_fast_lane`;
const ATTEMPTS = 3;

type OffLane = { detector: string; why: string };

async function readOffLane(): Promise<OffLane[]> {
  let lastError = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      } else {
        const body: unknown = await res.json();
        // A non-array body is NOT "no rows". Treat it as unreadable, never as healthy.
        if (!Array.isArray(body)) {
          lastError = `expected a JSON array, got ${typeof body}: ${JSON.stringify(body).slice(0, 300)}`;
        } else {
          return body as OffLane[];
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  // Unreadable after every retry. FAIL — the alternative is reporting an outage as full coverage.
  console.error('✗ could not read ops_p0_detectors_off_fast_lane() from production.');
  console.error(`  last error after ${ATTEMPTS} attempts: ${lastError}`);
  console.error('  This is a FAILURE, not a pass: an empty answer is what "healthy" looks like');
  console.error('  here, so an unreadable one must never be allowed to imitate it.');
  process.exit(1);
}

const offLane = await readOffLane();

if (offLane.length > 0) {
  console.error(`✗ ${offLane.length} P0-capable detector(s) are NOT on the fast lane:`);
  for (const row of offLane) console.error(`    ${row.detector}\n      ${row.why}`);
  console.error('');
  console.error('  Each one is evaluated only inside mon_run_all_detectors(), whose runtime is');
  console.error('  charged in full against the 300s P0 delivery SLO before dispatch begins.');
  console.error('  FIX: add it to the c_p0_detectors roster in mon_run_p0_detectors(), by');
  console.error('  needle-editing the LIVE definition (never a full-body replace from a snapshot —');
  console.error('  concurrent sessions edit that same roster).');
  console.error('  NEVER widen the 300s SLO, and never change another owner\'s cron schedule to');
  console.error('  paper over this.');
  process.exit(1);
}

console.log('✓ p0-fast-lane detection: every P0-capable mon_detect_* is on the mon_run_p0_detectors() roster');
