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
// turn every outage into a clean bill of health. The decision is therefore a PURE function over an
// explicitly-tagged answer — readable rows, or an error — so "unreadable" cannot be spelled the same
// way as "no rows", and the mutation proofs at the bottom execute both directions.
//
// LIVE, so deliberately NOT in the hermetic `npm test` — the same reason AGENTS.md pins the
// migration drift guard out of it: a required check must not go red on every unrelated PR because
// production is momentarily unreachable. Its home is .github/workflows/p0-fast-lane-coverage.yml
// (recorded in scripts/test-exclusions.txt), which runs it on pull_request, on push to main, and
// on a schedule — the cadence that matters, since this invariant breaks when someone APPLIES a
// migration, not when someone opens a PR.
//
//   node --experimental-strip-types scripts/verify-p0-fast-lane-detection.ts
// A SCHEMA-CACHE RELOAD REDDENED THIS CHECK ON EVERY OPEN PR (routine #10, 2026-09-23).
// Measured: at 23:31:46Z this file reported `UNREADABLE — HTTP 503 {"code":"PGRST002"}` on TWO
// unrelated PRs simultaneously, 96 seconds after an unrelated session applied migration
// 20260923233010. Four function-creating migrations landed from three sessions inside twelve
// minutes that evening, so the window opens often — and because this check runs on `pull_request`,
// every one of those windows fails somebody else's diff. That is ops_incident #573's class exactly,
// arriving in a check PR #3732's repair did not reach.
//
// The generic loop below retried 3x over ~4.5s and exhausted the budget inside the window. It is now
// wrapped by the canonical driver, which is BOTH more patient and MORE discriminating, so this is a
// repair and not a softening (BARRIER_ENGINEER.md Prohibition 1):
//   * only a 503 whose JSON `code` is EXACTLY "PGRST002" is retried — the one self-describing,
//     transient state that says "Retrying." in its own body. Every other failure, including a body
//     that merely MENTIONS the code, is returned on the first attempt exactly as before.
//   * the budget is bounded (~30s); a cache that cannot load inside it is a real problem and the
//     LAST probe is returned as-is, still not-ok. The driver has no path that turns not-ok into ok.
// The verdict this file reaches on every other answer, including an exhausted budget, is unchanged:
// UNREADABLE is still a FAILURE, never an honest empty. Proven in
// scripts/verify-schema-cache-retry-is-not-fail-open.ts.
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { fetchRetryingSchemaCacheReload } from './lib/postgrestRetry.ts';

const { url, key } = resolvePublicSupabase();
const ENDPOINT = `${url}/rest/v1/rpc/ops_p0_detectors_off_fast_lane`;
const ATTEMPTS = 3;

export type OffLane = { detector: string; why: string };

/** Readable rows, or an error. There is deliberately no third spelling of "nothing came back". */
export type LaneAnswer =
  | { readable: true; rows: OffLane[] }
  | { readable: false; error: string };

/**
 * The WHOLE decision, pure and executable. Unreadable is a FAILURE, never a pass — an empty array is
 * what healthy looks like here, so an outage must not be able to imitate it.
 */
export function laneVerdict(answer: LaneAnswer): { pass: boolean; reason: string } {
  if (!answer.readable) {
    return { pass: false, reason: `UNREADABLE — ${answer.error}` };
  }
  if (answer.rows.length > 0) {
    return {
      pass: false,
      reason: `${answer.rows.length} P0-capable detector(s) off the fast lane: `
        + answer.rows.map((r) => r.detector).join(', '),
    };
  }
  return { pass: true, reason: 'every P0-capable detector is on the mon_run_p0_detectors() roster' };
}

/** Turn one HTTP response into a LaneAnswer. A non-200 or a non-array body is NOT "no rows". */
export function interpret(status: number, bodyText: string): LaneAnswer {
  if (status !== 200) return { readable: false, error: `HTTP ${status}: ${bodyText.slice(0, 200)}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { readable: false, error: `body was not JSON: ${bodyText.slice(0, 200)}` };
  }
  if (!Array.isArray(parsed)) {
    return { readable: false, error: `expected a JSON array, got ${typeof parsed}` };
  }
  return { readable: true, rows: parsed as OffLane[] };
}

// ── MUTATION PROOFS — executed, not described ───────────────────────────────────────────────────
let failures = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) console.log(`  PASS  MUTATION — ${label}`);
  else { failures++; console.error(`  FAIL  MUTATION NOT CAUGHT — ${label}`); }
};

const rowsOffLane: OffLane[] = [{ detector: 'mon_detect_stalled_incident', why: 'stranded' }];

mustCatch('a detector off the lane is DETECTED (the defect this file exists for)',
  laneVerdict({ readable: true, rows: rowsOffLane }).pass === false);

mustCatch('an HTTP failure is a FAILURE, never an honest empty answer',
  laneVerdict(interpret(503, 'upstream unavailable')).pass === false);

mustCatch('a non-array 200 body is UNREADABLE, not zero rows',
  laneVerdict(interpret(200, '{"code":"PGRST202","message":"function not found"}')).pass === false);

mustCatch('an unparseable body is UNREADABLE, not zero rows',
  laneVerdict(interpret(200, '<html>gateway timeout</html>')).pass === false);

// NEGATIVE CONTROL. Without this, a predicate that simply always failed would satisfy every proof
// above — the checks would be green and the barrier would be worthless.
mustCatch('a genuine empty answer still PASSES (the predicate is not merely always-fail)',
  laneVerdict(interpret(200, '[]')).pass === true);

if (failures > 0) {
  console.error(`✗ ${failures} mutation proof(s) failed — the predicate does not discriminate.`);
  process.exit(1);
}

// ── THE LIVE CHECK ──────────────────────────────────────────────────────────────────────────────
async function readOffLane(): Promise<LaneAnswer> {
  let last: LaneAnswer = { readable: false, error: 'never attempted' };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // The schema-cache reload is absorbed INSIDE one attempt (see the header): the outer loop
      // still owns transport errors and every other status, and still spends its own budget on them.
      const res = await fetchRetryingSchemaCacheReload(ENDPOINT, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      last = interpret(res.status, res.body);
      if (last.readable) return last;
    } catch (e) {
      last = { readable: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
  }
  return last;
}

const verdict = laneVerdict(await readOffLane());

if (!verdict.pass) {
  console.error(`✗ p0-fast-lane detection: ${verdict.reason}`);
  console.error('');
  console.error('  A P0-capable detector that is not on the lane is evaluated only inside');
  console.error('  mon_run_all_detectors(), whose runtime is charged in full against the 300s P0');
  console.error('  delivery SLO before dispatch begins.');
  console.error('  FIX: add it to the c_p0_detectors roster in mon_run_p0_detectors(), by');
  console.error('  needle-editing the LIVE definition (never a full-body replace from a snapshot —');
  console.error('  concurrent sessions edit that same roster).');
  console.error('  NEVER widen the 300s SLO, and never change another owner\'s cron schedule to');
  console.error('  paper over this. If the answer was UNREADABLE, that is a failure too: an empty');
  console.error('  result is the healthy state here, so an outage must never imitate one.');
  process.exit(1);
}

console.log(`✓ p0-fast-lane detection: ${verdict.reason}`);
