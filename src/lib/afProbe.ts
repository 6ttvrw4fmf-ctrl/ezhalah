// UNKNOWN IS NOT NO — the Advanced Filter probe-outcome contract (owner 2026-08-26).
//
// «Known useless → hide AF. Couldn't determine because backend failed → keep AF available.»
//
// THE DEFECT THIS EXISTS FOR. Every Advanced Filter question earns its place by one live count RPC
// (rankQuestions → resolveOptions → a count fetcher). That probe is capped at AGE_COUNT_TIMEOUT_MS
// (4s), and until this module the timeout was collapsed into the SAME value as a real answer:
//
//     withTimeout(...)          -> { timedOut: true }
//     the fetcher               -> return null            // ← identical to "the query returned no rows"
//     guidedOptions(null, ...)  -> { options: [], total: 0 }   // ← identical to "this scope is empty"
//     scoreQuestion(...)        -> null                    // ← question dropped
//     startAgeFlow              -> empty plan -> setAgeFlow(null) + startRefine(q)
//
// So a transient network blip was rendered to the user as a settled verdict about their search:
// "there is nothing more worth asking about this", and they were quietly demoted to the legacy
// district/budget/beds chips. The user could not tell the difference, and neither could the code —
// by the third hop the information no longer existed.
//
// Measured: one count on a real 6-district Villa/Buy scope takes 920 ms and the five certified
// questions 3,433 ms server-side on a QUIET database, against a documented 338 ms/search baseline
// and a concurrency knee of 3 (docs/ops/SEARCH_MATCH_QA_ENGINEER.md §40.1). Five concurrent probes
// are already past the knee, so the 4s cap is reachable under ordinary load — this is not a
// hypothetical.
//
// This is the same rule the repo already enforces on the data side, where a failed fetch may never
// be written down as a negative fact: «403/429/timeout/5xx/blocked/unknown → NOT proof»
// (docs/ops/DATA_INTEGRITY_ENGINEER.md). Advanced Filter now obeys it too.
//
// PURE on purpose (no network, no React, no i18n) so scripts/verify-af-probe-failure-not-a-verdict.ts
// can EXECUTE the classification instead of grepping for it — the afPlan/afCohorts/afSteps precedent.

/** A probe that did not complete. Distinct from `null`, which means "the source answered: nothing". */
export const PROBE_FAILED = { __probeFailed: true } as const;
export type ProbeFailed = typeof PROBE_FAILED;

export const isProbeFailure = (v: unknown): v is ProbeFailed =>
  !!v && typeof v === 'object' && (v as { __probeFailed?: unknown }).__probeFailed === true;

/** What a batch of probes collectively established about a scope. */
export type ProbeVerdict =
  | 'useful'       // at least one question cleared the gates — open/continue the interview
  | 'known-empty'  // every probe ANSWERED, and the answer is "nothing useful here" — hide AF
  | 'unknown';     // at least one probe FAILED and nothing useful survived — AF availability is undecided

// The whole rule, in one place so no call site can re-derive it differently.
//
// `usefulCount`   questions that survived scoring (their probes answered AND they cleared the gates)
// `anyProbeFailed` did ANY probe in this batch fail to complete?
//
// A single useful question is enough to proceed (MIN_USEFUL_QUESTIONS_TO_SHOW is 1) even if others
// failed — we have something real to ask, so we ask it. Only when NOTHING useful survived does the
// distinction matter, and there a failure means we never learned the answer: 'unknown', never
// 'known-empty'. Erring the other way is exactly the bug: it converts our outage into their verdict.
export function probeVerdict(usefulCount: number, anyProbeFailed: boolean): ProbeVerdict {
  if (usefulCount > 0) return 'useful';
  return anyProbeFailed ? 'unknown' : 'known-empty';
}

/** May the interview OPEN on this verdict? Only on real, surviving usefulness — never on 'unknown'. */
export const mayOpenInterview = (v: ProbeVerdict): boolean => v === 'useful';

/**
 * On this verdict, may we tell the user there is nothing left to narrow — by closing AF and
 * offering the legacy refine chips in its place? ONLY when the sources actually said so.
 * 'unknown' must leave «تحديد أكثر» exactly where it was so the user can simply try again.
 */
export const mayAssertNothingToNarrow = (v: ProbeVerdict): boolean => v === 'known-empty';

/**
 * Should the batch be retried once before we act on it? A bounded single retry absorbs the
 * transient blip that causes most of these without turning the open into an unbounded wait.
 * Never retried on a decided verdict — re-probing a source that answered is pure latency.
 */
export const shouldRetryProbes = (v: ProbeVerdict, attempt: number): boolean =>
  v === 'unknown' && attempt === 0;
