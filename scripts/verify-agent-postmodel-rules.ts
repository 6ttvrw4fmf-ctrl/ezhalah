// Owner ruling 2026-08-29 — three DETERMINISTIC post-model rules for the AI agent.
// Auto-discovered barrier (scripts/run-tests.mjs) and part of the edge-deploy gate.
//
// The owner's instruction was explicit: make these deterministic assertions with regression tests
// and mutation proof, and do NOT start a large prompt-engineering project. So none of these live in
// the prompt. They are pure functions in supabase/functions/agent/postModel.ts, imported by the edge
// function at runtime and unit-tested here with no network and no live data.
//
//   RULE 1  change only the rental period → never re-scale a previously stated budget
//   RULE 2  if the reply promises "cheapest", the query must actually sort cheapest
//   RULE 3  Arabic chat returns Arabic location labels when a canonical Arabic label exists
//
// Each rule is also proven to be LOAD-BEARING in the edge function: the wiring is asserted below,
// so deleting the call site fails this barrier even though the pure unit tests would still pass.

import { readFileSync } from "node:fs";
import {
  effectiveBasis,
  enforceSortMatchesReply,
  arabicCanonicalLocation,
  isPeriodOnlyChange,
  periodFromText,
  hasDigits,
  toWesternDigits,
  arabicBathroomCount,
  fillBathroomsIfAbsent,
} from "../supabase/functions/agent/postModel.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── helpers ──────────────────────────────────────────────────────────────────
console.log("── primitives ──");
eq("hasDigits: western digits", hasDigits("budget 70000"), true);
eq("hasDigits: Arabic-Indic ٧٠", hasDigits("بميزانية ٧٠ الف"), true);
eq("hasDigits: Extended Arabic-Indic ۷۰", hasDigits("۷۰ الف"), true);
eq("hasDigits: no figure", hasDigits("لا خلها شهري"), false);
eq("periodFromText: شهري → monthly", periodFromText("لا خلها شهري"), "monthly");
eq("periodFromText: سنوي → annual", periodFromText("للايجار السنوي في الرياض"), "annual");
eq("periodFromText: بالشهر → monthly", periodFromText("٥ آلاف بالشهر"), "monthly");
eq("periodFromText: none → null", periodFromText("شقق في الرياض"), null);
eq("periodFromText: BOTH periods → null (not a clean signal)", periodFromText("شهري او سنوي"), null);

// ── Arabic numerals ──────────────────────────────────────────────────────────
// Found live 2026-08-29 while production-verifying RULE 1: nothing in the agent normalized
// Arabic-Indic digits, and JS \d is ASCII-only, so extractPrice() could not see «٧٠ الف» at all.
// An Arabic-first product was ignoring every budget typed in its users' own numerals.
console.log("\n── Arabic-Indic digit normalization (money parsing depends on it) ──");
eq("Arabic-Indic ٧٠ → 70", toWesternDigits("٧٠"), "70");
eq("Extended Arabic-Indic ۷۰ → 70", toWesternDigits("۷۰"), "70");
eq("REPRO: «بميزانية ٧٠ الف» becomes parseable", toWesternDigits("بميزانية ٧٠ الف"), "بميزانية 70 الف");
eq("all ten Arabic-Indic digits", toWesternDigits("٠١٢٣٤٥٦٧٨٩"), "0123456789");
eq("Western digits untouched", toWesternDigits("70000 ريال"), "70000 ريال");
eq("pure Arabic text untouched", toWesternDigits("شقق للايجار"), "شقق للايجار");
eq("mixed «٣ غرف ... ٨٠ الف»", toWesternDigits("٣ غرف بميزانية ٨٠ الف"), "3 غرف بميزانية 80 الف");

// ── RULE 1 ───────────────────────────────────────────────────────────────────
console.log("\n── RULE 1: period-only change must not re-scale a carried budget ──");
eq("isPeriodOnlyChange: «لا خلها شهري»", isPeriodOnlyChange("لا خلها شهري"), true);
eq("isPeriodOnlyChange: period + NEW budget is NOT period-only",
  isPeriodOnlyChange("خلها شهري بميزانية ٥ آلاف"), false);
