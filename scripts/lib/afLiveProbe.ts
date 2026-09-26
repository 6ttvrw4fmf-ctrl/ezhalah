// A SCHEMA-CACHE RELOAD IS NOT AN AF DEFECT — AND THE AF LIVE SUITE WAS CALLING IT ONE
// (routine #5, 2026-09-26, ops_incident #563 / alert 1434).
//
// THE DEFECT, measured on production today. `af-live-truth-check.yml` run 36230103230 reported five
// red steps. Three of them were this, verbatim:
//
//     FAIL  Warehouse/Buy: cell completed without a harness error
//           HTTP 503: {"code":"PGRST002","message":"Could not query the database for the schema
//                      cache. Retrying."}
//     FAIL  Villa/Buy @region:1 · amenities(chat-only):separate_electricity_meter
//           probe error: REST 503 on search_listings_ar?select=… {"code":"PGRST002"…}
//     Error: RPC location_search_candidates_ar 503: {"code":"PGRST002"…}   ← killed the whole sweep
//
// PGRST002 is PostgREST reloading its schema cache, which is what ANY migration creating or
// replacing a function triggers. Five such migrations landed today between 09:40 and 10:13
// (`wahadat_*`, another routine onboarding a platform); the 09:59 and 10:05 failures sit inside that
// window. So another session's ordinary platform onboarding made this suite name healthy AF cohorts
// as defective — and because this workflow's only channel to a human is `alert_event`, the P1
// `af_live_check_failed` row (alert 1434) has stood open and been re-affirmed daily since
// 2026-09-04. A gate whose verdict is decided by whoever applied a migration in the last minute is
// not a gate; a genuine AF regression would land inside that noise unnoticed.
//
// WHY THE EXISTING RETRIES DID NOT HELP, and this is the part worth remembering. Two of the three
// scripts already had retry code:
//
//   * verify-af-matrix-truth-live.ts rolled its own — 4 attempts, 800/1600/2400/3200ms, ~8s total,
//     under a comment reading "a production hiccup is not a predicate defect". REPRODUCED against a
//     stub holding PGRST002 for 15s: 4 probes taken, all 503, then throw. Its budget was GUESSED.
//   * verify-af-full-surface-differential.ts had none on `rest()`/`rpc()` (dies on the first 503,
//     reproduced: 1 probe, uncaught throw, 5,000+ checks of work discarded) and — worse — its
//     `oracleCount()` read `content-range` without ever checking `r.ok`, so a 503 returned `null`,
//     which that caller cannot tell apart from "the oracle could not express this predicate". That
//     is AGENTS.md's own named class, A FAILED FETCH IS NOT AN EMPTY ANSWER, inside my own oracle.
//
// The repo had already measured this and written the answer down: scripts/lib/postgrestRetry.ts,
// ~30s declared / ~15s wall-clock of patience across 5 attempts, retrying ONLY a 503 whose JSON
// `code` is exactly PGRST002. CONTROL, same stub, same 15s window that beat both budgets above:
//     driver → status=200 ok=true  elapsed=15,086ms      (survives)
//     driver vs a window that NEVER closes (900s) → status=503 ok=false  (still fails; not softened)
// So this file adds NO new retry policy. AGENTS.md: "The mechanism already exists — do not invent a
// second one." It imports the one driver and deletes the hand-rolled budgets.
//
// WHAT IS GENUINELY NEW HERE IS THE VERDICT, and it is the half that keeps working when a reload
// outlasts even the measured budget. A spent budget must be reported as an UNMEASURED CELL, never as
// an accusation naming a cohort. `cell completed without a harness error` was the worst possible
// wording: it names a product cohort AND asserts the instrument was fine. So a genuine reload that
// outlives the budget raises SchemaCacheUnresolved, which callers report as infrastructure and count
// as UNDECIDED — the vocabulary scripts/lib/afSurfaceJudge.ts already uses for a comparison that
// straddled an index rebuild.
//
// UNDECIDED STILL FAILS THE RUN. This is never a route to green (AF_TRENDING_DATA_INTEGRITY_ENGINEER
// .md PART 7, "Never fake green": a surface that could not be exercised is reported as NOT VERIFIED,
// never folded into a passing count). The change is what the run SAYS, not whether it passes.
//
// THIS MODULE IMPORTS ONLY postgrestRetry.ts, which imports nothing — deliberately, for the same
// reason that file gives: anything reaching scripts/lib/public-supabase.ts would make every barrier
// importing this one a live-reaching candidate and redden verify-required-suite-is-hermetic.ts.
//
// Coverage of this driver across the AF live suite is measured by
// scripts/verify-af-live-checks-survive-schema-cache-reload.ts (in `npm test`) — because a proof
// about a mechanism is not a measurement of who uses it, which is exactly how this class survived
// ops_incident #573's repair and routine #10's PR-gate ratchet to reach my suite untouched.

