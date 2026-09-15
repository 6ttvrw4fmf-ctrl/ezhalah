// TRANSCRIPT PRECEDENCE — which copy of a conversation wins (owner 2026-08-25, release-blocking).
//
// «Losing or partially restoring a user's chat history is a trust-breaking bug.» The subtlest way to
// lose history is not to fail to save it — it is to save it correctly on the server and then let a
// STALE LOCAL CACHE win on read, because the capture effect will re-serialize that shorter view and
// push it back up, overwriting the good copy. The loss is then permanent and silent.
//
// THE DEFECT THIS FIXES (found 2026-08-25 by reading the merge against hydrateTranscript):
//   1. Device A holds chat C with 3 turns cached locally.
//   2. The user continues C on device B → the server now holds 8 turns with a newer `tRev`.
//   3. Device A signs in. The meta merge sees serverStamp > localStamp and took the SERVER meta but
//      deliberately carried `transcript: local.transcript` forward — so the entry now pairs the
//      server's NEW tRev with the LOCAL 3-turn transcript.
//   4. hydrateTranscript did `if (held) return held` with no staleness test → renders 3 turns.
//   5. The capture effect re-serializes those 3 turns and pushes them up. The 8-turn transcript is
//      GONE. Five turns of the user's work destroyed, no error, no way back.
//
// THE RULE, stated once so both call sites cannot drift: a local transcript may only be trusted when
// this device's cached copy is at least as new as the activity the server reports for that chat.
// Otherwise the server copy wins — and if the server has none (legacy chat, or an offline device),
// the local copy is still better than nothing and is kept. Newer wins; nothing is ever discarded for
// being merely un-verifiable.
//
// PURE on purpose (no storage, no network, no React) so scripts/verify-transcript-integrity.ts can
// EXECUTE these decisions with real inputs instead of grepping for them — the same extraction
// precedent as afPlan/afCohorts/afSteps/sidebarReorder. (afProbe is pure too, so importing its
// sentinel keeps that property.)
// Relative + explicit .ts, the convention every pure lib a barrier EXECUTES directly already uses
// (afCarry/afCertify): scripts/verify-transcript-integrity.ts imports this file straight through
// node, where the `@/` alias does not resolve.
import { isProbeFailure, type ProbeFailed } from './afProbe.ts';

// The fields of a history entry this module reasons about. Deliberately structural, not the full
// HistoryItem, so store.tsx can evolve without dragging this contract along.
export type MergeableEntry = {
  id: string;
  ts: number;
  tRev?: number;
  transcript?: unknown;
  snapshot?: unknown;
  /** Set when the meta merge learned the server holds newer activity than this device's transcript. */
  txStale?: boolean;
};

export type ServerMeta = { id: string; ts: number; tRev?: number } & Record<string, unknown>;

// A chat's ACTIVITY STAMP. `ts` is when the search last ran; `tRev` is when the transcript last
// changed. Either can be the newer signal (revealing more cards bumps only tRev; a fresh search
// bumps only ts), so the stamp is the max — the same rule the sidebar's activity sort uses.
export const activityStamp = (e: { ts?: number; tRev?: number } | null | undefined): number =>
  e ? Math.max(e.ts ?? 0, e.tRev ?? 0) : -1;

// Decide, for ONE chat, what the merged entry should be.
//
// Returns the entry to store. The load-bearing decision is `txStale`: when the server reports newer
// activity we keep the local transcript as an OFFLINE FALLBACK but mark it not-to-be-trusted, so
// hydrateTranscript re-fetches instead of rendering it. We do not simply drop it, because the server
// may hold no transcript at all for this chat (legacy rows predate the transcript column) and
// dropping would turn "stale" into "lost".
export function mergeOne(local: MergeableEntry | undefined, server: ServerMeta): MergeableEntry {
  const meta = { ...server } as unknown as MergeableEntry;
  if (!local) return meta;
  const localStamp = activityStamp(local);
  const serverStamp = activityStamp(server);
  if (serverStamp <= localStamp) return local;         // local is newer or equal → local wins whole
  return {
    ...meta,
    snapshot: local.snapshot,
    transcript: local.transcript,
    // THE FIX: the carried-over transcript is older than the server's activity. Never render it
    // without checking the server first, and never let it be pushed back up over the newer copy.
    ...(local.transcript !== undefined ? { txStale: true } : {}),
  };
}

// Which transcript should actually be RENDERED for an opened chat.
//
//   held        — this device's cached transcript (may be undefined)
//   heldStale   — mergeOne marked it older than the server's activity
//   fetchServer — pulls the server copy: the transcript, `null` when the server ANSWERED and has
//                 none, or PROBE_FAILED when we never found out (network, RLS, timeout)
//
// Precedence: a trusted local copy is instant and wins. A STALE local copy must yield to the server;
// only if the server genuinely has nothing do we fall back to it rather than showing a blank chat.
//
// THE THIRD OUTCOME, and why this returns a pair (ops_incident #272, P1). «Unreachable» used to
// collapse into «the server has none», so a transient failure took the fallback branch and handed
// back the stale copy as if it had been checked. hydrateTranscript then cleared `txStale` on it —
// and a cleared flag is exactly what makes a transcript PUSHABLE (store.tsx pushableTranscript), so
// the next meta edit wrote the short local copy over the longer server one. Permanently, silently:
// the precise loss this whole module was written to prevent, defeated by a failed request rather
// than by a merge mistake.
//
// So the answer carries its own provenance. `verified: false` means "this is the best we have, and
// we could not confirm it" — render it, never promote it.
export type PickedTranscript<T> = {
  transcript: T | null;
  /** Did the server actually answer? Only a verified transcript may clear `txStale`. */
  verified: boolean;
};

export async function pickTranscript<T>(
  held: T | undefined,
  heldStale: boolean,
  fetchServer: () => Promise<T | null | ProbeFailed>,
): Promise<PickedTranscript<T>> {
  if (held !== undefined && !heldStale) return { transcript: held, verified: true };
  const server = await fetchServer();
  if (isProbeFailure(server)) {
    // UNKNOWN, not "none". Show the user their conversation rather than a blank chat — but the copy
    // stays unverified, so the caller leaves it stale and it can never be pushed up.
    return { transcript: held ?? null, verified: false };
  }
  if (server != null) return { transcript: server, verified: true };
  return { transcript: held ?? null, verified: true };  // server has none → never lose what we have
}

// May a hydration result be WRITTEN BACK into the history entry — i.e. passed to
// withFreshTranscript, which clears `txStale` and thereby makes the transcript pushable?
//
// This is the single load-bearing line of ops_incident #272, so it lives here as a pure predicate
// rather than as a condition spelled out at the call site: a barrier can EXECUTE its whole truth
// table, which a source-text tripwire over store.tsx could only ever read. Promotion requires the
// server to have ANSWERED. An unverified copy is fine to render and must never be promoted —
// promoting it is precisely what overwrote the newer server transcript.
export const mayPromoteTranscript = <T>(picked: PickedTranscript<T>): boolean =>
  picked.verified && picked.transcript != null;

// Once a fresh transcript is attached (from the server, or captured locally), the entry is no longer
// stale. Kept here so no call site has to remember to clear the flag by hand.
export function withFreshTranscript<T extends MergeableEntry>(entry: T, transcript: unknown, tRev: number): T {
  const { txStale: _drop, ...rest } = entry;
  return { ...(rest as T), transcript, tRev };
}
