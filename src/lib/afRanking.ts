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
// its arity.
//
// OWNER CORRECTION 2026-08-26 — MIN_OPTIONS_SINGLE moved 2 → 1, so the two arities are now UNIFORM.
// It used to read "single needs a real choice of ≥2; a single meaningful multi chip is a valid
// yes/no", and §(e) below recorded the cost of that asymmetry as deliberate design. The owner
// reversed it: «if filtering removes the useless/lopsided option but leaves one genuinely useful
// option, do not throw away the whole question just because one option remains».
//
// WHY IT IS NOT A FORCED ANSWER. The objection ≥2 was written for is that one choice gives the user
// nothing to decide. That is false on this card: «تخطي» is rendered UNCONDITIONALLY
// (AdvancedQuestionCard.tsx — testID af-skip, never branched on arity or option count) and applies
// ZERO predicate (agent.tsx onAgeSkip → commitGuidedStep([]), no facet, no false written). So the
// user really is choosing between «مفروشة» → 60 and skip → keep 1,000. That is a genuine yes/no —
// which is exactly why MIN_OPTIONS_MULTI already allowed it, and the asymmetry had no defensible
// basis once the survivor had to clear optionNarrowsMeaningfully anyway.
//
// The gate that keeps this honest is unchanged and upstream: the survivor still had to clear the
// absolute floor (MIN_REAL_OPTION_COUNT) AND optionNarrowsMeaningfully. ZERO survivors still kills
// the question — a lopsided-only question stays unasked, which is the whole 2026-08-25 rule.
// Measured on production before shipping: docs/ops/af-single-option-yes-no-2026-08-26.md.
export const MIN_OPTIONS_SINGLE = 1;
export const MIN_OPTIONS_MULTI = 1;
export function minOptionsFor(selection: 'single' | 'multi'): number {
  return selection === 'multi' ? MIN_OPTIONS_MULTI : MIN_OPTIONS_SINGLE;
}

// Scope-size floor: don't ask a question unless the current scope has MORE results than the
// interview's stop line (owner 2026-08-11 contextual-interview rework — unchanged by the 2026-08-22
// and 2026-08-25 narrowing-gate reworks below).
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

// ── Contextual ranking (owner 2026-08-11; narrowing-gate reworks 2026-08-22, 2026-08-25) ───────
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

// ── THE NARROWING PREDICATE — ONE rule, used by BOTH gates ──────────────────────────────────────
// The ONLY place the owner's 10% lives. scoreQuestion() below calls it to decide whether an OPTION
// may be asked about; offersMeaningfulNarrowing() at the bottom of this file calls it to decide
// whether «تحديد أكثر» may be OFFERED at all. Two copies of this arithmetic would eventually drift
// into a button that opens a round and immediately closes it — the exact bug shape PR #1094 had to
// fix for a different cause. One predicate makes that unrepresentable.
//
// Removal form (`total - count >= total * FRACTION`), so EXACTLY 10% qualifies: at N=50 a count of
// 45 is the last qualifying answer, not the first rejected one. The second clause exists so the LAST
// step to the target is never blocked by a percentage: at N=26 a count of 25 removes only 3.8% but
// lands AT the target, which is the whole point of the round.
export const MEANINGFUL_NARROWING_FRACTION = 0.1;
export function optionNarrowsMeaningfully(count: number, total: number): boolean {
  return total - count >= total * MEANINGFUL_NARROWING_FRACTION || count <= INTERVIEW_STOP_AT;
}

