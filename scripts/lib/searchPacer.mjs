// ONE PACER FOR EVERY HARNESS THAT CAN LOAD PRODUCTION SEARCH (owner directive, 2026-09-04).
//
// THE PROBLEM IT CLOSES. On 2026-09-04 user-facing Search averaged ~2 s in real traffic while cron
// sat at ZERO seconds. The load was the engineering routines' own harnesses: seven of them, each
// individually inside the §40.1 envelope of 1.5 searches/second, collectively at 2.5-3.2/s on a
// 2-vCPU instance. Every run's own rate constant was correct in isolation; nothing could see the
// SUM. Staggering fixed the half of the load that has a cron line — this fixes the half that does
// not, because interactive sessions cannot be scheduled.
//
// WHY A TRANSPORT WRAPPER AND NOT SIX RATE LIMITERS. The owner asked for the pacing to be shared
// and permanent rather than six unrelated hardcoded implementations. Six copies drift: one gets a
// different constant, one is forgotten on a new harness, one is deleted in a refactor and nobody
// notices because each is individually plausible. There is exactly one policy here, in one file,
// and joining it costs a harness a single import line — which is also what makes the barrier
// (`scripts/verify-search-pacing-shared.ts`) able to prove that every harness has joined.
//
// WHAT IT WILL NEVER DO — these are the owner's constraints, encoded:
//   • never drop, skip or reorder a request         (coverage is identical, byte for byte)
//   • never rewrite a body, narrow a predicate, or cap a limit
//   • never fail a request, even if the load signal is unreachable
//   • never pace anything that is not a production SEARCH read
// It only ever makes a search WAIT. Cadence, cohorts, assertions, mutations, barriers and
// production verification are untouched; the only thing that moves is wall-clock, and only while
// the instance is already busy. §33: correctness outranks latency, in both directions.
//
// HOW IT DECIDES. `ops_search_load_now()` reports the mean latency and searches/second observed in
// real traffic over the last 15 minutes (fed from pg_stat_statements, so it costs no searches to
// measure). Busy ⇒ space searches at BUSY_GAP_MS; quiet ⇒ NORMAL_GAP_MS, the same 700 ms the
// coverage run always used. The signal is re-read at most once a minute and is shared across every
// caller in the process.

const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  || 'https://aannarbkwcymrotzwdbo.supabase.co';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY
  || process.env.SUPABASE_ANON_KEY || 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB';

/** ≤1.5 searches/second — the §40.1 measured safe envelope for a single runner. */
export const NORMAL_GAP_MS = Number(process.env.QA_PACE_NORMAL_MS) || 700;
/**
 * Ceiling on the gap. At 5 s, SEVEN concurrent runners sum to 7/5 = 1.4 searches/second — inside the
 * 1.5/s envelope with the routine count this system actually has.
 */
export const MAX_GAP_MS = Number(process.env.QA_PACE_MAX_MS) || 5000;
/** One cheap signal read a minute at most: a load probe that generated load would be self-defeating. */
export const LOAD_RECHECK_MS = 60000;
/** Hard ceiling on any single wait. Slightly above MAX_GAP_MS so the cap never silently truncates it. */
export const MAX_WAIT_MS = MAX_GAP_MS + 500;

// WHY THE BACK-OFF ESCALATES INSTEAD OF STEPPING TO A FIXED VALUE.
// A single "busy" gap is still a PER-PROCESS constant, and the whole defect being fixed here is that
// per-process constants cannot see the sum: N runners at a fixed 2.1 s gap still offer N × 0.48
// searches/second, so seven of them land at 3.3/s — over the envelope, having "backed off".
// Multiplicative increase while degraded and gentle decay while healthy converges on whatever rate
// the instance can actually take, for ANY number of concurrent runners, without any of them knowing
// how many others exist. That is the only property that makes this bound the COMBINED load rather
// than each run's own.
const UP = 1.6;     // escalate while Search is degraded
const DOWN = 1.3;   // recover gently, so one quiet sample cannot undo a real back-off

