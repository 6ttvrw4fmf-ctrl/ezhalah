// A SCHEMA-CACHE RELOAD IS NOT AN OUTAGE — AND IT IS NOT A FLAKE EITHER (ops_incident #573).
//
// THE DEFECT, measured 2026-09-21 by routine-11 while applying migration 20260921184156.
// `npm test` went RED on verify-orphaned-detector-meta-check.ts with
//
//     mon_orphaned_detectors() -> HTTP 503 {"code":"PGRST002","message":"Could not query the
//                                 database for the schema cache. Retrying."}
//
// The same head had passed minutes earlier; one re-run went green. PGRST002 is PostgREST reloading
// its schema cache, which is exactly what ANY migration that creates or replaces a function
// triggers. `npm test` is the REQUIRED status check on every PR, so applying such a migration opens
// a window in which the required check fails for EVERY OPEN PR IN THE REPO — the same global blast
// radius AGENTS.md documents for the migration drift gate. Measured that day: 5 migrations from 3
// concurrent sessions between 15:29 and 18:41, so the window opens often.
//
// WHAT THIS IS NOT. It is not a flake dismissal, and it is NOT a weakening (BARRIER_ENGINEER.md
// Prohibition 1). PGRST002 is a SPECIFIC, self-describing, transient state that says "Retrying." in
// its own message body. The repair is to make the check DISTINGUISH that one state from every other
// failure — not to soften what it concludes about any of them:
//
//   * ONLY status 503 carrying a JSON body whose `code` field is EXACTLY "PGRST002" is retried.
//   * Every other failure — any other status, any other code, a body that merely MENTIONS PGRST002
//     in its message text, a non-JSON body, a timeout — is returned on the FIRST attempt, unretried.
//   * The retry is BOUNDED. When the budget is spent the last probe is returned as-is, still
//     not-ok, and the caller still fails. A schema cache that cannot load for the whole budget is a
//     real problem and stays RED.
//
// FAIL-CLOSED BY CONSTRUCTION, not by remembering. This driver never returns a synthesised success
// and never swallows a probe: it hands back the LAST probe it actually took, so a caller that
// checks `ok` (all four of them do) keeps exactly the verdict it had before — only later, and only
// for this one code. There is no path through this file that turns a not-ok into an ok.
//
// Proven in scripts/verify-schema-cache-retry-is-not-fail-open.ts (in `npm test`).
//
// THIS FILE IMPORTS NOTHING, DELIBERATELY. An earlier draft exported an `anonHeaders()` convenience
// that called resolvePublicSupabase(); no caller used it, and it pulled scripts/lib/public-supabase.ts
// into the module graph of every check importing this one — which made the proof file itself a
// live-reaching candidate and turned verify-required-suite-is-hermetic.ts RED (the ratchet working
// exactly as designed, on its own author). Declaring the row would have been the weaker repair.
// Keep this module dependency-free so the proofs over it stay hermetic.

/**
 * One completed HTTP attempt, body already drained so it can be classified and reused.
 *
 * `headers` is carried because two of the four callers read `content-range` for an exact count —
 * dropping it would have forced them to keep a second, unretried fetch path, which is how a
 * "shared" wrapper quietly stops covering half its callers.
 */
export type Probe = { status: number; ok: boolean; body: string; headers: Headers };

/** PostgREST's code for "the schema cache is reloading, retry" — the ONE transient we retry. */
export const SCHEMA_CACHE_RELOAD = 'PGRST002';

/**
 * THE CLASSIFIER, pure so a mutation can hand it every near-miss.
 *
 * Deliberately strict in BOTH dimensions. The substring test (`body.includes('PGRST002')`) is the
 * obvious implementation and is the fail-OPEN one: a genuine error whose message quotes the code —
 * or a row of real data containing it — would then be retried and could be masked. So the body must
 * PARSE as a JSON object and its `code` field must equal the constant exactly. The status must be
 * 503, which is what PostgREST actually sends for it; anything else is judged on its own terms.
 */
export function isSchemaCacheReload(status: number, body: string): boolean {
  if (status !== 503) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  return (parsed as Record<string, unknown>).code === SCHEMA_CACHE_RELOAD;
}

export type RetryOpts = {
  /** Total attempts INCLUDING the first. 1 disables retrying entirely. */
  attempts: number;
  /** Backoff before attempt n (1-based: delayMs(1) precedes the SECOND attempt). */
  delayMs: (n: number) => number;
  /** Injected so the proofs run without real time passing. */
  sleep: (ms: number) => Promise<void>;
};

/** ~30s of total patience across 5 attempts: enough for a cache reload, short of an outage. */
export const DEFAULT_RETRY: RetryOpts = {
  attempts: 5,
  delayMs: (n) => [1000, 2000, 4000, 8000, 15000][n - 1] ?? 15000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Run `once` until it returns something that is NOT a schema-cache reload, or the budget is spent.
 *
 * Returns the LAST probe taken, whatever it is. It cannot manufacture a success: every return value
 * is a probe `once` really produced.
 */
export async function retryingSchemaCacheReload(
  once: () => Promise<Probe>,
  opts: RetryOpts = DEFAULT_RETRY,
): Promise<Probe> {
  const budget = Math.max(1, opts.attempts);
  let probe = await once();
  for (let n = 1; n < budget && isSchemaCacheReload(probe.status, probe.body); n++) {
    await opts.sleep(opts.delayMs(n));
    probe = await once();
  }
  return probe;
}

/** The shape all four live required checks need: fetch, drain the body, retry only the reload. */
export async function fetchRetryingSchemaCacheReload(
  url: string,
  init: RequestInit = {},
  opts: RetryOpts = DEFAULT_RETRY,
): Promise<Probe> {
  return retryingSchemaCacheReload(async () => {
    const r = await fetch(url, init);
    const body = await r.text();
    return { status: r.status, ok: r.ok, body, headers: r.headers };
  }, opts);
}
