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

/**
 * Arabic-Indic (٠-٩ U+0660-0669) and Extended Arabic-Indic (۰-۹ U+06F0-06F9) digits → ASCII.
 *
 * WHY THIS EXISTS (found live 2026-08-29 while production-verifying RULE 1). JavaScript's `\d` is
 * ASCII-only, and NOTHING in the agent normalized Arabic numerals — so extractPrice() and
 * originalCurrency() were structurally blind to «٧٠ الف». An Arabic-first product silently ignored
 * every budget its users typed in their own numerals; it only ever appeared to work because the
 * model usually echoed the figure back in Western digits, making a MODEL guess stand in for a
 * DETERMINISTIC read. That is precisely backwards from how this pipeline is supposed to work.
 *
 * Safe to apply before money parsing: the room/size guards run on the normalized text too, so
 * «٣ غرف» → "3 غرف" is still skipped as a room count, and the n >= 100 floor still holds.
 */
export function toWesternDigits(t: string): string {
  return String(t ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * An Arabic amount written in WORDS rather than digits, with its position in the text.
 * `index`/`length` let the caller apply the same size-unit and currency lookarounds it uses for
 * digit matches, and keep candidates in text order.
 */
export type WordAmount = { index: number; length: number; value: number };

// Alef/hamza forms are written inconsistently by real users (ألف vs الف, آلاف vs الاف). Fold them
// for MATCHING only — every replacement is 1 char for 1 char, so match indices stay valid against
// the original string.
function foldAlef(t: string): string {
  return t.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
}

// Multiplier words, and their DUAL forms — Arabic marks "two of X" with a suffix rather than a
// separate word, so «مليونين» IS 2,000,000 and there is no numeral anywhere in it.
const AR_UNITS: Array<[string, number, number]> = [
  // [folded spelling, unit value, implicit count]
  ["مليارين", 1_000_000_000, 2],
  ["مليارات", 1_000_000_000, 1],
  ["مليار", 1_000_000_000, 1],
  ["مليونين", 1_000_000, 2],
  ["ملايين", 1_000_000, 1],
  ["مليون", 1_000_000, 1],
  ["الفين", 1_000, 2],
  ["الاف", 1_000, 1],
  ["الف", 1_000, 1],
];

const AR_COUNT: Record<string, number> = {
  "واحد": 1, "اثنين": 2, "اثنان": 2, "ثنتين": 2,
  "ثلاث": 3, "ثلاثه": 3, "تلات": 3, "تلاته": 3,
  "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6,
  "سبع": 7, "سبعه": 7, "ثمان": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9,
  "عشر": 10, "عشره": 10,
};
const AR_FRACTION: Record<string, number> = { "نص": 0.5, "نصف": 0.5, "ربع": 0.25 };

const COUNT_ALT = Object.keys(AR_COUNT).sort((a, b) => b.length - a.length).join("|");
const FRAC_ALT = Object.keys(AR_FRACTION).sort((a, b) => b.length - a.length).join("|");
const UNIT_ALT = AR_UNITS.map(([w]) => w).join("|");

// [count|fraction]? UNIT [ونص|وربع]?   e.g. «مليون ونص», «نص مليون», «ثلاثة ملايين», «مليونين»
const AR_AMOUNT_RE = new RegExp(
  String.raw`(?:(${COUNT_ALT}|${FRAC_ALT})\s+)?(${UNIT_ALT})(?:\s*و\s*(${FRAC_ALT}))?`,
  "g",
);

/**
 * Amounts written in Arabic WORDS — «مليون ونص», «نص مليون», «مليونين», «ثلاثة ملايين».
 *
 * WHY (found live 2026-08-29, production-verified as a real defect):
 *   «دور للبيع في الرياض من ٨٠٠ الف الى مليون ونص»
 *   extractPrice's NUM_RE requires a LEADING ASCII DIGIT. «٨٠٠ الف» matched (800 x الف), but
 *   «مليون ونص» carries no numeral at all, so it produced NO candidate. With only one candidate the
 *   range-MAX rule could not fire, and the user's 1,500,000 ceiling silently became 800,000 — a
 *   budget nearly halved without the user ever being told.
 *
 * DELIBERATELY CONSERVATIVE. A candidate is produced ONLY when a real multiplier word is present,
 * so a bare «نص» (which also means "text" in MSA) can never invent a price. A unit already preceded
 * by digits is SKIPPED — «٨٠٠ الف» belongs to NUM_RE, and double-counting it would be worse than
 * missing it.
 */
export function arabicWordAmounts(text: string): WordAmount[] {
  const src = String(text ?? "");
  const folded = foldAlef(src);
  const out: WordAmount[] = [];
  AR_AMOUNT_RE.lastIndex = 0;
  for (const m of folded.matchAll(AR_AMOUNT_RE)) {
    const [whole, pre, unitWord, tailFrac] = m;
    const start = m.index ?? 0;
    // A digit immediately before the unit means NUM_RE already owns this figure («٨٠٠ الف»).
    const before = folded.slice(Math.max(0, start - 12), start);
    if (/\d[\s,.]*$/.test(before)) continue;
    const unit = AR_UNITS.find(([w]) => w === unitWord);
    if (!unit) continue;
    const [, unitValue, implicitCount] = unit;
    let n: number;
    if (pre && pre in AR_FRACTION) n = AR_FRACTION[pre] * unitValue;      // «نص مليون»
    else if (pre && pre in AR_COUNT) n = AR_COUNT[pre] * unitValue;        // «ثلاثة ملايين»
    else n = implicitCount * unitValue;                                    // «مليون», «مليونين»
    if (tailFrac) n += AR_FRACTION[tailFrac] * unitValue;                  // «… ونص»
    out.push({ index: start, length: whole.length, value: Math.round(n) });
  }
  return out;
}

/**
 * RULE 4 (owner 2026-08-31) — deterministic af.bathrooms backstop.
 *
 * WHY THIS EXISTS. af.bathrooms is model-proposed-only (JSON_SHAPE_HINT). Live replay against
 * production (12 reps/phrasing) measured the model missing it inconsistently on multi-entity turns
 * — and the effect is NOT specific to any one amenity word: «...فيها مصعد وحمامين» (the OLD,
 * already-certified "elevator" token, unrelated to any new amenity) missed 11 of 12 replays, almost
 * identical to «...فيها نادي وحمامين» (11/12 missed). Bathrooms alone («...فيها حمامين», no other
 * amenity) still only lands 9/12. The value is never WRONG when it does arrive — canonicalize()/
 * rung() in src/lib/afIntents.ts already cap it sanely — the failure is a clean miss, so a
 * deterministic backstop that FILLS THE GAP is the right shape: same fill-absent-only precedent as
 * RULE 2 (enforceSortMatchesReply) above. An explicit model value is never touched.
 *
 * THE ARABIC DUAL. «حمامين»/«حمامان» IS "two bathrooms" and carries NO DIGIT anywhere in it —
 * exactly the worst-repro phrasing. A parser that only looks for a numeral would still miss it.
 * «دورتين مياه» is the same dual pattern on the «دورة مياه» (restroom) synonym.
 *
 * NEVER A BARE NUMERAL. Same rule as bedrooms («كبير» never becomes a bedroom count): a digit or
 * count-word alone must never become a bathroom count. Every branch below requires an actual
 * bathroom-noun match; a lone "٢" in the message is not enough and is not matched here. The
 * singular «حمام» is explicitly barred from swallowing «حمام سباحة» (swimming pool) as "1 bathroom".
 */
const BATH_DUAL_RE = /حمامين|حمامان|دورتين\s*مياه|دورتان\s*مياه/;
// NOTE: matched against foldAlef()'d text (ة→ه already applied), so the guard word is spelled
// "سباحه", not "سباحة" — matching the unfolded spelling here would silently never fire.
//
// A POOL IS NEVER A BATHROOM, and the guard belongs in ONE place. It used to be a lookahead on the
// SINGULAR only — «حمام(?!\s*سباحه)» — which left the plural and the dual wide open:
//   «ابغى فيلا فيها حمامين سباحة»  -> "2"   (two swimming POOLS read as two bathrooms)
//   «ابغى شقة فيها ٣ حمامات سباحة» -> "3"
// both measured on this very parser. Three lookaheads that must stay in sync is how the next
// alternative gets added without one. POOL_RE below strips the phrase once, at the top of
// arabicBathroomCount, so every branch — singular, plural, dual, and anything added later —
// inherits the guard for free, and BATH_NOUN needs no lookahead at all.
const BATH_NOUN = "(?:حمامات|حمام|دورات\\s*مياه|دوره\\s*مياه)";
// Longest alternatives first so «حمامات سباحه» is consumed whole rather than leaving a stray tail.
// Replaced with a SPACE, not "", so «حمام سباحة و٣ حمامات» still reads 3 real bathrooms.
// NON-GLOBAL for .test() and a separate /g copy for .replace(): a shared /g regex carries lastIndex
// between calls, so alternating test/replace on one instance silently skips matches.
const POOL_RE = /(?:حمامات|حمامين|حمامان|حمام)\s*سباحه/;
const POOL_RE_G = new RegExp(POOL_RE.source, "g");
const BATH_WORD_NUM_RE = new RegExp(`(?:(${COUNT_ALT})\\s+${BATH_NOUN}|${BATH_NOUN}\\s+(${COUNT_ALT}))`);
const BATH_DIGIT_NUM_RE = new RegExp(`(?:(\\d+)\\s*${BATH_NOUN}|${BATH_NOUN}\\s*(\\d+))`);
const EN_BATH_COUNT: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
const EN_BATH_WORD_RE = /\b(one|two|three|four)\s+(?:baths?|bathrooms?)\b/i;
const EN_BATH_DIGIT_RE = /\b(\d+)\s*(?:baths?|bathrooms?)\b/i;

/** The bathroom count this message states IN ITS OWN WORDS, or null when it states none. */
export function arabicBathroomCount(text: string): string | null {
  const t = foldAlef(toWesternDigits(String(text ?? ""))).replace(POOL_RE_G, " ");
  if (BATH_DUAL_RE.test(t)) return "2";
  const wm = t.match(BATH_WORD_NUM_RE);
  if (wm) {
    const n = AR_COUNT[(wm[1] ?? wm[2]) as string];
    if (n) return String(n);
  }
  const dm = t.match(BATH_DIGIT_NUM_RE);
  if (dm) {
    const n = parseInt((dm[1] ?? dm[2]) as string, 10);
    if (n > 0) return String(n);
  }
  const ew = t.match(EN_BATH_WORD_RE);
  if (ew) return String(EN_BATH_COUNT[ew[1].toLowerCase()]);
  const ed = t.match(EN_BATH_DIGIT_RE);
  if (ed) {
    const n = parseInt(ed[1], 10);
    if (n > 0) return String(n);
  }
  return null;
}

/**
 * Fills af.bathrooms from the raw message ONLY when the model left it absent — mirrors
 * enforceSortMatchesReply's fill-absent-only shape exactly. An explicit model-proposed value
 * (including one this function itself would not have derived) is returned untouched: the model
 * PROPOSES, this only covers the gap when it proposed nothing at all. The result flows into the
 * SAME af object the model would have produced, so it goes through the identical downstream
 * cohortAllows('bathrooms') certification gate as any model-proposed value — nothing bypasses it.
 */
export function fillBathroomsIfAbsent(af: unknown, text: string): Record<string, unknown> {
  const base: Record<string, unknown> =
    (af && typeof af === "object" && !Array.isArray(af)) ? { ...(af as Record<string, unknown>) } : {};
  // A POOL IS NEVER A BATHROOM — INCLUDING WHEN THE MODEL SAYS IT IS.
  // Guarding only the parser was not enough, and the live function proved it: after the parser fix
  // shipped, «ابغى فيلا للبيع في الرياض فيها حمامين سباحة» still came back with af.bathrooms = 2 —
  // a NUMBER, where this parser returns strings, so it was the model's own proposal sailing past a
  // fill-absent-only helper. The user asked about swimming pools and would have had the search
  // filtered on a bathroom count they never gave.
  //
  // Scoped as narrowly as the evidence allows: drop it ONLY when the message mentions a pool AND
  // states no bathroom count of its own. «فيها مسبح و٣ حمامات» keeps its 3, and a message with no
  // pool at all is untouched — the model still PROPOSES, this only refuses a number the text cannot
  // support. Same rule as «كبير» never becoming a bedroom count: never invent a number.
  const stated = arabicBathroomCount(text);
  if (stated === null && POOL_RE.test(foldAlef(toWesternDigits(String(text ?? ""))))) {
    delete base.bathrooms;
    return base;
  }
  if (base.bathrooms !== undefined && base.bathrooms !== null && base.bathrooms !== "") return base;
  if (stated !== null) base.bathrooms = stated;
  return base;
}
