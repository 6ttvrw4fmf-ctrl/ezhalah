// GATE for src/app/agent.tsx's deterministic location backstop (locationClarification).
//
// Owner-reported live bug 2026-08-30: "السلام عليكم / ايش عندك / ماعرف عندك شيء حلو عندي ٥ عيال /
// عادي الاثنين ماعندي مشكلة بس شيء كبير" — real non-location signal (family of 5 -> a large
// villa/apartment, open to either type) — but the app never showed a single listing.
//
// ROOT CAUSE: two independent, unsynchronized "ask up to 2 times" budgets. The model's own budget is
// enforced server-side (supabase/functions/agent/index.ts counts prior model "?" replies and, once
// there are 2, instructs the model to search NOW with whatever it has). The CLIENT had its OWN
// separate askCountRef, always starting at 0 for the location question specifically — so once the
// model finally complied and returned kind="listings" with location "" (a legitimate nationwide
// search, per its own instructions), the client re-asked "which city?" anyway, discarding the
// model's decision. From the user's perspective that is a THIRD/FOURTH clarifying question, not
// results — exactly "never actually showed me any listings".
//
// FIX: once the model has already asked its own 2 questions this chat, trust a resulting
// kind="listings" decision — search now (broad/nationwide when location is "" — never invent a
// city) instead of re-litigating it with another question.
//
// Deliberately zero-dependency (same shape as src/lib/regionOrCityAnswer.ts) so
// scripts/verify-agent-broad-search-after-budget.ts can import and execute it from plain Node.

export type AgentHistoryTurnLike = { role: 'user' | 'model'; text: string };

export function shouldAskLocationInsteadOfSearching(
  clarifyQ: string | null,
  askCount: number,
  history: AgentHistoryTurnLike[],
): boolean {
  if (!clarifyQ) return false;
  const modelAlreadyAskedTwice =
    history.filter((h) => h.role === 'model' && /[?؟]/.test(h.text)).length >= 2;
  return askCount < 2 && !modelAlreadyAskedTwice;
}
