// FULL-CONVERSATION PERSISTENCE (owner 2026-08-25): «treat Ezhalah's chat like ChatGPT in terms of
// persistence». A chat the user returns to must show EXACTLY the conversation they left — every
// user/agent bubble, every results turn with its cards, every Advanced Filter round's receipt and
// cumulative pills, and the «عرض المزيد» pages they revealed — and it must survive a refresh, a
// closed browser, and logging back in. This module is the PURE serialization layer: what of the
// agent screen's live state is persisted, how it is bounded, and how it is validated back. It never
// touches storage or the network (store.tsx owns local persistence + server sync; agent.tsx owns
// capture/restore timing), so a barrier can execute these rules directly.
//
// NOT A PARALLEL HISTORY. The transcript is the exact `msgs` array the screen rendered (minus
// transient animation state), captured AFTER each turn settles — never a reconstruction that could
// drift from what the search actually returned. Restore renders these messages verbatim; live
// actions («عرض المزيد», «تحديد أكثر») keep operating on the restored turns' own embedded queries
// and paging state, so continuing a restored conversation is the same code path as continuing a
// live one.

// The subset of the agent screen's per-chat state that fully reproduces the conversation view.
// `msgs` entries are the agent's ChatMsg objects (roles user/agent/results — `status` is transient
// by definition and never persisted). Kept structurally loose here (Record) because ChatMsg is
// screen-local; validation below checks the load-bearing fields instead of the whole shape.
export type PersistedMsg = Record<string, unknown> & { id: string; role: 'user' | 'agent' | 'results' };
export type PersistedChat = {
  v: 1;
  msgs: PersistedMsg[];
  // How many cards each results turn had revealed («عرض المزيد» presses included) — restore shows
  // the same cards, not a reset first page.
  revealCount: Record<string, number>;
  // Completed Advanced Filter rounds' receipts (msgId → committed-answers summary line).
  afReceipt: Record<string, string>;
  // The cumulative AF pills record (committed facets + asked/skipped ids, anchored to the origin
  // query) — restoring it keeps answers removable and stops the next round re-asking them.
  guidedPills: { msgId: string; baseQ: unknown; facets: unknown[]; asked: string[]; total: number | null } | null;
};

// Bounds. Listings dominate transcript size (a card is ~1-2KB of JSON); everything else is text.
// Per results turn we keep what the user actually saw (their reveal state), floored at the first
// page and capped hard — a truncated turn restarts paging at 0 with hasMore, and loadMore already
// de-dups against held cards, so continuation is gap-free (the exact rule store.tsx's snapshot
// truncation established). LOCAL_TRANSCRIPT_ENTRIES bounds how many chats keep their transcript in
// localStorage (the server keeps all of them; older local ones re-hydrate from the server on open).
export const TRANSCRIPT_LISTING_CAP = 60;
export const TRANSCRIPT_FIRST_PAGE = 10;
export const LOCAL_TRANSCRIPT_ENTRIES = 10;

type LiveChatState = {
  msgs: Array<Record<string, any> & { id: string; role: string }>;
  revealCount: Record<string, number>;
  afReceipt: Record<string, string>;
  guidedPills: { msgId: string; baseQ: unknown; facets: unknown[]; asked: string[]; total: number | null } | null;
};

// Serialize the live screen state into a persistable transcript. Returns null when there is no
// conversation worth keeping (an empty chat, or only the typed-out greeting) so callers never
// store an entry that would restore to a blank screen.
export function serializeChat(live: LiveChatState): PersistedChat | null {
  const msgs: PersistedMsg[] = [];
  for (const m of live.msgs) {
    if (m.role !== 'user' && m.role !== 'agent' && m.role !== 'results') continue; // status = transient
    // Transient animation flags never persist: a restored chat renders in its final state.
    const { typing: _typing, ...rest } = m;
    if (m.role === 'results' && rest.result && Array.isArray(rest.result.listings)) {
      const r = rest.result;
      const revealed = live.revealCount[m.id] ?? TRANSCRIPT_FIRST_PAGE;
      const keep = Math.min(r.listings.length, Math.max(TRANSCRIPT_FIRST_PAGE, Math.min(revealed, TRANSCRIPT_LISTING_CAP)));
      if (keep < r.listings.length) {
        // Truncated ⇒ restart paging (store.tsx snapshot precedent): loadMore de-dups, gap-free.
        rest.result = { ...r, listings: r.listings.slice(0, keep), pageOffset: 0, hasMore: true };
      }
    }
    msgs.push(rest as PersistedMsg);
  }
  // Nothing to keep: no user turn and no results turn (a lone greeting bubble is the empty state).
  if (!msgs.some((m) => m.role === 'user' || m.role === 'results')) return null;
  const kept = new Set(msgs.map((m) => m.id));
  const revealCount: Record<string, number> = {};
  for (const [id, n] of Object.entries(live.revealCount)) if (kept.has(id) && n > 0) revealCount[id] = Math.min(n, TRANSCRIPT_LISTING_CAP);
  const afReceipt: Record<string, string> = {};
  for (const [id, s] of Object.entries(live.afReceipt)) if (kept.has(id) && s) afReceipt[id] = s;
  const gp = live.guidedPills;
  return {
    v: 1,
    msgs,
    revealCount,
    afReceipt,
    guidedPills: gp && kept.has(gp.msgId)
      ? { msgId: gp.msgId, baseQ: gp.baseQ, facets: gp.facets, asked: gp.asked, total: gp.total }
      : null,
  };
}

// Validate a stored transcript back into restorable state. Storage contents are DATA, not trusted
// state: anything structurally off (wrong version, missing ids, non-array msgs) returns null and
// the caller falls back to the legacy snapshot/replay path rather than rendering garbage.
export function restoreChat(raw: unknown): (PersistedChat & { doneTyping: Record<string, boolean> }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as PersistedChat;
  if (p.v !== 1 || !Array.isArray(p.msgs) || p.msgs.length === 0) return null;
  for (const m of p.msgs) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') return null;
    if (m.role !== 'user' && m.role !== 'agent' && m.role !== 'results') return null;
    if (m.role === 'results' && !Array.isArray((m as any).result?.listings)) return null;
  }
  const doneTyping: Record<string, boolean> = {};
  for (const m of p.msgs) doneTyping[m.id] = true; // restored = final state, nothing re-types
  return {
    v: 1,
    msgs: p.msgs,
    revealCount: p.revealCount && typeof p.revealCount === 'object' ? p.revealCount : {},
    afReceipt: p.afReceipt && typeof p.afReceipt === 'object' ? p.afReceipt : {},
    guidedPills: p.guidedPills && typeof p.guidedPills.msgId === 'string' && Array.isArray(p.guidedPills.asked)
      ? p.guidedPills
      : null,
    doneTyping,
  };
}

// Two serialized transcripts are the same conversation state — used by the capture effect to skip
// redundant writes (every settled turn triggers a capture; only real changes should hit storage).
export function sameTranscript(a: PersistedChat | null, b: PersistedChat | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
