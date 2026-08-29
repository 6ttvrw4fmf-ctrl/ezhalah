// ─────────────────────────────────────────────────────────────────────────────
// postModel — DETERMINISTIC post-model assertions for the AI agent.
//
// Owner ruling 2026-08-29. These are NOT prompt instructions. The model proposes;
// these functions decide. Every rule here is a pure function of its inputs, so the
// barrier (scripts/verify-agent-postmodel-rules.ts) can unit-test and mutation-test
// it with no network and no live data.
//
// Deliberately dependency-free and Deno-API-free so BOTH runtimes can load it:
// the edge function imports it at runtime, Node imports it under
// --experimental-strip-types in the barrier.
// ─────────────────────────────────────────────────────────────────────────────

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits count as digits. */
const DIGIT_RE = /[0-9٠-٩۰-۹]/;

/** Does this message state any numeric figure at all? */
export function hasDigits(t: string): boolean {
  return DIGIT_RE.test(String(t ?? ""));
}

const MONTHLY_RE = /(شهري|شهريا|شهرياً|بالشهر|في\s*الشهر|كل\s*شهر|monthly|per\s*month|\/\s*month|a\s*month)/i;
const ANNUAL_RE = /(سنوي|سنويا|سنوياً|بالسنة|في\s*السنة|كل\s*سنة|annual|yearly|per\s*year|\/\s*year|a\s*year)/i;

/**
 * The rental period this message states IN ITS OWN WORDS, or null when it states none.
 * Used to decide which turn's period a carried-forward budget belongs to.
 */
export function periodFromText(t: string): "monthly" | "annual" | null {
  const s = String(t ?? "");
  const m = MONTHLY_RE.test(s);
  const a = ANNUAL_RE.test(s);
  if (m && !a) return "monthly";
  if (a && !m) return "annual";
  return null; // none, or both → not a clean single signal
}

/**
 * RULE 1 (owner 2026-08-29) — "change only the rental period".
 *
 * A message that changes ONLY the rental period: it names a period and states NO new
 * figure. «لا خلها شهري» qualifies; «خلها شهري بميزانية ٥ آلاف» does not (new budget).
 *
 * THE BUG THIS EXISTS FOR (live C2, 2026-08-29):
 *   turn 1: «شقق ٣ غرف للايجار السنوي في الرياض بميزانية ٧٠ الف»  → 70,000/YEAR
 *   turn 2: «لا خلها شهري»
 *   Old behavior: the 70,000 carried forward from turn 1 was multiplied by turn 2's
 *   monthly_rent basis → price 840,000. A 12× budget inflation the user never asked for.
 */
export function isPeriodOnlyChange(text: string): boolean {
  return periodFromText(text) !== null && !hasDigits(text);
}

/**
 * RULE 1 enforcement. Returns the pricing basis that may legitimately multiply a budget.
 *
 * When the budget came from THIS message, the model's basis applies as before. When the
 * budget was CARRIED from an earlier turn and this message only flips the period, the
 * budget keeps the meaning it had when it was stated — so the basis comes from the turn
 * that stated it, never from the period-flip turn.
 *
 * A carried budget whose own turn named no period is not multiplied at all: the user never
 * said that number was per-month, and inventing a ×12 is exactly the reinterpretation the
 * owner ruled out.
 *
 * NOTE ON "ask if ambiguous": the owner's rule allows asking when the budget becomes
 * incompatible. It does not become incompatible here — `price` is an ANNUAL-EQUIVALENT
 * field (priceIsAnnual), so a 70,000/year budget stays perfectly meaningful against monthly
 * inventory (≈5,833/month). Preserving is exact, so there is nothing to ask about.
 */
export function effectiveBasis(
  args: { currentText: string; priceCameFromCurrentTurn: boolean; carriedFromText: string; modelBasis: string },
): string {
  const { currentText, priceCameFromCurrentTurn, carriedFromText, modelBasis } = args;
  if (priceCameFromCurrentTurn) return modelBasis;
  if (!isPeriodOnlyChange(currentText)) return modelBasis;
  const src = periodFromText(carriedFromText);
  if (src === "monthly") return "monthly_rent";
  if (src === "annual") return "annual_rent";
  return ""; // source turn named no period → never multiply a number the user never scoped
}

const CHEAPEST_RE = /(أرخص|ارخص|الأرخص|الارخص|أقل\s*سعر|اقل\s*سعر|cheapest|lowest\s*price|least\s*expensive)/i;
const PRICIEST_RE = /(أغلى|اغلى|الأغلى|الاغلى|أعلى\s*سعر|اعلى\s*سعر|most\s*expensive|highest\s*price|priciest)/i;

/**
 * RULE 2 (owner 2026-08-29) — reply/query drift.
 *
 * If the reply PROMISES cheapest, the query must actually sort by cheapest. Live N1
 * («قصر في الرياض بـ ٥٠٠ ريال») replied "أرخص القصور" while sort was unset, so the search
 * would return an arbitrary order under a reply promising the cheapest — the same class of
 * defect as the rent_period intent inversion: the words and the query disagreed.
 *
 * Only fills an ABSENT sort. An explicit model sort is left alone; the reply-vs-sort
 * contradiction that would create is a separate matter and silently overriding a stated
 * intent is worse than leaving it.
 */
export function enforceSortMatchesReply(reply: string, sort: string | undefined): string | undefined {
  const current = typeof sort === "string" && sort && sort !== "none" ? sort : undefined;
  if (current) return current;
  const r = String(reply ?? "");
  if (CHEAPEST_RE.test(r)) return "price_asc";
  if (PRICIEST_RE.test(r)) return "price_desc";
  return undefined;
}

/** Latin letters present → the label is not Arabic. */
const LATIN_RE = /[A-Za-z]/;

/**
 * RULE 3 (owner 2026-08-29) — no English location leak in Arabic chat.
 *
 * Live F2 returned location "Jeddah" while every other turn returned Arabic («جدة»,
 * «الرياض»). Against the arabic-canonical rule, and it reaches the user as a visible
 * language break in an otherwise Arabic conversation.
 *
 * Deterministic and SOURCE-RESPECTING: only swaps in a canonical Arabic label the catalog
 * actually returned (loc_classify). It never transliterates, never guesses, and never
 * touches a label that is already Arabic. No canonical Arabic → the original passes through
 * untouched, so an unknown place is still searched verbatim rather than being lost.
 */
export function arabicCanonicalLocation(
  args: { location: string; canonicalArabic: string; locale: string },
): string {
  const { location, canonicalArabic, locale } = args;
  const loc = String(location ?? "");
  if (locale === "en") return loc;            // English chat keeps English labels
  if (!loc || !LATIN_RE.test(loc)) return loc; // already Arabic (or empty) → untouched
  const canon = String(canonicalArabic ?? "").trim();
  if (!canon || LATIN_RE.test(canon)) return loc; // no Arabic canonical available → untouched
  return canon;
}