/**
 * The production reads this paces. Deliberately the SEARCH surfaces only — the RPCs a real user's
 * filter drives, which are the ones that contend. Bookkeeping calls (ops_qa_record_coverage,
 * ops_qa_ledger_record) and the load probe itself are NOT paced: pacing them would slow runs down
 * without relieving Search, and pacing the probe would recurse.
 */
export const PACED_RPCS = [
  'location_search_candidates_ar',
  'top_cities_by_deal_ar',
  'district_options_ar',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let gap = NORMAL_GAP_MS;
let lastCheck = 0;
let chain = Promise.resolve();
let lastFire = 0;
let pacedCount = 0;
let backedOff = 0;

/** The real fetch, captured before any patching, so re-importing cannot wrap the wrapper. */
const baseFetch = globalThis.fetch.bind(globalThis);

async function refreshGap() {
  if (Date.now() - lastCheck < LOAD_RECHECK_MS) return gap;
  lastCheck = Date.now();
  try {
    const r = await baseFetch(`${SUPA}/rest/v1/rpc/ops_search_load_now`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    const [load] = (await r.json()) ?? [];
    // READABLE BUT EMPTY IS NOT "HEALTHY" (measured 2026-09-04). The 5-minute sampler is itself a
    // pg_cron job, and under exactly the load this exists to relieve it gets starved — two firings
    // were skipped outright while four harnesses ran. If an empty window reset the gap to normal,
    // pacing would silently disengage at the precise moment it is needed most, and the harder the
    // instance was hit the faster that would happen. No samples means "I cannot tell": HOLD the
    // current gap, neither escalating on no evidence nor relaxing on no evidence.
    if (!load || load.samples === 0 || load.recent_mean_ms == null) return gap;
    const busy = !!load.degraded;
    if (busy && gap === NORMAL_GAP_MS) backedOff++;
    gap = busy
      ? Math.min(Math.round(gap * UP), MAX_GAP_MS)
      : Math.max(Math.round(gap / DOWN), NORMAL_GAP_MS);
  } catch {
    // An unreadable signal keeps the NORMAL pace. Treating "I cannot tell" as "the box is on fire"
    // would triple every run's duration during an unrelated outage — a monitoring gap must never
    // become a coverage cost.
    gap = NORMAL_GAP_MS;
  }
  return gap;
}

/** Serialised so CONCURRENT callers space out against each other, not just against themselves. */
async function waitTurn() {
  const mine = chain.then(async () => {
    const want = await refreshGap();
    const since = Date.now() - lastFire;
    const wait = Math.min(Math.max(want - since, 0), MAX_WAIT_MS);
    if (wait > 0) await sleep(wait);
    lastFire = Date.now();
    pacedCount++;
  });
  chain = mine.catch(() => {});   // one caller's failure must never wedge the queue
  return mine;
}

export const isPacedUrl = (url) =>
  PACED_RPCS.some((rpc) => url.includes(`/rpc/${rpc}`));

/** Wait, if this request is a production search read. Never alters or refuses the request. */
export async function paceIfSearch(url) {
  if (!isPacedUrl(String(url))) return;
  await waitTurn();
}

/** What the pacing did, for a run to print. Visible pacing beats silent pacing. */
export const pacingStats = () => ({ paced: pacedCount, backedOff, gapMs: gap });

let installed = false;
/**
 * Patch global fetch once. Idempotent, and a no-op under QA_PACE_OFF=1 so a deliberate load test
 * can opt out explicitly rather than by quietly deleting the import.
 */
export function installSearchPacing() {
  if (installed || process.env.QA_PACE_OFF === '1') return;
  installed = true;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    await paceIfSearch(url);
    return baseFetch(input, init);
  };
}

// Side-effecting on import: joining the shared pacer is one line in a harness, which is what makes
// it realistic to require of all of them — and what lets the barrier verify it.
installSearchPacing();
