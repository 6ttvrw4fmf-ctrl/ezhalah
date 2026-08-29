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

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — a post-model rule the owner ruled on is not holding`);
  process.exit(1);
}
console.log("\nOK — all three deterministic post-model rules hold and are wired into the agent");