eq("isPeriodOnlyChange: no period word", isPeriodOnlyChange("غير المدينة الى جدة"), false);

// THE LIVE BUG (C2, 2026-08-29): 70,000/YEAR stated in turn 1, «لا خلها شهري» in turn 2.
// Old behavior multiplied the carried 70,000 by turn 2's monthly_rent basis → 840,000.
eq("C2 REPRO: annual budget + period-only flip to monthly → annual_rent (×1), NOT monthly_rent (×12)",
  effectiveBasis({
    currentText: "لا خلها شهري",
    priceCameFromCurrentTurn: false,
    carriedFromText: "شقق ٣ غرف للايجار السنوي في الرياض بميزانية ٧٠ الف",
    modelBasis: "monthly_rent",
  }), "annual_rent");

eq("mirror: monthly budget + period-only flip to annual → keeps monthly_rent (its own period)",
  effectiveBasis({
    currentText: "لا خلها سنوي",
    priceCameFromCurrentTurn: false,
    carriedFromText: "شقق للايجار الشهري بميزانية ٥ آلاف",
    modelBasis: "annual_rent",
  }), "monthly_rent");

eq("carried budget whose own turn named NO period → never multiplied",
  effectiveBasis({
    currentText: "لا خلها شهري",
    priceCameFromCurrentTurn: false,
    carriedFromText: "ابغى شقة بميزانية ٧٠ الف",
    modelBasis: "monthly_rent",
  }), "");

eq("budget stated in THIS turn → model basis applies unchanged (M3 must not regress)",
  effectiveBasis({
    currentText: "شقة للايجار الشهري في جدة بأقل من ٥ آلاف بالشهر",
    priceCameFromCurrentTurn: true,
    carriedFromText: "",
    modelBasis: "monthly_rent",
  }), "monthly_rent");

eq("carried budget + message that is NOT a period change → unchanged behavior",
  effectiveBasis({
    currentText: "غير المدينة الى جدة",
    priceCameFromCurrentTurn: false,
    carriedFromText: "شقق للايجار السنوي بميزانية ٧٠ الف",
    modelBasis: "annual_rent",
  }), "annual_rent");

// ── RULE 2 ───────────────────────────────────────────────────────────────────
console.log("\n── RULE 2: reply promising 'cheapest' must carry the cheapest sort ──");
eq("N1 REPRO: «أرخص القصور» with no sort → price_asc",
  enforceSortMatchesReply("أبشر، أعرض لك أرخص القصور في الرياض.", undefined), "price_asc");
eq("«ارخص» without hamza → price_asc",
  enforceSortMatchesReply("ابشر، ارخص الشقق", undefined), "price_asc");
eq("English 'cheapest' → price_asc",
  enforceSortMatchesReply("Showing the cheapest apartments.", undefined), "price_asc");
eq("«أقل سعر» → price_asc", enforceSortMatchesReply("مرتبة من أقل سعر", undefined), "price_asc");
eq("mirror: «أغلى» → price_desc", enforceSortMatchesReply("أغلى الفلل في جدة", undefined), "price_desc");
eq("no ordering promised → stays undefined",
  enforceSortMatchesReply("أبشر، أدور لك شقق في الرياض.", undefined), undefined);
eq("explicit model sort is NEVER overridden",
  enforceSortMatchesReply("أرخص الشقق", "newest"), "newest");
eq("'none' is treated as absent",
  enforceSortMatchesReply("أرخص الشقق", "none"), "price_asc");

// ── RULE 3 ───────────────────────────────────────────────────────────────────
console.log("\n── RULE 3: Arabic chat returns Arabic location labels ──");
eq("F2 REPRO: 'Jeddah' in Arabic chat → «جدة»",
  arabicCanonicalLocation({ location: "Jeddah", canonicalArabic: "جدة", locale: "ar" }), "جدة");
eq("already Arabic → untouched",
  arabicCanonicalLocation({ location: "الرياض", canonicalArabic: "الرياض", locale: "ar" }), "الرياض");
