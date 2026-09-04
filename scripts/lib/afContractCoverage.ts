// THE AF RATING SUBSTRATE — every Product Contract rule, its coverage grade, and the pure scoring
// function the routine's health numbers are computed FROM.
//
// WHY THIS EXISTS (owner challenge, 2026-08-28)
// --------------------------------------------
// The 2026-08-28 run reported «ADVANCED FILTER HEALTH: 9.4/10» and could not say what produced the
// 9.4. It was calibrated judgement against the previous run's number — a direction of travel, not a
// measurement. The owner's objection is exact: a 9.5 must mean "production is extremely close to
// docs/ADVANCED_FILTER_PRODUCT_CONTRACT.md", not "the suite is green". Green suites are the input
// to the score, never the score itself.
//
// So the score is now DERIVED, rule by rule, from this table, and `verify-af-contract-coverage-map.ts`
// fails the build if the table ever stops covering the contract. A rule cannot be quietly dropped to
// make a number look better: dropping it is what turns the barrier red.
//
// THE GRADES — and why L outranks B
// ---------------------------------
//   L  live-tested against PRODUCTION in the run being scored (a real browser journey, or a live
//      RPC/DB differential). Only this proves the deployed product obeys the rule.
//   B  barrier-protected: an executing check that asserts the rule's own invariant, green this run.
//      Strong evidence about the CODE. It cannot see a deploy that never shipped, a runtime
//      condition, or data drift — so it is deliberately worth less than L.
//   P  partial: covered only indirectly (an adjacent barrier, a static source pin), or the rule has
//      two halves and only one is honoured. Rationale sentences and worked examples live here —
//      they are illustrations of a rule graded elsewhere, not independently testable claims.
//   N  no meaningful coverage, or production is known NOT to implement the rule.
//
// A rule graded N is not automatically a defect. R7.1.3 is graded N because production genuinely
// does not render the unknown-count caption — that is a CONTRACT/PRODUCTION CONFLICT awaiting an
// owner decision (§0.1 forbids this routine from editing an owner rule), not a bug to fix quietly.
//
// THE WEIGHTS — user impact, not implementation effort
// ---------------------------------------------------
//   3  load-bearing: break it and a user is shown a WRONG ANSWER, or a truthful narrowing is lost.
//   2  important: correctness of the interaction, not of the number.
//   1  illustrative/structural: worked examples, rationale, cross-references.
//
// score(dimension) = 10 × Σ(weight × gradeScore) / Σ(weight)  over that dimension's rules.
//
// This is honest about its own limits, and the limits are the point:
//   • It measures COVERAGE-WEIGHTED CONFORMANCE, not absence of unknown bugs. A rule nothing tests
//     cannot be scored as passing. R2.1.2 and R5.6.1 were the two N-grades that dragged the number
//     down until 2026-08-30, when the barriers they were waiting for were built
//     (verify-af-cohort-questions-certified, verify-af-salience-orders-only) and both moved to B.
//     They are named here on purpose: a grade moves because a barrier now EXISTS and EXECUTES, and
//     the coverage-map barrier below proves that for every cited barrier — never because a run
//     wanted a higher number.
//   • Trending is NOT in the Product Contract at all (T-rules below are sourced from this routine's
//     own spec). That split is itself an open owner question — see AF_RATING_METHODOLOGY.md.

export type Grade = 'L' | 'B' | 'P' | 'N';
export type Dim = 'af' | 'trending' | 'integrity';

export const GRADE_SCORE: Record<Grade, number> = { L: 1.0, B: 0.85, P: 0.5, N: 0 };

export type Entry = {
  rule: string;
  dim: Dim;
  weight: 1 | 2 | 3;
  grade: Grade;
  barrier: string[];      // verifier basenames, '' when none
  evidence: string;
};

