// The Property Age (عمر العقار) advanced-filter eligibility gate.
//
// Extracted from src/app/agent.tsx (2026-07-17, when the first Commercial types landed) for the same
// reason src/lib/platformDiversity.ts was: agent.tsx pulls in react-native/expo-router, so no plain
// node runner can import it, and this gate decides whether a user is offered the age question at all.
// Living here it is directly unit-testable by scripts/verify-age-filter-gate.ts (wired into `npm test`),
// which asserts every macro below against CLEAN_MACRO — the single source derived from HIERARCHY — so
// a future taxonomy move cannot silently desync the gate from the real category of a type.
//
// WHY A MACRO PER TYPE, not a global category check: until 2026-07-17 this gate was
// `q.category === 'Residential' && AGE_FILTER_TYPES.has(type)`. Adding مكتب/مستودع (both Commercial)
// could have been done by widening that to accept Commercial too — but that would let ANY listed type
// fire under EITHER category. Tagging each type with its own macro is strictly tighter: فيلا can never
// offer the question inside a Commercial search, and مستودع (which is kinds:BOTH — it genuinely appears
// in residential AND commercial tables) can never offer it inside a Residential one.
//
// ADDING A TYPE: verify against LIVE production first — (1) the scope clears MIN_TOTAL_TO_SHOW=150 with
// >=2 buckets at MIN_REAL_BUCKET_COUNT=5, (2) counts == search exactly, (3) sum(buckets)+unknown ==
// total exactly (proves no unknown-age row leaks into a bucket), (4) the wrong category returns 0.
// Verify using the p_types array CLEAN_TO_TYPE_AR actually derives, NOT the bare Arabic label — several
// types carry a second rawType. Then add one line here. No backend change is needed: the RPCs are
// type-agnostic. See docs/ADVANCED_FILTER_PATTERN.md.

export type AgeFilterMacro = 'Residential' | 'Commercial';

export const AGE_FILTER_TYPES = new Map<string, AgeFilterMacro>([
  // ── Residential ───────────────────────────────────────────────────────────────────────────────
  ['Apartment', 'Residential'],            // gold standard, live since 2026-07-16 (PR #101)
  ['Residential Building', 'Residential'], // PR #114: 34% coverage, genuine 5-bucket spread
                          // (buy: new 289/1-2 34/3-5 387/6-9 569/10+ 933), counts==search parity confirmed.
  ['Room', 'Residential'], // غرفة: rooms are rented — enough data only in the big rent scopes
                          // (الرياض/إيجار 1,127 rows, all 5 buckets; جدة/إيجار 425); the thresholds hide it
                          // elsewhere. Parity الرياض cnt_3_5=220==search 220, all strictly in [3,5].
  ['Floor', 'Residential'], // دور: الرياض/إيجار has a genuine 5-bucket spread (new 280/1-2 73/3-5 446/
                          // 6-9 246/10+ 200); الرياض/بيع (9,839) skews «new» but all 5 buckets still clear
                          // MIN_REAL_BUCKET_COUNT. Parity الرياض/إيجار cnt_3_5=446==search 446, all strict.
  ['Villa', 'Residential'], // فيلا: the strongest type after Apartment — 33,167 rows, 54% coverage
                          // (highest of any type), all 5 buckets, clears MIN_TOTAL_TO_SHOW in 10+ cities
                          // (الرياض/بيع alone: 11,593 rows at 81% — new 7,354/1-2 175/3-5 594/6-9 498/10+ 817).
                          // قصر/Palace folds into فيلا per the locked type rule. Parity on BOTH deals
                          // (buy cnt_10p=817==817; rent cnt_3_5=718==718), all strict, wrong-category 0.

  // ── Commercial (first non-Residential types, 2026-07-17) ──────────────────────────────────────
  // Both verified against the EXACT p_types arrays CLEAN_TO_TYPE_AR derives, NOT the bare Arabic label:
  // Office → ['مكتب','مكاتب مشتركة'], Warehouse → ['مستودع','مخازن سحابية'].
  ['Office', 'Commercial'], // مكتب: 2,454 rows, 47% coverage. الرياض/إيجار (1,804) has all 5 buckets —
                          // new 218/1-2 15/3-5 156/6-9 246/10+ 212; جدة/إيجار (197) shows 4; elsewhere the
                          // thresholds correctly hide it. Parity cnt_6_9=246==search 246, all 246 strictly in
                          // [6,9]; buckets+unknown==total exactly (1804==1804); wrong-category returns 0.
  ['Warehouse', 'Commercial'], // مستودع: 1,363 rows, 33.5% coverage — the THINNEST type enabled, and
                          // deliberately so. الرياض/إيجار (650) is the ONLY scope that clears the gate
                          // (new 68/1-2 7/3-5 67/6-9 42/10+ 50); جدة (131) and الدمام (114) fall under
                          // MIN_TOTAL_TO_SHOW and stay hidden — the thresholds, not this list, keep it honest.
                          // Parity cnt_3_5=67==search 67; buckets+unknown==total exactly (650==650).
                          // Warehouse is kinds:BOTH, so the macro tag is what stops it offering the question
                          // inside a Residential search.
]);

// A type is eligible only inside its OWN macro, and only when it is the sole selected type (a
// multi-type search has no single age distribution to ask about).
export function isAgeFilterScope(q: { category?: string | null }, effectiveTypes: string[]): boolean {
  if (effectiveTypes.length !== 1) return false;
  return !!q.category && AGE_FILTER_TYPES.get(effectiveTypes[0]) === q.category;
}
