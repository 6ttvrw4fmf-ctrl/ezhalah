// Owner ruling 2026-08-29: fix «مليون ونص», keep the prompt as it is.
// Auto-discovered barrier; also part of the edge-deploy gate.
//
// THE LIVE DEFECT. Production-verified 2026-08-29 during the post-optimization A/B:
//   «دور للبيع في الرياض من ٨٠٠ الف الى مليون ونص مساحته اكبر من ٢٠٠ متر»  ->  price 800000
// extractPrice's NUM_RE requires a LEADING ASCII DIGIT. «٨٠٠ الف» matched (800 x الف), but
// «مليون ونص» carries no numeral at all and produced NO candidate. With a single candidate the
// range-MAX rule (added 2026-07-27 for exactly this class of bug) could not fire, so the user's
// 1,500,000 ceiling silently became 800,000 — a budget nearly halved, with the reply still
// promising the full range.
//
// Same family as the Arabic-Indic digit blindness (toWesternDigits, PR #1283): an Arabic-first
// product whose deterministic money parser only understood Western notation.
//
// This barrier tests extractPrice END TO END, not just the word parser, because the defect lived in
// the SEAM between them — the parser could be perfect and the bug would survive.
import { readFileSync } from "node:fs";
import { arabicWordAmounts } from "../supabase/functions/agent/postModel.ts";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`);
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── the word parser itself ───────────────────────────────────────────────────
console.log("── arabicWordAmounts: amounts written in Arabic words ──");
const v = (t: string) => arabicWordAmounts(t).map((a) => a.value);
eq("«مليون ونص» = 1.5m", JSON.stringify(v("مليون ونص")), JSON.stringify([1_500_000]));
eq("«نص مليون» = 500k", JSON.stringify(v("نص مليون")), JSON.stringify([500_000]));
eq("«مليونين» (DUAL — no numeral at all) = 2m", JSON.stringify(v("مليونين")), JSON.stringify([2_000_000]));
eq("«مليونين ونص» = 2.5m", JSON.stringify(v("مليونين ونص")), JSON.stringify([2_500_000]));
eq("«ثلاثة ملايين» = 3m", JSON.stringify(v("ثلاثة ملايين")), JSON.stringify([3_000_000]));
eq("«خمسة آلاف» = 5k", JSON.stringify(v("خمسة آلاف")), JSON.stringify([5_000]));
eq("«ربع مليون» = 250k", JSON.stringify(v("ربع مليون")), JSON.stringify([250_000]));
eq("«الفين» = 2k", JSON.stringify(v("الفين")), JSON.stringify([2_000]));
eq("«مليار» = 1bn", JSON.stringify(v("مليار")), JSON.stringify([1_000_000_000]));
// Spelling variants real users actually type.
eq("«ألف» with hamza folds to «الف»", JSON.stringify(v("ثلاثة ألف")), JSON.stringify([3_000]));
eq("«آلاف» with madda", JSON.stringify(v("عشرة آلاف")), JSON.stringify([10_000]));

console.log("\n── the conservative guards (these are what keep it safe) ──");
eq("a unit already preceded by DIGITS is skipped — NUM_RE owns «٨٠٠ الف», never double-count",
  JSON.stringify(v("800 الف")), JSON.stringify([]));
eq("digits with a comma still own their unit", JSON.stringify(v("1,500 الف")), JSON.stringify([]));
eq("bare «نص» invents nothing (it also means \"text\" in MSA)", JSON.stringify(v("نص")), JSON.stringify([]));
eq("bare «ربع» invents nothing", JSON.stringify(v("ربع")), JSON.stringify([]));
eq("ordinary prose invents nothing", JSON.stringify(v("شقة كبيرة في الرياض")), JSON.stringify([]));
eq("a count word with NO unit invents nothing", JSON.stringify(v("ثلاثة غرف")), JSON.stringify([]));

// ── extractPrice END TO END — the seam where the bug actually lived ──────────
console.log("\n── extractPrice end-to-end (the seam, not just the parser) ──");
const edge = readFileSync(new URL("../supabase/functions/agent/index.ts", import.meta.url), "utf8");
check("word amounts are merged into extractPrice's candidates",
  /for \(const wa of arabicWordAmounts\(t\)\)/.test(edge));
check("candidates keep text position so the range rule still means 'first in the sentence'",
  /candidates\.sort\(\(a, b\) => a\.index - b\.index\)/.test(edge));
check("the range-MAX rule reads the merged candidate values",
  /Math\.max\(\.\.\.candidates\.map\(\(c\) => c\.n\)\)/.test(edge));
check("word amounts get the SAME size-unit guard as digits (a «مليون متر» is not a budget)",
  /for \(const wa of arabicWordAmounts\(t\)\)[\s\S]{0,400}?متر\|م٢/.test(edge));
check("word amounts get the SAME currency conversion as digits",
  /for \(const wa of arabicWordAmounts\(t\)\)[\s\S]{0,600}?AR_CURRENCY/.test(edge));

if (failed) {
  console.error(`\n✗ ${failed} check(s) FAILED — Arabic word-amount parsing is broken`);
  process.exit(1);
}
console.log("\nOK — Arabic word-written amounts parse, and the range ceiling sees them");