// ── §1 SEARCH SCOPE ──────────────────────────────────────────────────────────────────────────────
const S1: Entry[] = [
  { rule: 'R1.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-category-single-select'], evidence: 'executes setCategory(): re-tap clears, switch clears every downstream field' },
  { rule: 'R1.1.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-category-single-select'], evidence: 'cohortAllows() rejects a cross-category scope → zero questions' },
  { rule: 'R1.1.3', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-independent-oracle'], evidence: 'CI 33170823272: residential requests carry p_tables2/p_types2 (scope B); oracle exact on all 9' },
  { rule: 'R1.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-multi-group-scope'], evidence: 'live 2026-08-28: Villa+Duplex, Apartment+Floor and Shop+Showroom multi-type scopes all resolved and counted exactly' },
  { rule: 'R1.2.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-multi-group-scope'], evidence: 'live: Villa+Duplex is two groups inside one category — scope built, N=3,867, ID-exact vs the oracle' },
  { rule: 'R1.2.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-category-single-select'], evidence: 'same mechanism as R1.1.2' },
  { rule: 'R1.3.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-multiselect-combining-semantics'], evidence: 'p_types pinned as membership (OR) in the clause mirror; live 3-type union in CI' },
  { rule: 'R1.3.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-independent-oracle'], evidence: 'CI: every normal filter applied uniformly across the type union, ID-exact' },
  { rule: 'R1.3.3', dim: 'af', weight: 1, grade: 'L', barrier: [], evidence: 'live type-union arithmetic: Jeddah Villa Buy=3,866 and Villa+Duplex=3,867 — the union adds exactly Duplex rows, never an intersection or a product' },
  { rule: 'R1.4.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-buy-rent-combined-af-gating'], evidence: 'live: Riyadh apartments Buy=11,203 Rent=20,043 Combined=31,246 = the exact sum (row-level union)' },
  { rule: 'R1.4.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-buy-rent-combined-af-gating'], evidence: 'live: combined with the BUY cap only = 30,697; adding the RENT cap = 27,644 — each leg priced by its own budget' },
  { rule: 'R1.4.3', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-buy-rent-combined-af-gating'], evidence: 'live: the combined Rent leg spans both periods (Rent 20,043 = Annual 11,158 + Monthly 8,885)' },
  { rule: 'R1.5.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-rent-period-both', 'verify-mixed-period-af-gating'], evidence: 'live: both-periods 20,043 = Annual 11,158 + Monthly 8,885, an exact union' },
  { rule: 'R1.5.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-rent-period-both'], evidence: 'single shared rent budget in plain-Rent both-period mode' },
  { rule: 'R1.6.1', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-surface-judge'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): every option count was computed against exactly the current search body; 150 cross-field AND cases priced the second option INSIDE the first answer and matched the oracle for the conjunction — AF never re-scoped on its own' },
  { rule: 'R1.6.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-cross-round-carry'], evidence: '2026-08-31 live AF interview journey (production, desktop): progressive narrowing measured across a full round: 10,316 -> 3,193 -> 356 -> 8, each question\'s option counts computed against the PREVIOUS round\'s narrowed set, and the final committed count (8) equalled the results turn actually delivered («كل النتائج المطابقة (8 إعلان)»).' },
];

// ── §2 QUESTION CERTIFICATION ────────────────────────────────────────────────────────────────────
const S2: Entry[] = [
  { rule: 'R2.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-group-cohort-coverage'], evidence: 'every askable question resolved through COHORT_QUESTIONS' },
  { rule: 'R2.1.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cohort-questions-certified'], evidence: 'every cohort shipping questions is proved to hold an ENABLED af_cohort_registry row, read from the byte-exact sql/mirrors/af_cohort_registry.sql (2026-08-30; was the map\'s only weight-3 N)' },
  { rule: 'R2.1.3', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-group-cohort-coverage'], evidence: '"uncertified = do not ask" is the contrapositive of R2.1.1' },
  { rule: 'R2.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-group-cohort-coverage'], evidence: 'live intersection across selected types: Villa+Duplex offered ONLY bathrooms, dropping street_width/direction/property_age/amenities that Villa alone allows' },
  { rule: 'R2.2.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'rationale for R2.2.1' },
  { rule: 'R2.2.3', dim: 'af', weight: 1, grade: 'L', barrier: [], evidence: 'the contract worked example reproduced live: Apartment+Villa Buy offered property_age/amenities/bathrooms/direction and dropped street_width, exactly as written' },
  { rule: 'R2.2.4', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-group-cohort-coverage'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 150 multi-type pairs walked; every empty certified intersection offered nothing and every surviving question\'s option matched DB truth on the type-union scope' },
  { rule: 'R2.3.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-mixed-period-af-gating'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 31 both-period (كلاهما) options across the cohorts certified for BOTH Annual and Monthly: chip = search total = oracle (verbatim clause translation), 0 mismatches' },
  { rule: 'R2.3.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'rationale for R2.3.1' },
  { rule: 'R2.4.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-buy-rent-combined-af-gating'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 24 combined Buy∪Rent options on the questions certified for all three legs: chip = search total = oracle, 0 mismatches' },
  { rule: 'R2.4.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-buy-rent-combined-af-gating'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): only bathrooms/amenities survived into the combined scope (rnpl, furnished, rating, age, direction, street width excluded), each verified exact' },
  { rule: 'R2.5.1', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-independent-oracle', 'verify-af-unknown-count-truthful'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 105 unknown captions (age / furnished / direction) = the DB\'s NULL count exactly; no unknown folded into a chip' },
  { rule: 'R2.5.2', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-surface-judge', 'verify-rpc-clause-invariants'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): every oracle row re-evaluated in JS: 0 NULL→value leaks and 0 predicate violations across every strict option' },
  { rule: 'R2.5.3', dim: 'integrity', weight: 1, grade: 'P', barrier: [], evidence: 'cross-reference to ops/ADVANCED_FILTER_SOURCE_TRUTH.md' },
  { rule: 'R2.5.4', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-probe-failure-not-a-verdict'], evidence: 'was X1 (uncontracted); made canonical by the owner 2026-08-28. probeVerdict() executed: failed probe -> unknown, retry once, never known-empty' },
];

// ── §3 SCOPE HIERARCHY ───────────────────────────────────────────────────────────────────────────
const S3: Entry[] = [
  { rule: 'R3.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-scope-hierarchy'], evidence: 'unresolvedScopeTiers() ordering CATEGORY→GROUP→TYPE' },
  { rule: 'R3.1.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-interview-hierarchy'], evidence: 'scope questions precede the pool' },
  { rule: 'R3.1.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'scope steps excluded from AF_ROUND_MAX_QUESTIONS' },
  { rule: 'R3.2.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-scope-hierarchy'], evidence: 'single-member group auto-resolves' },
  { rule: 'R3.2.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-offer-gate', 'verify-af-agent-cta-live'], evidence: 'CI 33170823272 agent-CTA: 4/4 offered-and-opened, never offered-then-empty' },
  { rule: 'R3.3.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'scope answers carried across rounds' },
];

// ── §4 THE OFFER BUTTON ──────────────────────────────────────────────────────────────────────────
const S4: Entry[] = [
  { rule: 'R4.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-takes-over-cta'], evidence: 'live browser 2026-08-28: جدة 6,113 — button rendered, required a tap, no auto-open' },
  { rule: 'R4.1.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-takes-over-cta'], evidence: '2026-08-31 live AF interview journey (production, desktop): AF question card + footer rendered inline in the document flow beneath the results turn; no dialog/overlay path taken.' },
  { rule: 'R4.2.1', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-takes-over-cta'], evidence: 'live browser: once a new turn landed, at most ONE interactive offer button exists in the transcript' },
  { rule: 'R4.2.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-takes-over-cta'], evidence: 'live browser desktop and mobile: previous turns carry no interactive offer' },
  { rule: 'R4.3.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-offer-gate'], evidence: 'INTERVIEW_STOP_AT=25 hide; the ≤25 HIDE case was not exercised live this run (all live cohorts were >25)' },
  { rule: 'R4.3.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-offer-gate'], evidence: 'threshold is a hide, not a hard stop' },
  { rule: 'R4.4.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-offer-gate'], evidence: 'CI agent-CTA 4/4; live browser: offer present only after the AF probe resolved' },
  { rule: 'R4.4.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-offer-agreement'], evidence: 'offer and round share optionNarrowsMeaningfully; CI proves never offered-then-empty' },
  { rule: 'R4.4.3', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-offer-gate'], evidence: 'cross-reference' },
  { rule: 'R4.5.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-min-useful-questions-gate'], evidence: 'MIN_USEFUL_QUESTIONS_TO_SHOW=1 pinned in both directions' },
  { rule: 'R4.5.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'rationale for the 2026-08-24 correction' },
];

