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

/**
 * Has this turn (or the conversation) actually established a value? Empty string/array/null = no.
 * Exported so callers building an EstablishedState (index.ts's prevQuery scan) use the identical
 * truthiness rule this file's own hasEnoughToSearch() does, instead of a second copy that could
 * drift — the same "never a hand-typed copy" standing rule this file's header already documents.
 */
export function established(v: unknown): boolean {
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

/**
 * A COUNTRY-LEVEL LOCATION IS NOT A LOCATION (owner, 2026-09-04).
 *
 * Nationwide / «كل المملكة» was removed from the product: the Normal Filter has always refused a
 * search with no city («الرجاء اختيار مدينة من القائمة»). The agent had no such rule, so a turn
 * whose resolved location was «المملكة العربية السعودية» — or nothing at all — still reached
 * hasEnoughToSearch() through some OTHER signal (a bare type is enough) and searched unscoped.
 * Reproduced in production 2026-09-04, after the client-side affordance was already removed:
 *   «ابغى شقة للبيع في كل مدن المملكة» → p_cities/p_districts/p_region_ids all null → 39,055 rows.
 *
 * LITERAL MIRROR of COUNTRY_ALIASES + the loose Kingdom test in src/data/regions.ts
 * (isCountryWideQuery). Kept as a physical copy for the same reason INTERVIEW_PHRASE_RE is: this
 * file must stay Deno- and plain-Node-importable with zero module-alias resolution, and
 * regions.ts pulls in the app's module graph. If you change one, change both —
 * scripts/verify-agent-decide-turn.ts is the tripwire.
 */
const COUNTRY_ONLY_RE =
  /^(the\s+)?(kingdom( of saudi arabia)?|saudi( arabia)?|ksa|المملكة( العربية السعودية)?|السعودية|السعوديه|العربية السعودية|سعودية)$/i;

/** Strips the Arabic "all of / in all of" prefixes that do not change the place being named. */
function bareLocation(v: unknown): string {
  return String(v ?? "").trim().replace(/^(في\s+)?(كل|جميع)\s+/i, "").replace(/^في\s+/i, "").trim();
}

/**
 * A search needs a REAL place. False when the location is absent, or names the country rather than
 * a city/region/district — the two cases that produce an unscoped result set.
 */
export function hasUsableLocation(state: EstablishedState): boolean {
  const loc = bareLocation(state.location);
  if (!loc) return false;
  if (COUNTRY_ONLY_RE.test(loc)) return false;
  // «كل مدن المملكة» / «مدن السعودية» and friends: names the Kingdom, not a city.
  if (/(المملك|السعودي|\bksa\b|\bsaudi\b|\bkingdom\b)/i.test(loc) && !/[،,]/.test(loc)) return false;
  return true;
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

  // 1. A real, DB-confirmed ambiguity the user has not yet resolved wins over any other signal —
  // BUT, like every other clarification, it still respects the question-budget ceiling (round 2
  // fix). Without this bound, round 1 proved decideAgentTurn() could return kind="message" forever
  // on an ambiguity the user never resolves — tested at askCount 0, 1, 2, 5, 50, unbounded every
  // time. Once the budget is spent, fall through to steps 2/3 like any other unresolved field:
  // step 3's "missing optional information must not block it" takes over and searches anyway. This
  // function never picks a side of the ambiguity itself (never invent a location) — the caller
  // (index.ts) is responsible for treating the still-ambiguous location term as ABSENT rather than
  // passing the unresolved token through to the search once the ladder reaches "listings" this way;
  // see index.ts's own comment at its `decideAgentTurn()` call site for that half of the fix.
  //
  // THE BOUNDED LOCATION QUESTION OUTRANKS THE BUDGET CEILING (owner, 2026-09-05). The `askCount <
  // CEILING` bound above is REMOVED, deliberately, and this is the third revision of this line —
  // read why before restoring it.
  //   round 1: no bound at all → asked forever (a real bug).
  //   round 2: bounded by the ceiling → once spent, an unresolved ambiguity fell through to steps
  //            2/3 and turnWiring cleared the location, whose own comment said it plainly:
  //            "absent, nationwide, never guessed". That IS the nationwide search, reached from a
  //            perfectly ordinary user answer: «الرياض» is a twin (city AND region), so answering
  //            the city question with it produced p_cities=null and 39,015 listings (verified in
  //            production 2026-09-05, after the no-place gate below had already shipped).
  //   round 3 (here): unbounded again, but SAFE, because the two rounds differ in what is asked.
  //
  // WHY THIS DOES NOT RESTORE ROUND 1'S LOOP. This question is CLOSED, not open: index.ts pairs it
  // with a pre-built `ambiguityReply` naming both options («مدينة الرياض ولا منطقة الرياض كاملة؟»),
  // and the client resolves either answer deterministically without another model round-trip
  // (regionOrCityChoice / twinWholeAreaIsCity / scopedLocation in src/app/agent.tsx). One question,
  // two named answers, resolved — so `locationAmbiguous` is false on the next turn by construction.
  // Round 1 looped because nothing consumed the answer; that machinery exists now.
  //
  // And the floor under it is absolute: even if an answer somehow never resolved, the worst case is
  // another question. It can no longer be a nationwide search, because step 1c below refuses to
  // search without a real place and turnWiring can no longer downgrade an ambiguity into one.
  if (locationAmbiguous) {
    return { kind: "message", askCount: askCount + 1 };
  }

  // 1c. LOCATION IS REQUIRED, NOT OPTIONAL (owner, 2026-09-04). Every step below this line may
  // decide to SEARCH; none of them may do so without a real place, because the only search that
  // can be issued without one is the nationwide search the product removed.
  //
  // THIS DELIBERATELY NARROWS the 2026-08-30 rule one line down ("search anyway ... broad/nationwide
  // if that's nothing at all — missing optional information must not block it"). That rule stands
  // for every OPTIONAL field; location is not one of them. The Normal Filter has always enforced
  // exactly this and refuses with «الرجاء اختيار مدينة من القائمة»; the agent was the only surface
  // that did not, which is why a removed scope stayed reachable in production until 2026-09-04.
  //
  // Note the consequence, accepted knowingly: a user who never names a city keeps getting the city
  // question instead of results. That is the same answer the Filter gives, and an honest question is
  // better than 39,055 listings from cities the user never asked about.
  // NO EXEMPTION FOR AMBIGUITY — and that is a correction of my own earlier reasoning (2026-09-04),
  // which exempted it on the belief that the convergence search was "scoped to the ambiguous term".
  // It was not: turnWiring cleared the location outright. Step 1 above now always asks instead, so
  // this line is unreachable for an ambiguity — it stays unexempted anyway, so that a future change
  // to the ladder's ORDER cannot quietly reopen the door.
  if (!hasUsableLocation(establishedState)) {
    return { kind: "message", askCount: askCount + 1 };
  }

  // 2. Enough merged signal to mean something → search, unconditionally. THIS is the step that
  // deletes the old HARD RULE #8 self-judged "genuine clarification" escape hatch: once this is
  // true there is no override left anywhere else in the code.
  if (hasEnoughToSearch(establishedState)) {
    return { kind: "listings", askCount };
  }

  // 3. Budget exhausted → search anyway with whatever is known. Location is already guaranteed
  // usable by step 1c, so "broad" here means a whole city/region — never the whole Kingdom.
  if (askCount >= QUESTION_BUDGET_CEILING) {
    return { kind: "listings", askCount };
  }

  // 4. Otherwise, ask one more question. WHAT to ask is left to the model's own reply text/
  // phrasing (oneQuestionOnly/groundReply in index.ts) — this function only enforces THAT the
  // turn must be a clarification, never which field it asks about.
  return { kind: "message", askCount: askCount + 1 };
}