eq("English chat keeps the English label",
  arabicCanonicalLocation({ location: "Jeddah", canonicalArabic: "جدة", locale: "en" }), "Jeddah");
eq("NO canonical Arabic → original passes through (never lose an unknown place)",
  arabicCanonicalLocation({ location: "Neom Bay", canonicalArabic: "", locale: "ar" }), "Neom Bay");
// The canonical and the input must DIFFER here, or the assertion cannot distinguish "guard held"
// from "guard removed" — a weak version of this test survived mutation M5 and was rewritten.
eq("canonical is itself Latin → original passes through (never a transliteration)",
  arabicCanonicalLocation({ location: "Jeddah", canonicalArabic: "Jiddah", locale: "ar" }), "Jeddah");
eq("empty location stays empty (whole-of-Saudi search)",
  arabicCanonicalLocation({ location: "", canonicalArabic: "جدة", locale: "ar" }), "");
eq("mixed Arabic+Latin district resolves to the canonical Arabic",
  arabicCanonicalLocation({ location: "حي Al Narjis", canonicalArabic: "حي النرجس", locale: "ar" }), "حي النرجس");

// ── RULE 4 ───────────────────────────────────────────────────────────────────
// Measured live (12 reps/phrasing against production, 2026-08-31) BEFORE this backstop:
//   «...نادي وحمامين» 1/12, «...حمامين» alone 9/12, «...مصعد وحمامين» (OLD certified token) 1/12,
//   EN "gym and two bathrooms" 12/12, mixed "gym وحمامين" 3/12. The elevator control proves this
//   is a pre-existing model-reliability gap, not caused by the gym/amenity certification work.
console.log("\n── RULE 4: af.bathrooms backstop fills an absent value, never a bare numeral ──");
eq("REPRO 1: «...نادي وحمامين» (gym + dual)", arabicBathroomCount("أبي شقة فيها نادي وحمامين"), "2");
eq("REPRO 2: «...حمامين» alone (dual, no digit anywhere)", arabicBathroomCount("أبي شقة فيها حمامين"), "2");
eq("REPRO 3: «...مصعد وحمامين» (OLD certified elevator token + dual)",
  arabicBathroomCount("أبي شقة فيها مصعد وحمامين"), "2");
eq("REPRO 4: English word count", arabicBathroomCount("I want an apartment with a gym and two bathrooms"), "2");
eq("REPRO 5: mixed-script «gym وحمامين»", arabicBathroomCount("أبي شقة فيها gym وحمامين"), "2");
eq("dual «حمامان»", arabicBathroomCount("شقة فيها حمامان"), "2");
eq("دورة مياه dual «دورتين مياه»", arabicBathroomCount("شقة فيها دورتين مياه"), "2");
eq("Arabic digit + plural «٣ حمامات»", arabicBathroomCount("أبي شقة فيها ٣ حمامات"), "3");
eq("Arabic count-word + plural «ثلاث حمامات»", arabicBathroomCount("أبي شقة فيها ثلاث حمامات"), "3");
eq("count-word «واحد» + singular «حمام واحد» → 1", arabicBathroomCount("أبي فيلا فيها حمام واحد"), "1");
eq("English digit form «3 bathrooms»", arabicBathroomCount("I need 3 bathrooms please"), "3");
eq("English «baths»", arabicBathroomCount("looking for a place with 2 baths"), "2");
eq("NEVER A BARE NUMERAL: a digit with no bathroom word stays null (bedroom-count rule mirror)",
  arabicBathroomCount("ابغى شقة فيها ٢ غرف"), null);
eq("NEVER A BARE COUNT-WORD: no bathroom noun present stays null",
  arabicBathroomCount("عندي عائلة من ٤ أشخاص"), null);
eq("POOL GUARD: «حمام سباحة» (swimming pool) must not become '1 bathroom'",
  arabicBathroomCount("شقة فيها حمام سباحة"), null);