// ── §5 USEFULNESS — the rule that decides everything ─────────────────────────────────────────────
const S5: Entry[] = [
  { rule: 'R5.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-narrowing-gate'], evidence: '59 live usefulness decisions across 17 cohorts, each recomputed from the contract rule and compared with the real optionNarrowsMeaningfully - 0 disagreements' },
  { rule: 'R5.1.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-narrowing-gate'], evidence: 'the same 59 decisions: the 10-percent-OR-25 constants reproduce production kept/dropped sets exactly' },
  { rule: 'R5.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-narrowing-gate'], evidence: 'live: small-slice options survive throughout, e.g. Taif Rest House at 40 rows keeping options of 2-3' },
  { rule: 'R5.2.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'rule history 2026-08-11→08-25' },
  { rule: 'R5.3.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-narrowing-gate'], evidence: 'live: every option below MIN_REAL_OPTION_COUNT dropped, across 59 decisions, 0 disagreements' },
  { rule: 'R5.4.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-two-option-survival'], evidence: 'MIN_OPTIONS_SINGLE=1 (owner 2026-08-26)' },
  { rule: 'R5.4.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-two-option-survival'], evidence: 'MIN_OPTIONS_MULTI=1' },
  { rule: 'R5.4.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-two-option-survival'], evidence: 'lone surviving option asked as yes/no vs Skip' },
  { rule: 'R5.5.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-narrowing-gate'], evidence: 'CI bathrooms journey: rungs rendered per-rung, base 11,202 → ≥1 selected → 2,469' },
  { rule: 'R5.5.2', dim: 'af', weight: 1, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-surface-judge'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): every bathroom/street-width rung and every age bucket verified per rung: 337 boundaries exercised (a row ON the threshold present), ≥N includes N, buckets closed at both ends, 0 violations' },
  { rule: 'R5.6.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-salience-orders-only'], evidence: 'scoreQuestion() executed across the whole salience range (0 to 1000): ask/skip verdict and surviving option set are invariant, score stays exactly proportional, and order still moves (2026-08-30)' },
  { rule: 'R5.6.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-narrowing-gate', 'verify-af-salience-orders-only'], evidence: '2026-09-03 §6: the REAL scoreQuestion executed over a 4-value ask-tier sweep (0..99) on every fixture — verdict and surviving options invariant; the rule\'s own sentence asserted directly (rnpl on a scope with no installment coverage is REFUSED at every tier); §6.3 proves the tier still bites on order. Mutation: making the tier an inclusion gate in afRanking.ts turns §6.1 red' },
];

