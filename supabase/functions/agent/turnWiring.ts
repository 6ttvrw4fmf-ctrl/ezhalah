// ─────────────────────────────────────────────────────────────────────────────
// turnWiring — the GLUE between index.ts's resolved turn fields and decide.ts's decision ladder.
//
// WHY THIS FILE EXISTS (round-2 fix, finding "UNTESTED WIRING / FOOLABLE REGEX", 2026-08-31). Round
// 1 of this consolidation's review proved that mandatory case (c)'s real protection — priorAskAbout
// reading ONLY a value that SURVIVED a prior turn, never this turn's freshly-computed ask_about —
// lived in one line of index.ts wiring that no test ever executed. The only guard was a source-regex
// in scripts/verify-agent-broker-grounding.ts that checked for the STRING PREFIX
// `priorAskAbout: Array.isArray(prevQuery?.askAbout)`, which a plausible "consistency fix" mutation
// (merging this turn's askAboutList into priorAskAbout) still contains — so the barrier stayed green
// while the exact regression the mandatory case exists to prevent came back.
//
// Same fix shape as decide.ts's own extraction: pull the untested block into a small, pure,
// dependency-light function that both the Deno edge function and a plain-Node verify script
// (scripts/verify-agent-turn-wiring.ts) import and EXECUTE — never a hand-typed copy of it
// (feedback_never-test-a-copy-of-production-code). Deno-API-free and `@/`-alias-free, same
// constraint as decide.ts, so both runtimes can load it without a bundler.
//
// SCOPE: everything from "what did this turn establish, folded with what prevQuery already carried"
// through "what did decideAgentTurn() decide", INCLUDING the two round-2 fixes that live at this
// same seam:
//   - the NOISE-GUARD for type/price/af (a fabricated field with no textual grounding must not count
//     as signal until corroborated — same bar the pre-existing bedroom-word-without-word guard for
//     `detail` already applies, just extended to these three siblings);
//   - the location-ambiguity BUDGET ESCAPE's other half (once decideAgentTurn() reaches "listings"
//     while a genuine ambiguity is still unresolved, the unresolved location term must be treated as
//     ABSENT — never guessed — rather than searched as-is).
// ─────────────────────────────────────────────────────────────────────────────

import { decideAgentTurn, established, type EstablishedState, type DecideResult } from "./decide.ts";

export type TurnWiringInput = {
  /** This turn's raw user message, verbatim — the ONLY thing the noise-guard regexes read. */
  text: string;
  /** The model's parsed output for THIS turn (only the fields this seam cares about). */
  out: { type?: unknown; af?: unknown; amenities?: unknown };
  /** The client's real SearchQuery (src/data/search.ts) from the previous turn, or null. */
  prevQuery: Record<string, unknown> | null;
  /** This turn's resolved location (post loc_classify/anti-guess, pre ambiguity-clearing). */
  location: string;
  regionPin: string | undefined;
  districtPin: string | undefined;
  /** A genuine DB-confirmed ambiguity this turn did NOT resolve, or null. */
  ambiguityReply: string | null;
  askCount: number;
  /** This turn's resolved budget figure (detPrice || modelPrice) and whether a digit backs it. */
  price: string;
  detPrice: string;
  /** This turn's resolved bedroom/size detail, already past the bedroom-word-without-word guard. */
  detailStr: string;
};

export type TurnWiringResult = {
  establishedState: EstablishedState;
  decision: DecideResult;
  /** Possibly cleared (see the ambiguity-budget-escape fix above) — always use these, not the input. */
  location: string;
  regionPin: string | undefined;
  districtPin: string | undefined;
};

// The real flat AF keys src/lib/conversationState.ts's STICKY_FIELDS carries (minus `amenities`,
// which EstablishedState already tracks as its own field, separately, from prevQuery.amenities).
const PREV_AF_KEYS = [
  "furnishedPref", "ratingMin", "reviewsMin", "bathMin", "ageMin", "ageMax",
  "isNewConstruction", "streetWidthMin", "directions", "unitSubtypes",
] as const;

// TYPE: a compact word-list mirror of the RESIDENTIAL DETAIL types named in index.ts's own system
// prompt (Apartment/Villa/House/Floor/Room/Building/Rest House/Chalet/Camp) plus the common
// commercial/land nouns — same "regex mirrors the spec, not the full taxonomy" scope as index.ts's
// pre-existing saidBedroomWord, not a taxonomy lookup (ponytail: promote to the real
// src/data/propertyTypes.ts ALL_CLEAN_TYPES table if a real type word this misses gets reported).
const TYPE_WORD_RE = /(شقق|شقة|شقه|فيلا|فلة|فله|بيت|منزل|\bدور\b|عماره|عمارة|برج|استراح|شاليه|مخيم|مخيّم|\bأرض\b|\bارض\b|مزرعة|مزرعه|مكتب|\bمحل\b|مستودع|معرض|استوديو|استديو|دوبلكس|apartment|villa|\bhouse\b|\bfloor\b|building|rest\s*house|chalet|\bcamp\b|\bland\b|\bfarm\b|\boffice\b|\bshop\b|warehouse|showroom|studio|duplex|\broom\b|bed\s?room)/i;

