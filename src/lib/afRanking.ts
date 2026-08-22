// PURE ranking/gating logic for the Advanced Filter question engine — extracted from
// src/data/advancedFilters.ts (2026-08-22) so scoreQuestion() can be EXECUTED by barriers instead of
// grepped, matching the precedent src/lib/afCohorts.ts already set for cohortAllows() (2026-08-20).
// advancedFilters.ts imports ./remote and @/i18n (→ @/lib/supabase), which is why every existing AF
// verify script reads IT as source text — a regex cannot prove a numeric gate. This module imports
// nothing but types, so a plain `node --experimental-strip-types` test can call scoreQuestion() with
// real fixtures and assert the real answers, which is what makes the narrowing gate mutation-provable.
// advancedFilters.ts re-exports everything below verbatim; nothing else in the app imports this file
// directly except that re-export and this module's own barrier.

export type AdvancedOption = { key: string; label: string; count: number };
export type AdvancedQuestionResult = { options: AdvancedOption[]; unknownCount: number; total: number };

// A question shows only when it clears the scope-size floor AND has at least this many options for
// its arity (single needs a real choice of ≥2; a single meaningful multi chip is a valid yes/no).
export const MIN_OPTIONS_SINGLE = 2;
export const MIN_OPTIONS_MULTI = 1;
export function minOptionsFor(selection: 'single' | 'multi'): number {
  return selection === 'multi' ? MIN_OPTIONS_MULTI : MIN_OPTIONS_SINGLE;
}

// Scope-size floor: don't ask a question unless the current scope has MORE results than the
// interview's stop line (owner 2026-08-11 contextual-interview rework — unchanged by this file's
// 2026-08-22 narrowing-gate rework below).
export const INTERVIEW_STOP_AT = 25;
export const MIN_TOTAL_TO_SHOW = INTERVIEW_STOP_AT + 1;

// Per-OPTION floor — one absolute value for EVERY question (contract §9). An option backed by fewer
// than this many listings is not a meaningful choice and is hidden, full stop — this is the ONLY
// floor an option must clear to be considered real; see the narrowing gate below for whether a real
// option is then worth ASKING about.
export const MIN_REAL_OPTION_COUNT = 5;
export function meaningful(options: AdvancedOption[]): AdvancedOption[] {
  return options.filter((o) => o.count >= MIN_REAL_OPTION_COUNT);
}

// ── Contextual ranking (owner 2026-08-11; narrowing-gate rework 2026-08-22) ──────────────────────
// score = split × salience, computed from the CURRENT candidate set's counts. `split` peaks when an
// option covers half the set (1 − |2k/N − 1|) — this is an ORDERING signal only (asks the most
// informative question first), never an inclusion gate. Unknown ≠ no throughout: options only ever
// count KNOWN matches.
export const SALIENCE: Record<string, number> = {
  property_age: 1.0, furnished: 1.0, rating: 1.0, unit_subtype: 0.95, bathrooms: 0.9, street_width: 0.9,
  amenities: 0.8, direction: 0.7, rnpl: 0.6,
};

// ASK-FIRST TIER (owner 2026-08-15). Installments (رايز/إيجاري) is the PREFERRED opening question
// for Annual Rent → Apartment. "Preferred" — NOT mandatory: a tier only reorders questions that
// ALREADY PASSED scoreQuestion()'s gates below. A scope with zero confirmed installment coverage
// fails that gate, scoreQuestion returns null, and the contextual engine picks the next genuinely
// useful question — never a question that wastes the user's time.
export const ASK_FIRST_TIER: Record<string, number> = { rnpl: 1 };
export function askTier(id: string): number { return ASK_FIRST_TIER[id] ?? 0; }

// NARROWING GATE (owner rule, 2026-08-22 — supersedes the 2026-08-11 "8%-90% option band"): a
// question is asked whenever it has a real, source-backed choice that would actually change the
// result set — never suppressed just because that choice is a small slice or a lopsided majority.
// "We still have thousands of listings" must never end in "but we ran out of questions to ask"
// while a valid one exists. Every option here already cleared the ABSOLUTE per-option floor
// (`meaningful()`, MIN_REAL_OPTION_COUNT = 5) upstream — this gate only asks "does picking this
// option change anything for THIS user's current scope", i.e. `count < N`. An option where
// count === N is a genuine no-op (100% of the scope already has it) and is correctly excluded — not
// because it is unpopular, but because selecting it would never narrow anything. Selectivity still
// decides ASK ORDER (bestSplit below feeds the sort in rankQuestions), it just no longer decides
// inclusion — see docs/ADVANCED_FILTER_DESIGN_CONTRACT.md "Amendment 2026-08-22".
export function scoreQuestion(
  questionId: string, selection: 'single' | 'multi', result: AdvancedQuestionResult,
): { score: number; options: AdvancedOption[] } | null {
  const N = result.total;
  if (N < MIN_TOTAL_TO_SHOW) return null;
  const narrowing = result.options.filter((o) => o.count < N);
  if (narrowing.length < minOptionsFor(selection)) return null;
  const bestSplit = Math.max(...narrowing.map((o) => 1 - Math.abs((2 * o.count) / N - 1)));
  return { score: bestSplit * (SALIENCE[questionId] ?? 0.5), options: narrowing };
}
