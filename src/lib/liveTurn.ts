// WHICH RESULTS TURN IS STILL THE LIVE ONE — the derivation, pure so a barrier can EXECUTE it
// rather than read a copy of it (same rule as src/lib/initialReveal.ts's header).
//
// WHY THIS EXISTS (ops_incident #338, measured on production 2026-09-22, reproduced 4/4).
// `agent.tsx` finds the newest results turn by scanning back for `role === 'results'`. That getter
// answers "which turn is newest" — and the scroll-reveal handler was using it to answer a DIFFERENT
// question: "which turn may I still add cards to?". The two come apart for the whole ~10s searching
// beat, because a turn being born is a 'status' message, so the newest 'results' message is still
// the one the user just LEFT.
//
// Consequence, measured on الرياض/شراء/شقة: committing one Advanced Filter answer landed a 2,925
// turn showing 24 cards. Tapping ✕ on its pill re-ran the search correctly on the wire (R9.2.1 held)
// while the app's own programmatic scroll during the beat drove that OUTGOING turn 24 → 48 cards and
// rewrote its closing line «عرضت لك أول 24 من أصل 2,925» → «عرضت لك أول 48». R9.2.2 says a removal
// lands a new turn below and rewrites NOTHING above it; R12.3 says older turns are read-only history.
//
// THE RULE: walk back from the end. The first 'results' met means that turn is still live. A
// 'status' (a turn being born) or a 'user' bubble met FIRST means the user has moved on and the turn
// below them is history — frozen, never extended.
//
// Not `busy`: that flag is also true in windows with nothing to do with the transcript. Not
// `msgs[last].role === 'results'`: that would also freeze a turn sitting behind a plain agent bubble
// (a clarifying question re-searches LATER — until it does, that turn is still the live one). The
// Advanced Filter round card is `ageFlow` state and not a message at all, so an open round leaves
// this false and scroll-reveal keeps working underneath it exactly as it did before.
export function newerTurnPending(msgs: ReadonlyArray<{ role: string }> | null | undefined): boolean {
  const list = msgs ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const role = list[i]?.role;
    if (role === 'results') return false;
    if (role === 'status' || role === 'user') return true;
  }
  return false;
}