// ── §6 ROUNDS ────────────────────────────────────────────────────────────────────────────────────
const S6: Entry[] = [
  { rule: 'R6.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'AF_ROUND_MAX_QUESTIONS=4' },
  { rule: 'R6.1.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'a 1-question round is valid' },
  { rule: 'R6.1.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'scope steps do not count' },
  { rule: 'R6.1.4', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size', 'verify-af-salience-orders-only'], evidence: '2026-09-03 §7: the selection is now asserted directly, not just the absence of a slice — a 6-question pool enumerated WORST-FIRST must yield the top-4 by (real askTier, score), no outscored question dropped, a 2-question pool asks 2. NOT L: advancedFilters.ts/agent.tsx are not standalone-importable by a plain Node runner, so §7 executes the real askTier but assembles the round itself; §7.1 pins the modelled comparator and the count-only cap to the production expressions. Mutation: truncating in pool order, or dropping the tier key from the real comparator, turns it red' },
  { rule: 'R6.2.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'answered AND skipped both carried' },
  { rule: 'R6.2.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'no re-ask across rounds' },
  { rule: 'R6.2.3', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-cross-round-carry'], evidence: 'cross-reference' },
  { rule: 'R6.3.1', dim: 'af', weight: 2, grade: 'L', barrier: [], evidence: 'CI: new results turn lands with the narrowed count (11,202 → 2,469 → 2,319)' },
  { rule: 'R6.3.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-back-boundary'], evidence: 'receipt replaces prior turn buttons' },
  { rule: 'R6.3.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-emoji-summary'], evidence: 'committed answers appear as pills' },
  { rule: 'R6.3.4', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-offer-gate'], evidence: 'offer reappears at >25 with a useful question remaining' },
];

// ── §7 LIVE COUNTS ───────────────────────────────────────────────────────────────────────────────
const S7: Entry[] = [
  { rule: 'R7.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-surface-judge', 'verify-af-option-card-truth-live', 'verify-af-matrix-truth-live', 'verify-af-matrix-truth'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 1,508 option chips (931 region + 577 city) = af_eligible_count = search total_count = paged ID set = independent oracle; 0 count mismatches; plus the rendered card read in a real browser (every pill = cnt_* = oracle). Matrix (same day, الرياض): every certified (scope × mode × question × option) cell: the card\'s number (real resolveOptions on the real count row) == PostgREST count on canonical columns re-expressed from the option\'s meaning == results total; caption == NULL count; options + unknown == scope — 55 cells · 742 options · 4,905 checks · 234,591 returned rows re-verified on canonical columns · 0 empty cells · 0 cells the oracle could not express; live mutants b/f/g/c RED 16/1/4/2 then restored GREEN' },
  { rule: 'R7.1.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-count-belongs-to-selection', 'verify-af-live-truth', 'verify-af-matrix-truth-live'], evidence: 'CI: Continue count = result-RPC total on all 9 journeys; live browser: the card\'s footer IS the count RPC\'s cnt_selected; matrix: every option\'s count == the results total the selection returns (2026-09-02)' },
  { rule: 'R7.1.3', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-unknown-count-truthful'], evidence: 'PRODUCTION VERIFIED 2026-08-28: الرياض/إيجار/سنوي/شقة — the age question shows «382 إعلان لم يذكر هذه المعلومة» (= cnt_unknown in the DB), while rnpl, bathrooms and amenities correctly show NO caption. Derivations exact on 2 cohorts (furnished 7,434/2,191; direction 9,521/345).' },
  { rule: 'R7.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-multiselect-combining-semantics', 'verify-af-matrix-truth', 'verify-af-matrix-truth-live'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): each chip\'s marginal count verified per chip; the footer (cnt_selected) verified as the combined set on 35 same-field unions. Matrix, executed: every option reads exactly the cnt_* column its meaning names; live: each marginal == canonical count on every certified cell' },
  { rule: 'R7.2.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-surface-judge', 'verify-af-multiselect-combining-semantics', 'verify-af-matrix-truth-live'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 35 same-field OR combos = exact set union, 284 cross-field AND combos = exact set intersection, judged on ID sets — both shapes, 0 violations. Matrix, live on every multi-select cell: two amenity chips == SQL INTERSECTION, two directions == SQL UNION, two different fields == intersection, each against PostgREST on canonical columns. Settled per contract §7.2.2 (owner 2026-09-02): same-field values union, boolean amenity chips intersect' },
  { rule: 'R7.3.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-count-belongs-to-selection'], evidence: 'pending window blanks rather than showing a stale value' },
  { rule: 'R7.3.2', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-count-belongs-to-selection'], evidence: 'cross-reference' },
  { rule: 'R7.4.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-result-cap-honesty'], evidence: 'live browser: headline «لقينا 6,113» is the true total, not the displayed-card count' },
  { rule: 'R7.4.2', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-result-cap-honesty'], evidence: 'cross-reference to the result-cap rule' },
  { rule: 'R7.5.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-live-truth', 'verify-af-independent-oracle'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 2,371 live cases diffed to exact (source_table,listing_id) sets against PostgREST: MISSING 0, EXTRA 0, DUPLICATES 0' },
  { rule: 'R7.5.2', dim: 'af', weight: 1, grade: 'B', barrier: ['verify-af-full-surface-differential', 'verify-af-live-truth'], evidence: 'the daily workflow now runs the full-surface sweep (region + city) beside the 9 journeys' },
];

// ── §8 SKIP / BACK / SHOW RESULTS ────────────────────────────────────────────────────────────────
const S8: Entry[] = [
  { rule: 'R8.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-back-navigation'], evidence: 'live browser: Skip left the count at 11,158 unchanged and wrote no predicate into the request' },
  { rule: 'R8.1.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-back-navigation'], evidence: 'live browser, same journey: the count is identical before and after Skip' },
  { rule: 'R8.1.3', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-cross-round-carry'], evidence: '2026-08-31 live AF interview journey (production, desktop): the skipped «كم عمر العقار تقريباً؟» was remembered and not re-offered once the interview advanced.' },
  { rule: 'R8.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-back-navigation'], evidence: 'live browser repro 2026-08-28: question, count (2,469) AND options [1..4] all restored; CI concurs' },
  { rule: 'R8.2.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-round-back-boundary'], evidence: 'Back on Q1 cancels the round byte-identically' },
  { rule: 'R8.2.3', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-round-back-boundary'], evidence: '2026-08-31 live AF interview journey (production, desktop): رجوع from «كم دورة مياه تفضل؟» restored «كم عمر العقار تقريباً؟» writing no receipt and no pill — projected count unchanged at 3,193 across the Back.' },
  { rule: 'R8.2.4', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-back-navigation'], evidence: 'cross-reference' },
  { rule: 'R8.3.1', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-footer-buttons'], evidence: '2026-08-31 live AF interview journey (production, desktop): footer rendered متابعة / رجوع / تخطي as three real, separately clickable buttons on the live question card.' },
  { rule: 'R8.3.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-round-back-boundary'], evidence: '2026-08-31 live AF interview journey (production, desktop): the round ended after 3 questions and a new results turn landed carrying the final count («كل النتائج المطابقة (8 إعلان)»).' },
  // R8.4.1 graded 'B' on verify-af-cross-round-carry until 2026-08-29 — but that barrier never
  // mentions Skip All, and the control itself was removed by the owner on 2026-08-28. The map was
  // therefore awarding the product marks for a feature that does not exist, on a barrier that does
  // not test it: the exact score inflation the owner rejected on 2026-08-28. The honest grade is
  // still 'B', because verify-af-footer-buttons DOES execute this rule's live content — that the
  // control stays REMOVED — in both directions.
  { rule: 'R8.4.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-footer-buttons'], evidence: 'REMOVED from the product (owner 2026-08-28); the barrier pins its absence in both directions' },
];

// ── §9 PILLS ─────────────────────────────────────────────────────────────────────────────────────
const S9: Entry[] = [
  { rule: 'R9.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-emoji-summary', 'verify-af-pill-removal-live'], evidence: 'live 2026-09-02: one AF round on production left 4 removable af-pill-* controls carrying exactly the 4 committed answers (p_bath_min, p_is_new_construction, p_amenities, p_directions)' },
  { rule: 'R9.1.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-emoji-summary'], evidence: 'pills cumulative across rounds' },
  { rule: 'R9.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-cross-round-carry', 'verify-af-pill-removal-live'], evidence: 'live 2026-09-02, on the request the browser actually sent: removing one pill dropped EXACTLY p_bath_min, left the other three byte-identical, invented none, and moved no normal-filter field. Desktop الرياض/شقة and mobile جدة/فيلا' },
  { rule: 'R9.2.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-pill-removal-live'], evidence: 'live 2026-09-02: the count WIDENED 155→237 (mobile 122→265), the new total is re-derivable through the anon REST path, a new results turn landed BELOW, and both earlier headlines were still on screen unchanged. 7/7 mutations killed' },
  { rule: 'R9.2.3', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-cross-round-carry', 'verify-af-pill-removal-live'], evidence: 'live 2026-09-02: «تحديد أكثر» is present on the widened turn, so the removed dimension was not burned out of the asked carry' },
  { rule: 'R9.2.4', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-cross-round-carry'], evidence: 'cross-reference' },
  { rule: 'R9.3.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-emoji-summary'], evidence: '2026-08-31 live AF interview journey (production, desktop): the skipped question produced no pill/receipt anywhere in the transcript summary region.' },
];

// ── §10 SHOW MORE ────────────────────────────────────────────────────────────────────────────────
const S10: Entry[] = [
  { rule: 'R10.1.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-refresh-restores-filter-search'], evidence: 'Show More reveals cards without changing the true total; live sweep journey exists (not run by this routine this run)' },
  { rule: 'R10.1.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-refresh-restores-filter-search'], evidence: 'live browser: Show More and the AF offer render together on the newest turn as independent controls' },
  { rule: 'R10.2.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-chat-persistence'], evidence: 'revealed cards persist in the transcript' },
  { rule: 'R10.2.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-takes-over-cta'], evidence: 'newest turn stays interactive' },
  { rule: 'R10.2.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-takes-over-cta'], evidence: 'prior turn Show More becomes history' },
];

