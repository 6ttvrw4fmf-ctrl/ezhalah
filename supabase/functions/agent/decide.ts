// ─────────────────────────────────────────────────────────────────────────────
// decide — THE SINGLE DECISION AUTHORITY for kind ('listings' | 'message' | 'interview').
//
// WHY THIS FILE EXISTS (owner-approved architecture consolidation, 2026-08-30). An audit found
// 12+ separate places across server and client that could decide, gate, or override `kind` —
// including a self-judged, unfalsifiable escape hatch baked into the system prompt ("a genuine
// clarification... OVERRIDES the QUESTION POLICY count limits", formerly HARD RULE #8 in
// index.ts) and a duplicate client-side counter (deleted: src/lib/agentQuestionBudget.ts)
// re-deriving the same judgment independently by regex-scanning history text. Two systems making
// the same call, by different rules, is how a "family of 5, either type is fine" turn never
// showed a single listing even after the model correctly decided to search.
//
// Owner mandate (verbatim): "I want one architectural authority for deciding whether we have
// enough information to search. Do not let the server, model, and client maintain three
// contradictory clarification systems. Permanent principle: If the agent has enough information
// to perform a meaningful search, search. Missing optional information must not block it.
// Clarification is appropriate when genuinely necessary, but do not ask stupid questions just
// because a filter is empty."
//
// index.ts (the HTTP handler) calls decideAgentTurn() EXACTLY ONCE, after the model call(s)
// return and after it has resolved this turn's fields (location/price/detail/…) — never before,
// and the model's own `kind` field is never read again after that point. This is the only place
// that assigns the FINAL kind.
//
// Dependency-light and Deno-API-free, same shape as src/lib/agentQuestionBudget.ts and
// ./postModel.ts, so BOTH runtimes can load it: the edge function imports it at runtime, Node
// imports it directly (via --experimental-strip-types) in scripts/verify-agent-decide-turn.ts —
// never a hand-typed copy of this logic (standing rule).
// ─────────────────────────────────────────────────────────────────────────────

/** Has this turn (or the conversation) actually established a value? Empty string/array/null = no. */
function established(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export type EstablishedState = {
  location?: string | null;
  type?: string | null;
  price?: string | number | null;
  detail?: string | null;
  amenities?: readonly string[] | null;
  af?: Record<string, unknown> | null;
  /**
   * SOFT SIGNAL, DELIBERATELY NARROWED (mandatory regression case, dissent found on PR #1382's
   * ship 2026-08-30). ask_about ("كبير" → ["size"]) is real signal, but only once it has already
   * survived a turn — i.e. it came from the PRIOR established state (what mergeConversationState
   * carried in from earlier turns), never from this turn's freshly-computed ask_about. Pass ONLY
   * the prior-turn value here. Without this narrowing, a single vague first-turn utterance with
   * nothing else set (askCount still 0) would satisfy hasEnoughToSearch() on its own and trigger
   * an immediate nationwide, type-less search instead of the one clarifying question the budget
   * still has room for. Once askCount hits the ceiling, step 3 of the ladder searches anyway
   * regardless of this field — the narrowing only matters while budget remains.
   */
  priorAskAbout?: readonly string[] | null;
};

/**
 * The owner's deterministic "enough to search" test, evaluated against the FULL MERGED state
 * (this turn's own contribution folded together with everything established in earlier turns —
 * see index.ts's callers, which OR this turn's resolved fields with the client-sent prevQuery
 * using the identical "established(next) || established(prev)" rule mergeConversationState uses
 * for every non-defaulted STICKY_FIELD in src/lib/conversationState.ts).
 *
 * True unless location, type, price, detail, amenities, af, AND priorAskAbout are ALL empty.
 */
export function hasEnoughToSearch(state: EstablishedState): boolean {
  return (
    established(state.location) ||
    established(state.type) ||
    established(state.price) ||
    established(state.detail) ||
    established(state.amenities) ||
    established(state.af && Object.keys(state.af).length ? state.af : null) ||
    established(state.priorAskAbout)
  );
}

// The deterministic "guide me step by step" phrase set — a LITERAL MIRROR of src/data/agent.ts's
// own INTERVIEW_RE (the app's real, already-shipped pattern; not invented for this change). Kept
// as a physical copy rather than a shared import: this file must stay Deno- and plain-Node-
// importable with zero module-alias resolution, and src/data/agent.ts pulls in React Native /
// Supabase-client imports this file must never depend on. If you change one, change both —
// scripts/verify-agent-decide-turn.ts's interview-phrase case is the tripwire for a drift.
const INTERVIEW_PHRASE_RE =
  /\b(ask me|ask questions|question me|guide me|help me (choose|decide|find)|interview me|walk me through)\b/i;

/** Deterministic interview gate — the raw user text, NEVER the model's own kind claim. */
export function wantsGuidedInterview(rawText: string): boolean {
  return INTERVIEW_PHRASE_RE.test(String(rawText ?? ""));
}

/** Hard, code-enforced ceiling on clarifying questions before the first search (owner ruling). */
export const QUESTION_BUDGET_CEILING = 2;

export type DecideInput = {
  /** This turn's raw user message, verbatim — used ONLY for the deterministic phrase-match. */
  rawText: string;
  /**
   * A genuine DB-confirmed location ambiguity (loc_classify twin city / twin region-or-city /
   * twin district) that the current turn did NOT resolve. index.ts already runs loc_classify and
   * its own `said()` history check to tell "still ambiguous" from "the user just answered it" —
   * this is just that verdict, reduced to a boolean, because the SPECIFIC question text (which
   * varies by ambiguity shape) is a display concern the ladder itself does not need to know.
   */
  locationAmbiguous: boolean;
  establishedState: EstablishedState;
  /** Conversation-scoped; never re-derived from history text. Never reset within a chat. */
  askCount: number;
};

export type DecideResult = {
  kind: "listings" | "message" | "interview";
  askCount: number;
};

/**
 * THE decision ladder, evaluated once, in this fixed order. See the file header for why this is
 * the only function in the codebase allowed to assign a final `kind`.
 */
export function decideAgentTurn(input: DecideInput): DecideResult {
  const { rawText, locationAmbiguous, establishedState, askCount } = input;

  // 0. Guided interview — deterministic phrase-match only. The model's own kind="interview" claim
  // is never read (by construction: nothing here or in index.ts's caller inspects it).
  if (wantsGuidedInterview(rawText)) {
    return { kind: "interview", askCount };
  }

  // 1. A real, DB-confirmed ambiguity the user has not yet resolved always wins — regardless of
  // askCount or how much other signal exists.
  if (locationAmbiguous) {
    return { kind: "message", askCount: askCount + 1 };
  }

  // 2. Enough merged signal to mean something → search, unconditionally. THIS is the step that
  // deletes the old HARD RULE #8 self-judged "genuine clarification" escape hatch: once this is
  // true there is no override left anywhere else in the code.
  if (hasEnoughToSearch(establishedState)) {
    return { kind: "listings", askCount };
  }

  // 3. Budget exhausted → search anyway with whatever is known, broad/nationwide if that's
  // nothing at all. "Missing optional information must not block it" (owner, verbatim).
  if (askCount >= QUESTION_BUDGET_CEILING) {
    return { kind: "listings", askCount };
  }

  // 4. Otherwise, ask one more question. WHAT to ask is left to the model's own reply text/
  // phrasing (oneQuestionOnly/groundReply in index.ts) — this function only enforces THAT the
  // turn must be a clarification, never which field it asks about.
  return { kind: "message", askCount: askCount + 1 };
}
