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
  // COMPLETED SEARCH (owner 2026-08-30): Advanced Filter narrowed this chat to its final set (≤
  // INTERVIEW_STOP_AT, R11.1) or no useful question remained (R11.2). The conversation is done: the
  // composer is replaced by «محادثة جديدة» and a reopened/Back-navigated chat must NOT resurrect an
  // active composer. Optional and only ever `true`, so older transcripts and the persistence barrier's
  // literal round-trip are byte-identical when unset.
  completed?: true;
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
  completed?: boolean;
};

// Serialize the live screen state into a persistable transcript. Returns null when there is no
// conversation worth keeping (an empty chat, or only the typed-out greeting) so callers never
// store an entry that would restore to a blank screen.
export function serializeChat(live: LiveChatState): PersistedChat | null {
  const msgs: PersistedMsg[] = [];
  // Was the LAST results turn truncated? `completed` is a CLAIM about that turn — "every match is
  // already revealed" — and truncation is what makes the claim false. See the note below.
  let lastResultsTruncated = false;
  for (const m of live.msgs) {
    if (m.role !== 'user' && m.role !== 'agent' && m.role !== 'results') continue; // status = transient
    // Transient animation flags never persist: a restored chat renders in its final state.
    const { typing: _typing, ...rest } = m;
    if (m.role === 'results' && rest.result && Array.isArray(rest.result.listings)) {
      const r = rest.result;
      const revealed = live.revealCount[m.id] ?? TRANSCRIPT_FIRST_PAGE;
      const keep = Math.min(r.listings.length, Math.max(TRANSCRIPT_FIRST_PAGE, Math.min(revealed, TRANSCRIPT_LISTING_CAP)));
      lastResultsTruncated = keep < r.listings.length; // the LAST results turn's value is the one that stands
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
    // TRUNCATION AND TERMINALITY ARE ONE DECISION (2026-09-12, routine #8 — the seam between this
    // module's bound and the agent screen's terminal-chat rule).
    //
    // `completed` is not an ordinary field to copy: it is a CLAIM about the listings this same
    // function truncates twenty lines up. src/lib/afBrowsingGate.ts states the claim in its own
    // words — "the chat is terminal: the composer locks AND every remaining match is already
    // revealed. There is nothing to page" — and acts on it by withholding «عرض المزيد»
    // (`resultsActionsRowVisible`: `if (a.chatCompleted) return false`), while agent.tsx locks the
    // composer off the same flag. Both are RIGHT while the claim holds. Truncation is precisely
    // what falsifies it, and the truncation branch already knows: it rewrites `pageOffset`/
    // `hasMore` so paging can resume, then left the one flag that REVOKES paging untouched.
    //
    // MEASURED by executing the real serializeChat → restoreChat → resultCounts →
    // resultsActionsRowVisible chain: a 1,200-match search browsed to its end (all 1,200 on screen,
    // composer correctly locked) reopened as 60 cards of 1,200 with the pager withheld by
    // `completed` AND the composer locked by the same flag — 1,140 matches the user HAD on screen,
    // unreachable in that chat by any route. The boundary is exact: 60 kept = fine, 61 = dead end.
    //
    // So a truncated last turn is NOT terminal, and the honest transcript says so. Nothing is lost
    // by dropping the flag: the restored turn carries `hasMore: true` and `pageOffset: 0`, the user
    // pages back through it de-duped and gap-free (the mitigation this truncation already promises),
    // and `loadMore` re-sets `completed` on its own the moment the last match is revealed again.
    //
    // Only the LAST results turn can decide this, because only the newest turn carries live actions
    // (`isLatestResults`, owner 2026-08-24). An AF-completed chat (R11.1, ≤ INTERVIEW_STOP_AT = 25
    // rows — always under TRANSCRIPT_LISTING_CAP, so never truncated) keeps its lock exactly as
    // owner rule 2026-08-30 requires, even when an EARLIER, larger turn in the same chat was
    // truncated. Both directions are executed in scripts/verify-completed-chat-state.ts.
    ...(live.completed && !lastResultsTruncated ? { completed: true as const } : {}),
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
    ...(p.completed === true ? { completed: true as const } : {}),
    doneTyping,
  };
}

// THE PERSISTED SUBSET OF A RESTORED TRANSCRIPT — TOTAL BY CONSTRUCTION, NEVER A FIELD LIST.
//
// `restoreChat` returns the transcript PLUS `doneTyping`, which is render-only state and must not be
// stored again. The one caller that needs to hand a restored transcript back to storage
// (store.tsx's `hydrateTranscript`, the server-copy path) used to rebuild it field by field:
//
//     return { v: 1, msgs: valid.msgs, revealCount: valid.revealCount, afReceipt: valid.afReceipt,
//              guidedPills: valid.guidedPills };            // ← `completed` is not in the list
//
// and silently DROPPED `completed`. `completed?: true` is OPTIONAL on PersistedChat, so tsc cannot
// see the omission, and `restoreChat` — which preserves the flag correctly — sat one line above it.
// Measured by execution 2026-09-12 (routine #8): a chat the Advanced Filter truthfully finished,
// reopened through this path, came back with `completed` gone and therefore an ACTIVE composer —
// the exact state owner rule 2026-08-30 forbids in those words ("a reopened/Back-navigated chat must
// NOT resurrect an active composer"). The path is ordinary, not exotic: any chat older than
// LOCAL_TRANSCRIPT_ENTRIES (10) has no local transcript, and so does every chat opened on a second
// device, so both re-hydrate from the server through here.
//
// Removing ONE known field is total; listing the fields to keep is not. Every future field of
// PersistedChat survives this by construction, which is the whole point — the previous shape was a
// list someone had to remember to update, and nobody did.
export function persistedOnly(restored: PersistedChat & { doneTyping: Record<string, boolean> }): PersistedChat {
  const { doneTyping: _doneTyping, ...persisted } = restored;
  return persisted;
}

// Two serialized transcripts are the same conversation state — used by the capture effect to skip
// redundant writes (every settled turn triggers a capture; only real changes should hit storage).
export function sameTranscript(a: PersistedChat | null, b: PersistedChat | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