// AF: the intents span several unrelated shapes (a number, a direction word, a subtype phrase), so a
// per-key validator is a much bigger lift than this gap warrants (ponytail: build one if a false-pass
// gets reported) — ANY digit or AF-adjacent keyword anywhere in the message is enough to separate
// "totally vague utterance, zero basis" (blocked) from a message that actually mentions one of these
// concepts (allowed through).
const AF_GROUNDING_RE = /[\d٠-٩]|تقسيط|قسط|شمال|جنوب|شرق|غرب|استوديو|استديو|شقق\s*مخدومة|جديد|قديم|عرض\s*الشارع|\bمتر\b/i;

/**
 * Fold THIS turn's resolved fields with prevQuery, apply the noise-guard, and run the single
 * decision authority. See the file header for why this exists as a function rather than inline code.
 */
export function buildTurnDecision(input: TurnWiringInput): TurnWiringResult {
  const { text, out, prevQuery, ambiguityReply, askCount, price, detPrice, detailStr } = input;
  let { location, regionPin, districtPin } = input;

  // FIELD-NAME BUG (round 2 fix). prevQuery is the CLIENT's real SearchQuery — it never had `.price`
  // or `.af` (a flat string price is `priceInput`/`priceMin`/`priceMax`/`priceBand`; there is no
  // nested `af` object, only flat AF keys like `ratingMin`/`bathMin`). Reading the wrong names meant
  // an earlier turn's budget or AF fact was silently invisible to hasEnoughToSearch() on a later turn.
  const prevPrice: string | number | null = prevQuery
    ? ([prevQuery.priceInput, prevQuery.priceMin, prevQuery.priceMax, prevQuery.priceBand,
        prevQuery.priceMinRent, prevQuery.priceMaxRent]
        .find((v) => established(v)) as string | number | undefined) ?? null
    : null;
  const prevAf: Record<string, unknown> | null = prevQuery
    ? PREV_AF_KEYS.reduce((acc, k) => {
        const v = (prevQuery as Record<string, unknown>)[k];
        if (established(v)) acc[k] = v;
        return acc;
      }, {} as Record<string, unknown>)
    : null;
  const thisAf = (out.af && typeof out.af === "object" && !Array.isArray(out.af)) ? out.af as Record<string, unknown> : {};
  const thisAfCount = Object.keys(thisAf).length;

  // NOISE-GUARD GAP: type/price/af (round 2 fix). Same failure shape the bedroom-word-without-word
  // guard catches for `detail` (index.ts, ahead of this call): a fabricated field with no textual
  // grounding in what the user actually said must not count as signal on its own — it falls back to
  // whatever prevQuery already carried, exactly like every other field. A clear one-turn statement
  // ("أبغى فيلا") still searches immediately, because it IS grounded — this only blocks the
  // fabricated case, never a genuinely-stated single-turn field.
  const saidTypeWord = TYPE_WORD_RE.test(text);
  const priceGrounded = !!detPrice;
  const afGroundingHint = AF_GROUNDING_RE.test(text);

  const establishedState: EstablishedState = {
    location: location || (typeof prevQuery?.location === "string" ? prevQuery.location : null),
    type: (typeof out.type === "string" && out.type && saidTypeWord ? out.type : null)
      || (typeof prevQuery?.type === "string" ? prevQuery.type : null),
    price: (priceGrounded ? price : null) || prevPrice,
    detail: detailStr || (typeof prevQuery?.detail === "string" ? prevQuery.detail : null),
    amenities: (Array.isArray(out.amenities) && out.amenities.length)
      ? out.amenities as string[] : (Array.isArray(prevQuery?.amenities) ? prevQuery!.amenities as string[] : null),
    af: (thisAfCount && afGroundingHint ? thisAf : null) || prevAf,
    // The one deliberate exception (mandatory case (c), PR #1382's dissent) — reads ONLY prevQuery's
    // SURVIVED value, never this turn's own askAboutList, which is why that parameter is not even
    // accepted by this function. See decide.ts's own doc on EstablishedState.priorAskAbout.
    priorAskAbout: Array.isArray(prevQuery?.askAbout) ? prevQuery!.askAbout as string[] : null,
  };

  let decision = decideAgentTurn({
    rawText: text,
    locationAmbiguous: ambiguityReply !== null,
    establishedState,
    askCount,
  });

  // FAIL CLOSED — an unresolved ambiguity may never become a search (owner, 2026-09-05).
  //
  // This block used to CLEAR the location here, and its own comment named the consequence exactly:
  // "absent, nationwide, never guessed". Absent is precisely what the results RPC reads as the whole
  // Kingdom, so the round-2 loop fix was closing one bug by opening another — reached by a completely
  // ordinary answer, since «الرياض» is a twin (city AND region). Measured in production 2026-09-05:
  // p_cities/p_districts/p_region_ids all null, 39,015 listings, top result in جدة.
  //
  // decide.ts step 1 now asks the twin question instead of ever reaching "listings" with an
  // unresolved ambiguity, so this should be unreachable. It stays as a GUARD rather than an
  // assertion because unreachable-by-construction is a claim about today's ladder: if a future
  // reordering makes it reachable again, the turn degrades into one more question — never into a
  // nationwide search. Clearing the location is exactly what must NOT happen, so it no longer does.
  if (decision.kind === "listings" && ambiguityReply !== null) {
    decision = { kind: "message", askCount: decision.askCount + 1 };
  }

  return { establishedState, decision, location, regionPin, districtPin };
}