// The case above alone is a WEAK assertion — it passes even with the pool guard deleted, because
// there is no digit/count-word adjacent to «حمام» for the digit/word-count branches to misfire on
// in the first place. THIS is the actually-discriminating repro: a digit sits directly next to
// «حمام سباحة», so removing the guard makes the digit-count branch mistake "2 pools" for "2
// bathrooms" — confirmed by deliberately deleting the guard during development (it returned "2").
eq("POOL GUARD (discriminating): a digit directly beside «حمام سباحة» must still not count as bathrooms",
  arabicBathroomCount("شقة فيها ٢ حمام سباحة"), null);
// The singular was guarded; the PLURAL and the DUAL were not, and both were live on production
// 2026-09-01 — «حمامين سباحة» returned "2" and «٣ حمامات سباحة» returned "3", i.e. swimming pools
// counted as bathrooms and filtered the search on a number the user never gave. The guard is now a
// single strip at the top of arabicBathroomCount rather than a lookahead per alternative, so these
// three cases pin every shape of the noun.
eq("POOL GUARD (dual): «حمامين سباحة» is two POOLS, not two bathrooms",
  arabicBathroomCount("ابغى فيلا فيها حمامين سباحة"), null);
eq("POOL GUARD (dual, second form): «حمامان سباحة» likewise",
  arabicBathroomCount("ابغى فيلا فيها حمامان سباحة"), null);
eq("POOL GUARD (plural): «٣ حمامات سباحة» is three POOLS, not three bathrooms",
  arabicBathroomCount("ابغى شقة فيها ٣ حمامات سباحة"), null);
// The companion that keeps the strip HONEST: it must remove the pool phrase, not eat real counts.
// Without this, deleting the whole bathroom parser would pass every assertion above.
eq("a real bathroom count beside a pool still reads",
  arabicBathroomCount("فيلا فيها حمام سباحة و٣ حمامات"), "3");

// …AND THE SAME RULE WHEN THE MODEL IS THE ONE SAYING IT. Guarding only the parser was proved
// insufficient ON THE LIVE FUNCTION: after the parser fix deployed, «فيها حمامين سباحة» still came
// back with af.bathrooms = 2 — a NUMBER, where arabicBathroomCount returns strings, so it was the
// model's own proposal passing through a fill-absent-only helper untouched.
eq("model-proposed bathrooms are DROPPED when the message only mentions a pool (dual)",
  fillBathroomsIfAbsent({ bathrooms: 2 }, "ابغى فيلا للبيع في الرياض فيها حمامين سباحة").bathrooms, undefined);
eq("…and for the plural form",
  fillBathroomsIfAbsent({ bathrooms: 3 }, "ابغى شقة فيها ٣ حمامات سباحة").bathrooms, undefined);
eq("…and the singular",
  fillBathroomsIfAbsent({ bathrooms: 1 }, "شقة فيها حمام سباحة").bathrooms, undefined);
// Scope: this must refuse ONLY a number the text cannot support. Both companions below fail if the
// guard is widened into "ignore the model whenever a pool is mentioned".
// Must use «حمام سباحة» — the phrase POOL_RE actually matches. An earlier draft used «مسبح», which
// POOL_RE does not match, so the case never reached the guard and a widened guard survived mutation.
eq("a real count stated alongside a pool is KEPT",
  fillBathroomsIfAbsent({ bathrooms: 3 }, "فيلا فيها حمام سباحة و٣ حمامات").bathrooms, 3);
eq("a message with no pool at all leaves the model's value alone",
  fillBathroomsIfAbsent({ bathrooms: 2 }, "ابغى فيلا فيها حمامين").bathrooms, 2);
eq("vague word never becomes a count (mirrors «كبير» never becomes bedrooms)",
  arabicBathroomCount("بيت جميل وكبير"), null);
eq("unrelated amenity, no bathroom mention at all → null",
  arabicBathroomCount("شقة فيها مصعد وموقف"), null);

console.log("\n── RULE 4: fillBathroomsIfAbsent — fill-absent-only (RULE 2's precedent) ──");
eq("an EXPLICIT model value is NEVER overridden, even when the text also says «حمامين»",
  fillBathroomsIfAbsent({ bathrooms: "3" }, "أبي شقة فيها حمامين").bathrooms, "3");