// NARROWING GATE (owner rule, 2026-08-25 — supersedes the 2026-08-22 wording quoted below, which
// itself superseded the 2026-08-11 "8%-90% option band"; the history is kept on purpose, this has
// now moved twice).
//
// (a) WHAT IT DOES. An option is included only when answering it can actually move the set:
// `optionNarrowsMeaningfully(count, N)` — remove ≥10% of the current scope, OR land at/under
// INTERVIEW_STOP_AT. The owner's worked case: "You have 100 properties. If the next question is
// 'do you want a gym?' but 100/100 have a gym, asking it is pointless — the answer cannot narrow
// anything. Same if 98/100 have it." Bathrooms at N=100 with rungs 100/98/60/20: «1+»=100 (0% cut)
// and «2+»=98 (2% cut) are DROPPED, «3+»=60 (40%) and «4+»=20 (80%) are KEPT — the question survives
// with a real choice of two, and the user never sees a chip that does nothing. Gym at 100/100 loses
// its only option, so that question dies entirely. That is the point, not a side effect.
//
// (b) ONE-SIDED, DELIBERATELY. It rejects only NEAR-NO-OP options; it must never reject an option for
// being a SMALL slice. An option matching 8 of 100 removes 92% and is an excellent question. Only the
// lopsided end is the gym problem.
//
// (c) WHAT THE 2026-08-22 RULE PROTECTED IS PRESERVED. That rule said: "a question is asked whenever
// it has a real, source-backed choice that would actually change the result set — never suppressed
// just because that choice is a small slice or a lopsided majority. 'We still have thousands of
// listings' must never end in 'but we ran out of questions to ask' while a valid one exists." It was
// written against the 2026-08-11 band, which rejected BOTH extremes — and the small-slice half of
// that ban was the real bug (street_width «30m+» at 60 of 1,874 = 3.2%, dropped while it would have
// taken the user from 1,874 to 60). That half stays banned forever. The over-correction was keeping
// options like 1,820 of 1,874 (97.1%), which cost the user a tap and moved nothing. Nothing is
// invented and nothing is forced to reach the ≤25 target: when no meaningful truthful option remains,
// the Advanced Filter is DONE, at 50 or 100 results, and only «عرض المزيد» is left.
//
// (d) UNCHANGED AROUND IT. Every option here already cleared the ABSOLUTE per-option floor
// (`meaningful()`, MIN_REAL_OPTION_COUNT = 5) upstream; minOptionsFor() still decides whether what
// survives is a real choice (≥1 for BOTH arities since the owner's 2026-08-26 correction — it read
// "single ≥2, multi ≥1" until then); and selectivity (bestSplit) still decides ASK
// ORDER only, never inclusion. See docs/ADVANCED_FILTER_DESIGN_CONTRACT.md "Amendment 2026-08-25".
//
// (e) ONE KNOCK-ON EFFECT, NAMED SO IT IS NOT MISTAKEN FOR A BUG: ASK ORDER can shift. bestSplit is
// a max over the SURVIVING options, so a question whose most balanced option was a near-no-op now
// scores lower and may be asked later. That is the ranking telling the truth about what the question
// can still do.
//
// ~~A SECOND effect used to be listed here (2026-08-25, SUPERSEDED 2026-08-26): "a question can die
// at the QUESTION level even though the gate is one-sided at the OPTION level: a single-select split
// 92%/6% loses its 92% chip, is left with one survivor, and fails MIN_OPTIONS_SINGLE — so a 94%-cut
// option can disappear with its partner. That is the owner's specified design (filter the options,
// then let minOptionsFor decide), not an accident."~~ The owner REVERSED that on 2026-08-26: a lone
// surviving meaningful option is now ASKED, as a yes/no against Skip. See MIN_OPTIONS_SINGLE above
// for the reasoning and scripts/verify-af-two-option-survival.ts for the (inverted) barrier. The old
// wording is kept struck-through, not deleted, because this rule has now moved and a future reader
// must be able to see both positions rather than trust whichever paragraph they read first.
export function scoreQuestion(
  questionId: string, selection: 'single' | 'multi', result: AdvancedQuestionResult,
): { score: number; options: AdvancedOption[] } | null {
  const N = result.total;
  if (N < MIN_TOTAL_TO_SHOW) return null;
  const narrowing = result.options.filter((o) => optionNarrowsMeaningfully(o.count, N));
  if (narrowing.length < minOptionsFor(selection)) return null;
  const bestSplit = Math.max(...narrowing.map((o) => 1 - Math.abs((2 * o.count) / N - 1)));
  return { score: bestSplit * (SALIENCE[questionId] ?? 0.5), options: narrowing };
}

// ── PROGRESSIVE ROUNDS (owner 2026-08-24) ───────────────────────────────────────────────────────
// The interview is no longer one long questionnaire: it narrows in SMALL CONVERSATIONAL ROUNDS, each
// a manual tap on «تحديد أكثر», each computed from the ALREADY-NARROWED cohort of the round before.
//
// ROUND SIZE is a COUNT CAP, never a quality filter: a round asks min(availableUsefulQuestions,
// AF_ROUND_MAX_QUESTIONS) advanced questions, minimum 1. Which questions those are is still decided
// only by scoreQuestion() — the owner's narrowing rule (2026-08-25) — so a question is never dropped
// mid-round to hit the cap, and never asked when its options cannot move the set. SCOPE steps (property_group / property_type) do not
// count toward it: they are the prerequisite that earns the right to ask, exactly as the
// scope→advanced transition gate already treats them.
export const AF_ROUND_MAX_QUESTIONS = 4;

// ── THE OFFER GATE — same rule as the ASK gate, one turn earlier (owner 2026-08-24/2026-08-25) ──
// May we OFFER «تحديد أكثر» at all? A round costs the user taps, so it is offered only when it can
// pay for itself: more than INTERVIEW_STOP_AT results AND some remaining option that
// optionNarrowsMeaningfully(). At N=50 an option yielding 45 qualifies and one yielding 47 does not;
// at N=27 an option yielding 24 qualifies. Nothing qualifying ⇒ the button is HIDDEN.
//
// As of the owner's 2026-08-25 decision this calls the SAME predicate scoreQuestion() uses, instead of
// re-implementing the arithmetic. That is a hard requirement, not tidiness: while the ask gate was the
// looser `count < N`, an offer could promise a round whose questions the round itself would then drop
// — tap, open, close. Sharing the predicate makes offer and round agree by construction. (The
// old explicit `o.count < total` guard is gone because it is now implied: with total > INTERVIEW_STOP_AT,
// count === total removes 0% and fails the fraction, so a no-op option can never earn an offer.)
//
// CONSEQUENCE, STATED PLAINLY: on the advanced-pool path this is now a TAUTOLOGY, and that is the
// point rather than a smell. agent.tsx probes it with rankQuestions' OWN output — options scoreQuestion
// has already filtered through this same predicate — so it cannot say no to a question the round would
// say yes to. "Tap, open, immediately close" stops being unlikely and becomes unrepresentable. Keep the
// function: it is what makes the shared rule explicit at the call site, it still guards the
// ≤INTERVIEW_STOP_AT hide, and it is the seam a future non-ranked caller would have to go through.
export function offersMeaningfulNarrowing(total: number, options: readonly AdvancedOption[]): boolean {
  if (total <= INTERVIEW_STOP_AT) return false;
  return options.some((o) => optionNarrowsMeaningfully(o.count, total));
}