import {
  DEFAULT_RETRY,
  fetchRetryingSchemaCacheReload,
  isSchemaCacheReload,
  type Probe,
  type RetryOpts,
} from './postgrestRetry.ts';

export { isSchemaCacheReload, type Probe, type RetryOpts };

/**
 * The schema cache was STILL reloading when the measured budget ran out.
 *
 * A distinct type, not a message prefix, because the whole point is that a caller can branch on it:
 * an accusation against a cohort and "I could not measure this cell" are different verdicts and a
 * string comparison is how they get conflated again.
 */
export class SchemaCacheUnresolved extends Error {
  readonly what: string;

  constructor(what: string, body: string) {
    super(
      `the PostgREST schema cache was still reloading after the full retry budget while reading ${what} `
      + `— this cell was NOT measured, and says nothing about the product: ${body.slice(0, 160)}`,
    );
    this.name = 'SchemaCacheUnresolved';
    this.what = what;
  }
}

export const isSchemaCacheUnresolved = (e: unknown): e is SchemaCacheUnresolved =>
  e instanceof SchemaCacheUnresolved;

/**
 * Take one probe, retrying ONLY a schema-cache reload, and hand back whatever really came out.
 *
 * Returns the probe rather than throwing, so a caller that already classifies statuses itself (a 416
 * on an empty Range, say) keeps doing that on its own terms.
 */
export async function afProbeFetch(
  url: string,
  init: RequestInit = {},
  opts: RetryOpts = DEFAULT_RETRY,
): Promise<Probe> {
  return fetchRetryingSchemaCacheReload(url, init, opts);
}

/**
 * The shape almost every caller wants: a probe that must be ok, with the two failures kept apart.
 *
 * - a reload that outlasted the budget  → SchemaCacheUnresolved (infrastructure; cell NOT measured)
 * - anything else not-ok               → a plain Error (a real failure, judged on its own terms)
 *
 * `accept` lets a caller keep a status it treats as success (416 for a Range past the end is the one
 * this suite actually uses). It is applied AFTER the reload classification, so it can never be used
 * to wave a reload through.
 */
export async function afProbeOk(
  what: string,
  url: string,
  init: RequestInit = {},
  accept: number[] = [],
  opts: RetryOpts = DEFAULT_RETRY,
): Promise<Probe> {
  const p = await afProbeFetch(url, init, opts);
  if (p.ok || accept.includes(p.status)) return p;
  if (isSchemaCacheReload(p.status, p.body)) throw new SchemaCacheUnresolved(what, p.body);
  throw new Error(`${what} — HTTP ${p.status}: ${p.body.slice(0, 200)}`);
}

/** `afProbeOk` for an RPC POST, since every caller in this suite writes the same six arguments. */
export async function afRpcOk(
  restBase: string,
  headers: Record<string, string>,
  name: string,
  body: Record<string, unknown>,
  opts: RetryOpts = DEFAULT_RETRY,
): Promise<Probe> {
  return afProbeOk(
    `RPC ${name}`,
    `${restBase}/rest/v1/rpc/${name}`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    [],
    opts,
  );
}

/** The exact count PostgREST puts in `content-range`, or null when it did not send one. */
export const contentRangeTotal = (p: Probe): number | null => {
  const cr = p.headers.get('content-range') || '';
  if (!cr.includes('/')) return null;
  const n = Number(cr.split('/')[1]);
  return Number.isFinite(n) ? n : null;
};