eq("absent af.bathrooms + extractable text → filled",
  fillBathroomsIfAbsent({}, "أبي شقة فيها حمامين").bathrooms, "2");
eq("absent af.bathrooms + nothing extractable → stays absent (never invented)",
  fillBathroomsIfAbsent({}, "شقة عادية في جدة").bathrooms, undefined);
eq("other af keys pass through untouched",
  fillBathroomsIfAbsent({ rating: "9.0" }, "شقة فيها حمامين").rating, "9.0");
eq("non-object af (model sent something malformed) is sanitized to {} before filling",
  fillBathroomsIfAbsent(null, "شقة فيها حمامين").bathrooms, "2");
// null/undefined spread to {} even without a guard (JS quirk), so the case above alone would not
// catch a deleted !Array.isArray check. An array is the case that ACTUALLY discriminates it: naive
// `{...af}` on an array produces numeric-keyed junk ({0: "x"}) instead of {}.
eq("array af (malformed) is sanitized to {} too, not spread into numeric keys",
  fillBathroomsIfAbsent(["x"], "شقة فيها حمامين").bathrooms, "2");

// ── WIRING: the rules must actually be LOAD-BEARING in the edge function ─────
console.log("\n── wiring (pure tests alone cannot prove the edge function calls these) ──");
const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
check("edge imports the rules module",
  /import\s*\{[^}]*effectiveBasis[^}]*\}\s*from\s*"\.\/postModel\.ts"/.test(edge));
check("RULE 1 wired: the multiplication uses budgetBasis, not the raw model basis",
  edge.includes("const budgetBasis = effectiveBasis({") && edge.includes("budgetBasis in rentMult")
  && edge.includes("rentMult[budgetBasis]"));
check("RULE 1 wired: the carried-budget source turn is captured",
  edge.includes("carriedFromText = String(history[i]?.text ?? \"\")")
  && edge.includes("const priceCameFromCurrentTurn = !!detPrice;"));
check("RULE 1: the OLD unconditional multiplication is gone",
  !/if\s*\(deal === "Rent" && price && basis in rentMult\)\s*\{\s*\n\s*const n = parseInt\(price, 10\);\s*\n\s*if \(isFinite\(n\)\) \{ price = String\(n \* rentMult\[basis\]\)/.test(edge));
check("RULE 2 wired: sort goes through enforceSortMatchesReply against the FINAL reply",
  /sort:\s*enforceSortMatchesReply\(replyOut,/.test(edge));
check("RULE 3 wired: location goes through arabicCanonicalLocation with the catalog's name",
  /location = arabicCanonicalLocation\(\{ location, canonicalArabic: nm, locale \}\)/.test(edge));
check("extractPrice normalizes Arabic numerals BEFORE parsing (else Arabic budgets are invisible)",
  /function extractPrice[\s\S]{0,400}?const t = toWesternDigits\(input\)\.toLowerCase\(\)/.test(edge));
check("originalCurrency normalizes Arabic numerals too (same ASCII-only flaw)",
  /function originalCurrency[\s\S]{0,400}?const t = toWesternDigits\(input\)\.toLowerCase\(\)/.test(edge));
check("RULE 4 wired: edge imports fillBathroomsIfAbsent",
  /import\s*\{[^}]*fillBathroomsIfAbsent[^}]*\}\s*from\s*"\.\/postModel\.ts"/.test(edge));
check("RULE 4 wired: applied on BOTH the listings response AND the message/clarification path "
  + "(understoodState()) — a clarification turn must not silently drop what the backstop filled, "
  + "same invariant as the 'clarification may pause, never erase' rule",
  (edge.match(/af:\s*fillBathroomsIfAbsent\(out\.af,\s*text\)/g) ?? []).length === 2);
check("RULE 4: no leftover unvalidated af pass-through remains (the old inline check is fully replaced)",
  !edge.includes('af: (out.af && typeof out.af === "object" && !Array.isArray(out.af)) ? out.af : {}'));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — a post-model rule the owner ruled on is not holding`);
  process.exit(1);
}
console.log("\nOK — all four deterministic post-model rules hold and are wired into the agent");