// ── §11 STOPPING CONDITIONS ──────────────────────────────────────────────────────────────────────
const S11: Entry[] = [
  { rule: 'R11.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-offer-gate'], evidence: 'INTERVIEW_STOP_AT=25: at or below 25 results the offer is hidden and a round refuses to open' },
  { rule: 'R11.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-narrowing-gate'], evidence: 'no option clearing the usefulness rule stops AF (Example F)' },
  { rule: 'R11.3', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-group-cohort-coverage'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): multi-type pairs with an empty certified intersection offered no question (observed on the 150-pair walk)' },
  // R11.4: same correction as R8.4.1 — verify-af-round-size never mentions Skip All either.
  { rule: 'R11.4', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-footer-buttons'], evidence: 'REMOVED with the control (owner 2026-08-28); Back-from-Q1 and ✕ are the live early exits' },
];

// ── §12 PERSISTENCE (shared with the journey-persistence routine) ────────────────────────────────
const S12: Entry[] = [
  { rule: 'R12.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-chat-persistence'], evidence: 'AF turns/answers/receipts/pills persist' },
  { rule: 'R12.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-chat-persistence'], evidence: 'switch-away/refresh/re-login restores' },
  { rule: 'R12.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-takes-over-cta'], evidence: 'only newest turn interactive after restore' },
  { rule: 'R12.4', dim: 'af', weight: 1, grade: 'B', barrier: ['verify-chat-persistence'], evidence: 'delete removes the server transcript' },
  { rule: 'R12.5', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-continuous-chat-history'], evidence: 'rounds never fork the sidebar entry' },
];

