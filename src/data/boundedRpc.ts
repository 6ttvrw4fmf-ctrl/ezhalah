// A BOUNDED AWAIT FOR THE IMPORT-LIGHT DATA MODULES.
//
// AGENTS.md: *"every RPC must bound its await — a call with no timeout wedges the loader forever,
// which reads to a user as a hang, not an error."* `src/data/remote.ts` has had its own `bounded()`
// for exactly this since the «إزهله يبحث» loader spun forever with no recovery. The two
// search-loading reads could not use it, and so had no bound at all (ops_incident #269, measured
// 2026-09-14: 16 RPC call sites, 13 bounded, 3 not).
//
// WHY THIS IS A SEPARATE FILE AND NOT AN IMPORT OF remote.ts's `bounded`. `loaderActivePlatforms.ts`
// and `loaderScaleStats.ts` are deliberately import-light — `loaderPlatforms.ts` records the reason
// in its own header: the runtime truth source lives apart so the module stays loadable in a plain
// Node test process. Importing `remote.ts` would pull the entire search layer in behind it and
// destroy that property. remote.ts's `bounded()` also carries a second job this one does not need
// (linking an EXTERNAL AbortSignal and reporting `cancelled`, which the Stop path depends on and
// `scripts/verify-filter-stop-cancels-and-restores.ts` pins), so re-pointing it here would put a
// proven cancellation path at risk to remove a duplication that is only ~10 lines.
//
// The invariant both implementations share is the only thing that matters and the only thing the
// ratchet checks: THIS AWAIT CANNOT LAST FOREVER. This one uses `.abortSignal()`, which
// `scripts/verify-every-rpc-call-is-bounded.ts` already accepts as one of the repo's three real
// bounding mechanisms — it is not a fourth mechanism, it is the second one, applied here.
//
// FAILING CLOSED IS PRESERVED, NOT ADDED. Both callers already returned `null` on error and their
// callers already fall back to numberless copy (proven by execution in
// `scripts/verify-search-loader-scale-numbers.ts`). A timeout now takes that SAME path instead of
// never returning — so the user sees the loader's numberless copy rather than a spinner that never
// resolves. It is never rendered as a zero or an empty answer: that is the
// "A FAILED FETCH IS NOT AN EMPTY ANSWER" rule, and it keeps holding here.

/** Same default as remote.ts's RPC_TIMEOUT_MS, and the same env override, so the app has ONE number. */
export const RPC_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_RPC_TIMEOUT_MS) || 15000;

/**
 * Await a PostgREST builder with a hard ceiling.
 *
 * Returns the supabase-js shape on both paths — `{ data, error }` — so a caller that already
 * branches on `error` needs no new branch for a timeout. On expiry the result is
 * `{ data: null, error: { …, timeout: true } }`, which is distinguishable from a genuine empty
 * answer by the caller that cares to look.
 */
export async function boundedRpc<T = unknown>(
  builder: { abortSignal: (s: AbortSignal) => PromiseLike<{ data: T | null; error: unknown }> },
  ms: number = RPC_TIMEOUT_MS,
): Promise<{ data: T | null; error: unknown }> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // THE RACE IS NOT REDUNDANT WITH THE ABORT, and that distinction is the whole guarantee.
  //
  // Aborting asks the TRANSPORT to give up; racing makes THIS AWAIT end whether or not it obliges.
  // An abort-only bound is conditional on every layer beneath us honouring the signal, and a layer
  // that quietly ignores it puts the hang straight back — with a timeout in the source, so the next
  // reader would believe the wait was bounded when it was not. That is precisely the shape AGENTS.md
  // warns about: a pointer reads as coverage. Measured while writing this file's barrier — a builder
  // that ignores the signal left the abort-only version pending forever, and
  // `scripts/verify-search-loader-scale-numbers.ts` now executes exactly that case.
  //
  // Both halves are kept: the race bounds the caller, and the abort still releases the connection
  // instead of leaking a request nobody is waiting for.
  const timeout = new Promise<{ data: T | null; error: unknown }>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve({ data: null, error: { message: `RPC exceeded ${ms}ms`, timeout: true } });
    }, ms);
  });

  const call = (async () => {
    try {
      return await builder.abortSignal(ctrl.signal);
    } catch (e: unknown) {
      const message = String((e as { message?: unknown })?.message ?? e);
      return { data: null, error: { message, timeout: true } };
    }
  })();

  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
