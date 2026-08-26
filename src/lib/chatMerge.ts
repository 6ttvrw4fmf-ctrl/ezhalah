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
// precedent as afPlan/afCohorts/afSteps/sidebarReorder.

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
//   fetchServer — pulls the server copy; returns null when the server has none or is unreachable
//
// Precedence: a trusted local copy is instant and wins. A STALE local copy must yield to the server;
// only if the server genuinely has nothing do we fall back to it rather than showing a blank chat.
export async function pickTranscript<T>(
  held: T | undefined,
  heldStale: boolean,
  fetchServer: () => Promise<T | null>,
): Promise<T | null> {
  if (held !== undefined && !heldStale) return held;
  const server = await fetchServer();
  if (server != null) return server;
  return held ?? null;                                  // server has none → never lose what we have
}

// Once a fresh transcript is attached (from the server, or captured locally), the entry is no longer
// stale. Kept here so no call site has to remember to clear the flag by hand.
export function withFreshTranscript<T extends MergeableEntry>(entry: T, transcript: unknown, tRev: number): T {
  const { txStale: _drop, ...rest } = entry;
  return { ...(rest as T), transcript, tRev };
}