// ── §13 MUST-NEVERS ──────────────────────────────────────────────────────────────────────────────
const S13: Entry[] = [
  { rule: 'R13.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-narrowing-gate'], evidence: 'filter_tier boundary: AF never asks a Normal-Filter question' },
  { rule: 'R13.2', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-independent-oracle'], evidence: 'satel adjudication 2026-08-28: 89 index-true ↔ 89 source-published acType, 1:1, nothing invented' },
  { rule: 'R13.3', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-surface-judge'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 0 rows with NULL in a strict column reached any returned set, on every option of every certified cohort' },
  { rule: 'R13.4', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-takes-over-cta'], evidence: '2026-08-31 live AF interview journey (production, desktop): all three halves observed — offer «نحدد الطلب» rendered at 18s with NO AF footer present (no auto-open); a single tap on «يقبل التقسيط» kept the SAME question (no auto-advance); AF rendered inline in the transcript flow (no popup).' },
  { rule: 'R13.5', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-no-unsupported-claims'], evidence: 'never recommend/rank-by-best' },
  { rule: 'R13.6', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-full-surface-differential', 'verify-af-option-card-truth-live'], evidence: 'live 2026-09-02, full-surface differential (Riyadh region + جدة): 0 displayed counts disagreed with DB truth across 1,508 option chips, 105 captions and every combo; the rendered card agreed in the browser' },
  { rule: 'R13.7', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-cross-round-carry'], evidence: '2026-08-31 live AF interview journey (production, desktop): «كم عمر العقار تقريباً؟» was skipped, then after advancing past it the question was not re-asked (current «كم دورة مياه تفضل؟»).' },
  { rule: 'R13.8', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-continuous-chat-history'], evidence: 'never fork the sidebar' },
  { rule: 'R13.9', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'never permanently burn an un-answered question' },
  { rule: 'R13.11', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-probe-failure-not-a-verdict'], evidence: 'never turn our own outage into a statement about the data — mayAssertNothingToNarrow() only on a decided verdict' },
  { rule: 'R13.10', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-offer-agreement'], evidence: 'CI agent-CTA 4/4: never offer a round that would have nothing to ask' },
  // ── §12A — the returned card must SHOW what the user selected (owner, 2026-09-03) ──────────────
  // These seven were graded N this morning, when the rule was recorded and production did not
  // satisfy it. They SHIPPED the same day: the card carries a «مطابق لطلبك» strip fed by `af_canon`
  // (migration 20260903154406 — the 28 AF-relevant columns of the exact search_listings_ar row the
  // predicate ran on), src/lib/afEvidence.ts turns the active answers plus that row into chips, and
  // the strip is UNCAPPED so FEATURE_META's VISIBLE=6 can no longer hide a selection.
  //
  // Two barriers, and the split between L and B below is exactly the split between them:
  //   verify-af-card-evidence.ts       offline, in npm test — executes the registry against
  //                                    synthetic rows and holds the SQL mirror and the TypeScript to
  //                                    one contract. Reaches branches the UI cannot.
  //   verify-af-card-evidence-live.ts  a real browser against the DEPLOYED bundle, in
  //                                    af-live-truth-check.yml. Reads the chips a human reads.
  // A rule is L only where the live journey actually EXERCISED it — that journey now counts how many
  // times each branch was reached and reports NOT EXERCISED rather than PASS at zero, so these
  // grades cannot drift into claiming a live proof the run never performed.
  { rule: 'R12A.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-card-evidence', 'verify-af-card-evidence-live'], evidence: 'live 2026-09-03 on the deployed bundle, desktop 1440x900 (الرياض/شقة) AND mobile 390x844 (جدة/فيلا): 4 answers committed per journey, 20 «مطابق لطلبك» strips rendered, and every active answer the row satisfies was ON the card — 0 missing across 80 (question × card) comparisons. 0 strips carried a «+N», قعرض الكلة or «المزيد» affordance' },
  { rule: 'R12A.2', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-card-evidence', 'verify-af-card-evidence-live'], evidence: 'live 2026-09-03, both viewports: every chip equalled the LISTING\'s own canonical value — 0 wrong across 80 comparisons. Each strip was joined to its row by the card\'s own card-listing-<id> wrapper, never by position (positional pairing shifts on any row that earns no strip, and did produce a false «2 vs 3 حمامات» report before the join was fixed); ground truth is the af_canon object off the wire, the exact row the predicate ran on' },
  { rule: 'R12A.3', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-card-evidence', 'verify-af-card-evidence-live'], evidence: 'barrier-protected, NOT live-proved, and the live journey says so itself: both production runs met 0 UNKNOWN (question × card) cases, because §2.5 predicates are NULL-excluding so a returned row normally HAS the value — the null-guard is unreachable through the UI while search is correct. verify-af-card-evidence.ts reaches it with synthetic rows: a null column renders nothing, never «غير مذكور», never 0, never false. Graded B rather than L deliberately' },
  { rule: 'R12A.4', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-card-evidence', 'verify-af-card-evidence-live'], evidence: 'live 2026-09-03, both viewports: 0 of 20 strips hid a selection behind an expander. Met by construction rather than by re-ranking FEATURE_META — the strip is a separate, UNCAPPED surface (a plain .map(), no slice, verified in the shipped bundle), so the VISIBLE=6 feature cap can no longer hide an ACTIVE AF selection. The live check looks for the SHAPE of an expander («+N» / «عرض الكل» / «المزيد») rather than a testID that would only ever be absent' },
  { rule: 'R12A.5', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-card-evidence'], evidence: 'static, and that is the right instrument: verify-af-card-evidence.ts T5 compares the certified token set against the card\'s vocabulary and fails CI if any token is filterable but undrawable — 20 of 20 tokens have a label AND a chip def, 20 defs\' labels equal the AF chip\'s own labelKey, and AMENITY_LABEL carries no entry the filter does not accept. gym, pool, garden, driver_room, car_entrance and both separate meters, undrawable that morning, are drawable now' },
  { rule: 'R12A.6', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-card-evidence', 'verify-af-card-evidence-live'], evidence: 'live 2026-09-03: BOTH barriers this rule mandates now exist and EXECUTE. verify-af-card-evidence.ts (offline, npm test) is the vocabulary-superset half and also holds sql/mirrors/af_canon_select.sql and src/lib/afEvidence.ts to one contract in both directions — 28 columns packed, every column the registry reads is packed, every AF predicate field\'s RPC param is in the payload gate. verify-af-card-evidence-live.ts (af-live-truth-check.yml, af-card-state) is the live journey, run green against production on both viewports this run' },
  { rule: 'R13.12', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-card-evidence', 'verify-af-card-evidence-live'], evidence: 'live 2026-09-03, both viewports: across 80 identity-joined comparisons no chip claimed anything its listing\'s canonical row did not satisfy. The counterfactual branch (a returned row that FAILS an active predicate) was met 0 times and cannot be reached through the UI while search is correct — such a row would itself be a §2.5 violation — so that half is covered offline against synthetic rows. The negative case is live-proved too: a search with NO AF answer rendered 0 strips and carried af_canon on 0 of 1,500 rows' },
];

// ── OWNER RULES NOT (YET) IN THE PRODUCT CONTRACT ────────────────────────────────────────────────
// These are live owner decisions with code and barriers but NO R-number. They are scored, because
// the product obeys them; they are also reported as a CONTRACT GAP, because the canonical document
// does not carry them and a future reader rebuilding AF from the contract alone would lose them.
export const UNCONTRACTED: Entry[] = [
  // EMPTY BY RESOLUTION, not by neglect. X1 ("a failed/timed-out probe is UNKNOWN, never a verdict")
  // was carried here from 2026-08-28 because it had code and a barrier but no R-number. The owner
  // made it canonical the same day as R2.5.4 + R13.11, so the gap is closed and the entry retired.
  // verify-af-contract-coverage-map.ts now proves the closure instead of the gap: it requires the
  // contract to actually carry R2.5.4, so this list cannot be emptied by simply deleting the row.
];

// ── TRENDING — sourced from this routine's spec, NOT from the Product Contract ───────────────────
// Structural finding: the "canonical Product Contract" covers Advanced Filter only. Trending Cities
// and Trending Districts have no R-numbers anywhere. They are graded here against Parts 2 and 3 of
// docs/ops/AF_TRENDING_DATA_INTEGRITY_ENGINEER.md so the routine's own health lines mean something.
// Retired 2026-08-28: T1-T12 were this routine's own reconstruction, used while Trending had no
// R-numbers. The owner made Trending canonical as §14, so those rules now live in S14 above and are
// graded as contract rules like everything else. Kept empty rather than deleted so the structural
// history stays readable.
export const TRENDING: Entry[] = [];

// ── DATA-INTEGRITY rules beyond the contract's own ───────────────────────────────────────────────
export const INTEGRITY_EXTRA: Entry[] = [
  { rule: 'D1-source-to-index-fidelity', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-independent-oracle'], evidence: 'satel traced source→additional_info→index, 1:1 on 90 rows' },
  { rule: 'D2-no-fabricated-booleans', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-data-integrity-contract'], evidence: 'satel: index-true only where the source published a value' },
  { rule: 'D3-unknown-never-becomes-false', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-data-integrity-contract'], evidence: 'satel tri-state intact (1 unknown AC, 4 false kitchens, elevator unknown on all 90)' },
  { rule: 'D4-every-af-platform-field-swept', dim: 'integrity', weight: 3, grade: 'L', barrier: [], evidence: '2026-08-31: the Part 4 sweep ran to completion for the first time — all 50 served source tables × 41 AF fields = 2,050 cells classified (954 DIRECT compared row-by-row over 1,122,084 field-values, 122 DERIVED, 974 ABSENT). 0 mismatches, 0 fabrications. 3 wasalt rows awaiting rich-attr enrichment (known lag, mon_rich_attrs_barrier), and 7 rows whose withheld property_age turned out to be a CORRECT age_source_health() gate (verdict too_small), not a defect — see migration 20260831114938. aqar, the largest platform at 84,698 rows, was wholly clean.' },
  { rule: 'D5-af-field-stuck-alert-adjudicated', dim: 'integrity', weight: 2, grade: 'P', barrier: [], evidence: 'alert af_field_stuck_no_variance still OPEN: the "source publishes no negative value" claim needs a live satel probe and satel.sa is unreachable from CI/agent containers' },
];


// ── §14 TRENDING (contracted 2026-08-28; was this routine's own T1-T12) ─────────────────────────
const S14: Entry[] = [
  { rule: 'R14.1.1', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-trending-carries-full-filter-state'], evidence: '2026-08-28: breakdown of the eligible set, not a cached popularity list — 6 AF states each produced a different city list' },
  { rule: 'R14.1.2', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-af-city-counts-carry-advanced'], evidence: '24/24 advertised = click-through across elevator, elevator+parking, bath>=3, furnished and a 3-way stack' },
  { rule: 'R14.1.3', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-af-count-params-carry-advanced'], evidence: 'جدة/الدمام/الخبر district rows under AF answers, 24/24 exact' },
  { rule: 'R14.2.1', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-district-counts-honest'], evidence: 'browser desktop+mobile UI = REQUEST = RPC (الرياض 37,492 · جدة 22,365 · الدمام 6,988 · الخبر 5,715)' },
  { rule: 'R14.2.2', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-trending-carries-full-filter-state'], evidence: '2026-08-31 live AF interview journey (production, desktop): adversarially re-tested live this run: the SAME trending surface returned entirely different city lists and counts per parameter set — unnarrowed Buy/Residential الرياض 37,005 vs +beds=3+price 500k-1.5M الرياض 7,794 — so counts are recomputed per parameter set, not cached.' },
  { rule: 'R14.2.3', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-district-counts-honest'], evidence: 'a live per-row count fires for every row, not only the first 12' },
  { rule: 'R14.2.4', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-district-orthography-match'], evidence: '2026-08-28: جدة حي الصفا match_values=2 counted whole (42), matching the UI' },
  { rule: 'R14.3.1', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-district-counts-honest'], evidence: 'every widening fallback gated on "is the user narrowed"; live-proved 2026-08-23' },
  { rule: 'R14.3.2', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-district-counts-honest', 'verify-trending-live-four-way-truth'], evidence: '2026-09-01 live browser, DOM row -> click-through: the advertised district count IS the count after clicking it in 4/4 journeys across 3 cities, desktop and mobile — الرمال 562==562, الرحمانية 447==447 (under a 3M ceiling), المهدية 1796==1796 (under price+area), الشعلة 974==974 (mobile 390x844). Previously only barrier-proved; scope vs narrowed still differ up to 116x (696 -> 6)' },
  { rule: 'R14.4.1', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-af-count-params-carry-advanced', 'verify-af-city-counts-carry-advanced', 'verify-trending-live-four-way-truth'], evidence: 'rpcAllNarrowingParams is the single definition every count surface spreads; live-proved 2026-09-01 by typing the narrowing into the REAL controls (price-max-input 900,000 + area-min-input 120) and asserting the trending call itself carried p_price_max=900000 and p_area_min=120 — inheritance of a state the USER set, not one poked into the request' },
  { rule: 'R14.4.2', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-trending-usable-under-narrowing'], evidence: 'live CI every 6h since the 2026-08-27 statement-timeout fix; this run measured 302-651ms' },
];

export const CONTRACT_RULES: Entry[] = [
  ...S1, ...S2, ...S3, ...S4, ...S5, ...S6, ...S7, ...S8, ...S9, ...S10, ...S11, ...S12, ...S13, ...S14,
];

export const ALL_ENTRIES: Entry[] = [...CONTRACT_RULES, ...UNCONTRACTED, ...TRENDING, ...INTEGRITY_EXTRA];

/** 0–10, weighted by user impact, over whichever entries are passed in. */
export function score(entries: Entry[]): number {
  const w = entries.reduce((a, e) => a + e.weight, 0);
  if (!w) return 0;
  const got = entries.reduce((a, e) => a + e.weight * GRADE_SCORE[e.grade], 0);
  return Math.round((10 * got / w) * 10) / 10;
}

export function byDim(entries: Entry[], dim: Dim): Entry[] {
  return entries.filter((e) => e.dim === dim);
}

/** Counts used by the routine's FINAL REPORT lines. */
export function tally(entries: Entry[]) {
  const t = { L: 0, B: 0, P: 0, N: 0 } as Record<Grade, number>;
  for (const e of entries) t[e.grade]++;
  return t;
}
