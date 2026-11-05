// THE WEEKLY CAPACITY CHECK'S DECISIONS — pure, no network (owner 2026-11-05: «catch it before the user gets it»).
//
// How many people can search AT THE SAME TIME before the first card comes late? The live half
// (scripts/verify-capacity-check-live.ts, run by .github/workflows/capacity-check.yml) replays real Filter searches at
// 1 → 2 → 3 → 4 → 6 → 8 simultaneous users and asks THIS file three things: is the database quiet enough to start a
// step, did the step pass, and what is the safe number. Hermetic and mutation-proven by scripts/verify-capacity-check.ts.

/** OWNER RULE 2026-11-05: «12 seconds … part of the journey experience; higher than that is an issue» — from the tap on
 *  «بحث» to the first card. The wait is deliberate (the logo strip); only LONGER is a problem. */
export const FIRST_CARD_LIMIT_S = 12;
/** The first card waits for the RESULTS data and for the logo strip, whichever ends later (src/app/agent.tsx
 *  playListings: SEARCH_MIN_MS, then the strip's page dwell capped at SEARCH_MAX_HOLD_MS). The guided counts are fired
 *  after the results and never awaited, so they do not gate the card. The strip ends ≈ 11.5 s after the tap (measured
 *  2026-11-05), so data ready by then = first card inside FIRST_CARD_LIMIT_S. Over this at p95 = the step fails. */
export const DATA_READY_LIMIT_MS = 11_500;
/** Data ready later than this at p95 = a warning in the report (no stop, no alarm): the margin is going. */
export const DATA_READY_WARN_MS = 8_000;
/** Tap → first request, measured in a real browser 2026-11-05: client time the robot cannot see, added to the robot's
 *  results phase so «data ready» is on the user's clock. */
export const TAP_TO_FIRST_REQUEST_MS = 1_700;

/** Simultaneous users per step. The last one is the hard cap; nothing in this file can go past it. */
export const STEPS = [1, 2, 3, 4, 6, 8] as const;
export const CAP = 8;
/** One step lasts this long; a search started before the end finishes and counts. 6 steps ≈ 5 min. */
export const STEP_SECONDS = 45;
/** Every request gives up here: the app's own RPC_TIMEOUT_MS (src/data/remote.ts). A timeout is an error. */
export const REQUEST_TIMEOUT_MS = 15_000;
/** More than 1 % of searches failing or timing out in the results phase stops the ramp. */
export const MAX_ERROR_RATE = 0.01;
/** AGENTS.md «our own robots must not take production down», rule 1: someone else's load → do not add ours. */
export const FOREIGN_ACTIVE_MAX = 8;
/** The ramp starts at minute :10 UTC: after mon-detectors-and-dispatch (:59, p95 ≈ 10 min) and before
 *  refresh_listing_native_location_v1 (:16) — the hour's one gap with no heavy cron job (scripts/lib/cronSlots.ts hog
 *  windows). 6 steps fit in it. */
export const WINDOW_MINUTE = 10;

export type Sample = { ms: number; ok: boolean };
export type Stats = { n: number; errors: number; error_rate: number; p50: number | null; p95: number | null };
/** `results` = the results phase per search (results RPC + every card fetch), measured from the first request. */
export type Step = { concurrency: number; seconds: number; results: Stats; calls: Record<string, Stats> };
export type Verdict = 'pass' | 'late' | 'errors' | 'no-samples';
export type Activity = { active: number; slow: number };

/** Nearest-rank percentile; null for no samples. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** Latency of the requests that ANSWERED; errors are counted, never averaged in as fast (a 10 ms 503 is not speed). */
export function stats(samples: Sample[]): Stats {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms);
  const errors = samples.length - ok.length;
  return { n: samples.length, errors, error_rate: samples.length ? errors / samples.length : 0,
    p50: percentile(ok, 50), p95: percentile(ok, 95) };
}

/** p95 time from the tap until the cards' data is in, on the user's clock; null with no answered search. */
export function dataReadyP95(step: Step): number | null {
  return step.results.p95 === null ? null : TAP_TO_FIRST_REQUEST_MS + step.results.p95;
}

/** Why the database is too busy to start a step, or null when it is quiet. `active`/`slow` exclude our own backend. */
export function databaseBusy(a: Activity): string | null {
  if (a.active > FOREIGN_ACTIVE_MAX) return `${a.active} active authenticator queries that are not ours (> ${FOREIGN_ACTIVE_MAX})`;
  if (a.slow > 0) return `${a.slow} foreign authenticator quer${a.slow === 1 ? 'y' : 'ies'} running > 5 s`;
  return null;
}

/** A step passes only when searches answered, ≤ 1 % failed, and the first card would still land by the limit. */
export function verdict(step: Step, limitMs = DATA_READY_LIMIT_MS): Verdict {
  const f = step.results;
  if (f.n === 0 || f.p95 === null) return 'no-samples';
  if (f.error_rate > MAX_ERROR_RATE) return 'errors';
  if (TAP_TO_FIRST_REQUEST_MS + f.p95 > limitMs) return 'late';
  return 'pass';
}

/** The next step's concurrency, or null to stop: after any failed step, after the last step, never above CAP. */
export function nextConcurrency(done: Step[], limitMs = DATA_READY_LIMIT_MS): number | null {
  if (done.some((s) => verdict(s, limitMs) !== 'pass')) return null;
  const next = STEPS[done.length];
  return next !== undefined && next <= CAP ? next : null;
}

/** The highest concurrency that passed before the first failure; 0 when even one user fails. With the default limit
 *  this is «how many can search at once and still see the first card by 12 s»; with DATA_READY_WARN_MS, the margin. */
export function safeConcurrency(done: Step[], limitMs = DATA_READY_LIMIT_MS): number {
  let safe = 0;
  for (const s of done) {
    if (verdict(s, limitMs) !== 'pass') break;
    safe = Math.min(CAP, s.concurrency);
  }
  return safe;
}

/** The call with the highest p95 at the heaviest step measured, among `among` (default: every call). */
export function slowestCall(done: Step[], among?: string[]): string | null {
  const last = done[done.length - 1];
  if (!last) return null;
  let worst: string | null = null, p95 = -1;
  for (const [name, s] of Object.entries(last.calls)) {
    if (among && !among.includes(name)) continue;
    if ((s.p95 ?? -1) > p95) { worst = name; p95 = s.p95 ?? -1; }
  }
  return worst;
}

/** How the ramp ended: 'limit' (a step failed — a real measurement), 'cap' (all passed — safe is a lower bound),
 *  'foreign_load' (someone else's load stopped us — the number is not a measurement). */
export function ended(done: Step[], abortedForLoad: boolean, limitMs = DATA_READY_LIMIT_MS): 'limit' | 'cap' | 'foreign_load' {
  if (done.some((s) => verdict(s, limitMs) !== 'pass')) return 'limit';
  return abortedForLoad ? 'foreign_load' : 'cap';
}

/** Milliseconds to wait for the next :10 UTC (0 when within its first 30 s), so every week measures the same quiet. */
export function msUntilWindow(now: Date): number {
  const t = new Date(now);
  t.setUTCMinutes(WINDOW_MINUTE, 0, 0);
  if (t.getTime() + 30_000 < now.getTime()) t.setUTCHours(t.getUTCHours() + 1);
  return Math.max(0, t.getTime() - now.getTime());
}
