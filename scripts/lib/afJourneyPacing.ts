// A LATENCY VERDICT IS ONLY HONEST IF THE ENVIRONMENT WAS SANE WHILE IT WAS TAKEN.
//
// THE BUG THIS EXISTS TO KILL (measured 2026-09-04). The AF browser journeys wait a fixed time for
// the next card, and on timeout their `readCardUntil` returned the LAST state it happened to see —
// so the caller went on to assert against a card that had never advanced. One missed transition
// produced 47 "product" failures in CI, every one of them comparing Q1's option counts against a Q2
// oracle. The product was fine. The harness reported an unobserved state as a measurement.
//
// Reproduced on demand, locally, against the same deployed bundle:
//   verify-af-option-card-truth-live.ts alone                       426 checks, 0 failures
//   the same script beside verify-af-live-truth.ts (the CI shape)   5 failures, same shapes as CI
//
// WHY IT ONLY BITES UNDER LOAD. The next AF card comes from a PAID AGENT TURN plus a count RPC, not
// from a render. Measured on production the same afternoon: apartment_guided_counts_ar on an
// unfiltered Buy scope took 14–19s (and 57014'd in CI at ~21s), while fleet-wide search mean rose
// 773ms → 5,109ms as concurrent agent routines drove ~3.8 searches/s against a MEASURED safe
// envelope of 1.5/s (SEARCH_MATCH_QA_ENGINEER.md §40.1). Fixed waits sized for a quiet database
// expire; the harness then judges whatever is on screen.
//
// THE RULE, AND WHY IT IS NOT A LOOSENED THRESHOLD.
//   1. Wait a full agent turn, not a render (AGENT_TURN_MS) — the transition being awaited IS an
//      LLM round trip. This corrects a budget that was measuring the wrong thing.
//   2. Never assert on a state that never arrived. The caller must be TOLD it never arrived
//      (`settled: false`) and must abandon every assertion derived from it.
//   3. A non-arrival becomes a RED verdict only when production was NOT degraded while we waited.
//      Degraded → NOT EXERCISED, counted, and it still fails the run (a check that could not run
//      must never read green — the ledger in each journey counts skips against the exit code).
//      So this can never turn a real failure green: the only thing it changes is WHICH answer a
//      non-arrival gets, and it can only ever move one from "the product is broken" to "this run
//      did not certify the product, here is the measured reason".
//
// `degraded` is not our own opinion about latency — it is production's, from
// public.ops_search_load_now(), the anon-callable signal the search-latency routine shipped
// 2026-09-04 so harnesses can pace themselves instead of stampeding.

export type SearchLoad = {
  recent_mean_ms: number | null;
  search_qps: number | null;
  safe_qps: number | null;
  samples: number | null;
  degraded: boolean;
};

/** The awaited transition is an agent turn (LLM + count RPC), never a paint. */
export const AGENT_TURN_MS = 60_000;

/** How long a journey will WAIT for production to come back inside its envelope before starting. */
export const PACE_BUDGET_MS = 10 * 60_000;
export const PACE_POLL_MS = 30_000;

/** Unreadable load is NOT "healthy" — a journey must not get a free red out of a blind probe. */
export const UNREADABLE_LOAD: SearchLoad = {
  recent_mean_ms: null, search_qps: null, safe_qps: null, samples: null, degraded: true,
};

export async function readSearchLoad(url: string, headers: Record<string, string>): Promise<SearchLoad> {
  try {
    const r = await fetch(`${url}/rest/v1/rpc/ops_search_load_now`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) return UNREADABLE_LOAD;
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return UNREADABLE_LOAD;
    const num = (x: unknown) => (x == null ? null : Number(x));
    return {
      recent_mean_ms: num(row.recent_mean_ms),
      search_qps: num(row.search_qps),
      safe_qps: num(row.safe_qps),
      samples: num(row.samples),
      degraded: row.degraded === true,
    };
  } catch {
    return UNREADABLE_LOAD;
  }
}

export const describeLoad = (l: SearchLoad): string =>
  l.recent_mean_ms == null
    ? 'production load was UNREADABLE (ops_search_load_now did not answer)'
    : `production search mean ${Math.round(l.recent_mean_ms)}ms at ${l.search_qps} q/s ` +
      `(safe ${l.safe_qps} q/s, ${l.samples} sample(s))`;

/** THE PRIMITIVE. Poll until `pred` holds, and tell the caller whether it EVER held. `settled:false`
 *  means the state was never observed — the last state is returned for diagnostics only and must
 *  not be asserted against. */
export async function settleUntil<T>(
  read: () => Promise<T>,
  pred: (v: T) => boolean,
  budgetMs: number,
  sleep: (ms: number) => Promise<void>,
  pollMs = 350,
): Promise<{ settled: boolean; value: T }> {
  const until = Date.now() + budgetMs;
  let last = await read();
  for (;;) {
    if (pred(last)) return { settled: true, value: last };
    if (Date.now() >= until) return { settled: false, value: last };
    await sleep(pollMs);
    last = await read();
  }
}

/** How a non-arrival must be reported: a real red only when production was healthy while we waited. */
export function verdictForNonArrival(load: SearchLoad): 'red' | 'not_exercised' {
  return load.degraded ? 'not_exercised' : 'red';
}

/** Wait (bounded) for production to come back inside its own envelope before measuring it. */
export async function paceUntilHealthy(
  readLoad: () => Promise<SearchLoad>,
  sleep: (ms: number) => Promise<void>,
  budgetMs = PACE_BUDGET_MS,
  pollMs = PACE_POLL_MS,
  log: (s: string) => void = () => {},
): Promise<SearchLoad> {
  const until = Date.now() + budgetMs;
  let l = await readLoad();
  while (l.degraded && Date.now() < until) {
    log(`      [pace] ${describeLoad(l)} — waiting for production to come back inside its envelope`);
    await sleep(pollMs);
    l = await readLoad();
  }
  return l;
}
