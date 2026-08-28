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
//     cannot be scored as passing, which is exactly why R2.1.2 and R5.6.1 drag the number down.
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
  { rule: 'R1.6.1', dim: 'af', weight: 2, grade: 'P', barrier: [], evidence: 'NO barrier asserts "AF never re-scopes on its own"; implied only by the count-carry checks' },
  { rule: 'R1.6.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'round N+1 computed against the narrowed set' },
];

// ── §2 QUESTION CERTIFICATION ────────────────────────────────────────────────────────────────────
const S2: Entry[] = [
  { rule: 'R2.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-group-cohort-coverage'], evidence: 'every askable question resolved through COHORT_QUESTIONS' },
  { rule: 'R2.1.2', dim: 'af', weight: 3, grade: 'N', barrier: [], evidence: 'GAP: "No question ships without a ledger entry" is enforced by NOTHING — no script cross-checks COHORT_QUESTIONS against docs/AF_COHORT_LEDGER.md' },
  { rule: 'R2.1.3', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-group-cohort-coverage'], evidence: '"uncertified = do not ask" is the contrapositive of R2.1.1' },
  { rule: 'R2.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-group-cohort-coverage'], evidence: 'live intersection across selected types: Villa+Duplex offered ONLY bathrooms, dropping street_width/direction/property_age/amenities that Villa alone allows' },
  { rule: 'R2.2.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'rationale for R2.2.1' },
  { rule: 'R2.2.3', dim: 'af', weight: 1, grade: 'L', barrier: [], evidence: 'the contract worked example reproduced live: Apartment+Villa Buy offered property_age/amenities/bathrooms/direction and dropped street_width, exactly as written' },
  { rule: 'R2.2.4', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-group-cohort-coverage'], evidence: 'empty intersection → zero questions' },
  { rule: 'R2.3.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-mixed-period-af-gating'], evidence: 'both-period intersection executed' },
  { rule: 'R2.3.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'rationale for R2.3.1' },
  { rule: 'R2.4.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-buy-rent-combined-af-gating'], evidence: 'cohortAllowsCombined() executed' },
  { rule: 'R2.4.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-buy-rent-combined-af-gating'], evidence: 'buy-only/rent-only/monthly-only correctly excluded' },
  { rule: 'R2.5.1', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-independent-oracle', 'verify-af-unknown-count-truthful'], evidence: 'BOTH halves production-verified 2026-08-28: unknown is never rolled into a chip, AND the user is now shown it — «382 إعلان لم يذكر» on the age question, no caption where no truthful count exists.' },
  { rule: 'R2.5.2', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-rpc-clause-invariants', 'verify-af-multiselect-combining-semantics'], evidence: '108 live option counts = search RPC across 3 cohorts; clause predicates pinned NULL-strict' },
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
  { rule: 'R4.1.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-takes-over-cta'], evidence: 'no popup/overlay path exists' },
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
  { rule: 'R5.5.2', dim: 'af', weight: 1, grade: 'P', barrier: [], evidence: 'worked Example G' },
  { rule: 'R5.6.1', dim: 'af', weight: 2, grade: 'N', barrier: [], evidence: 'GAP: no barrier asserts SALIENCE affects ASK ORDER ONLY and never inclusion — a weight leaking into inclusion would silently delete useful questions' },
  { rule: 'R5.6.2', dim: 'af', weight: 2, grade: 'P', barrier: ['verify-af-narrowing-gate'], evidence: 'ASK_FIRST_TIER reorders only; covered indirectly by the usefulness gate' },
];

// ── §6 ROUNDS ────────────────────────────────────────────────────────────────────────────────────
const S6: Entry[] = [
  { rule: 'R6.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'AF_ROUND_MAX_QUESTIONS=4' },
  { rule: 'R6.1.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'a 1-question round is valid' },
  { rule: 'R6.1.3', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'scope steps do not count' },
  { rule: 'R6.1.4', dim: 'af', weight: 2, grade: 'P', barrier: ['verify-af-round-size'], evidence: 'structural negative ("never truncated to hit the cap") — contract §15.2 acknowledges no direct test' },
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
  { rule: 'R7.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-independent-oracle'], evidence: '108 live option counts = search RPC, 3 cohorts, 0 mismatches (2026-08-28)' },
  { rule: 'R7.1.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-count-belongs-to-selection'], evidence: 'CI: Continue count = result-RPC total on all 9 journeys' },
  { rule: 'R7.1.3', dim: 'af', weight: 2, grade: 'L', barrier: ['verify-af-unknown-count-truthful'], evidence: 'PRODUCTION VERIFIED 2026-08-28: الرياض/إيجار/سنوي/شقة — the age question shows «382 إعلان لم يذكر هذه المعلومة» (= cnt_unknown in the DB), while rnpl, bathrooms and amenities correctly show NO caption. Derivations exact on 2 cohorts (furnished 7,434/2,191; direction 9,521/345).' },
  { rule: 'R7.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-multiselect-combining-semantics'], evidence: 'each chip reads its own cnt_*; live marginals kitchen/parking/elevator exact' },
  { rule: 'R7.2.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-multiselect-combining-semantics'], evidence: 'AND ac+elevator=1,619; OR شمال+جنوب=813=488+325. Contract WORDING incomplete (names only the union shape) — owner question open.' },
  { rule: 'R7.3.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-count-belongs-to-selection'], evidence: 'pending window blanks rather than showing a stale value' },
  { rule: 'R7.3.2', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-count-belongs-to-selection'], evidence: 'cross-reference' },
  { rule: 'R7.4.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-result-cap-honesty'], evidence: 'live browser: headline «لقينا 6,113» is the true total, not the displayed-card count' },
  { rule: 'R7.4.2', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-result-cap-honesty'], evidence: 'cross-reference to the result-cap rule' },
  { rule: 'R7.5.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-live-truth', 'verify-af-independent-oracle'], evidence: '15 cohorts diffed to EXACT (source_table,listing_id) sets against the independent PostgREST oracle: missing=extra=duplicates=0 on all 15 after the oracle soundness fixes' },
  { rule: 'R7.5.2', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-live-truth'], evidence: 'cross-reference' },
];

// ── §8 SKIP / BACK / SHOW RESULTS ────────────────────────────────────────────────────────────────
const S8: Entry[] = [
  { rule: 'R8.1.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-back-navigation'], evidence: 'live browser: Skip left the count at 11,158 unchanged and wrote no predicate into the request' },
  { rule: 'R8.1.2', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-back-navigation'], evidence: 'live browser, same journey: the count is identical before and after Skip' },
  { rule: 'R8.1.3', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'skipped question remembered, not re-asked' },
  { rule: 'R8.2.1', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-back-navigation'], evidence: 'live browser repro 2026-08-28: question, count (2,469) AND options [1..4] all restored; CI concurs' },
  { rule: 'R8.2.2', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-round-back-boundary'], evidence: 'Back on Q1 cancels the round byte-identically' },
  { rule: 'R8.2.3', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-round-back-boundary'], evidence: 'Back writes no receipt/pill/probe verdict' },
  { rule: 'R8.2.4', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-back-navigation'], evidence: 'cross-reference' },
  { rule: 'R8.3.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-back-boundary'], evidence: 'Show Results commits and ends the round early' },
  { rule: 'R8.3.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-back-boundary'], evidence: 'new results turn; prior buttons become the receipt' },
  { rule: 'R8.4.1', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'Skip All skips the remainder, all remembered' },
];

// ── §9 PILLS ─────────────────────────────────────────────────────────────────────────────────────
const S9: Entry[] = [
  { rule: 'R9.1.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-emoji-summary'], evidence: 'committed answers render as removable pills' },
  { rule: 'R9.1.2', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-emoji-summary'], evidence: 'pills cumulative across rounds' },
  { rule: 'R9.2.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'removing a pill removes only that predicate' },
  { rule: 'R9.2.2', dim: 'af', weight: 2, grade: 'P', barrier: [], evidence: 'the "count may widen, nothing above is rewritten" half is not directly asserted' },
  { rule: 'R9.2.3', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'removed question dropped from the asked carry — never permanently burned' },
  { rule: 'R9.2.4', dim: 'af', weight: 1, grade: 'P', barrier: ['verify-af-cross-round-carry'], evidence: 'cross-reference' },
  { rule: 'R9.3.1', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-emoji-summary'], evidence: 'skipped questions never appear in the summary' },
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
  { rule: 'R11.3', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-group-cohort-coverage'], evidence: 'empty certified intersection stops AF' },
  { rule: 'R11.4', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-round-size'], evidence: 'Skip All ends the round; future rounds may still open' },
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
  { rule: 'R13.3', dim: 'integrity', weight: 3, grade: 'L', barrier: ['verify-af-independent-oracle'], evidence: 'satel: the one row with no acType stays UNKNOWN; 108 live counts NULL-strict' },
  { rule: 'R13.4', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-takes-over-cta'], evidence: 'never auto-open/auto-advance/popup' },
  { rule: 'R13.5', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-no-unsupported-claims'], evidence: 'never recommend/rank-by-best' },
  { rule: 'R13.6', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-live-truth'], evidence: 'CI: no displayed count disagreed with DB truth on any of 9 journeys' },
  { rule: 'R13.7', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'never re-ask an answered/skipped question' },
  { rule: 'R13.8', dim: 'af', weight: 2, grade: 'B', barrier: ['verify-af-continuous-chat-history'], evidence: 'never fork the sidebar' },
  { rule: 'R13.9', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-cross-round-carry'], evidence: 'never permanently burn an un-answered question' },
  { rule: 'R13.11', dim: 'af', weight: 3, grade: 'B', barrier: ['verify-af-probe-failure-not-a-verdict'], evidence: 'never turn our own outage into a statement about the data — mayAssertNothingToNarrow() only on a decided verdict' },
  { rule: 'R13.10', dim: 'af', weight: 3, grade: 'L', barrier: ['verify-af-offer-agreement'], evidence: 'CI agent-CTA 4/4: never offer a round that would have nothing to ask' },
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
  { rule: 'D4-every-af-platform-field-swept', dim: 'integrity', weight: 3, grade: 'P', barrier: [], evidence: 'GAP: only satel × air_conditioner was adjudicated this run. The full platform × AF-field source-fidelity sweep (Part 4) has never been run to completion in one run.' },
  { rule: 'D5-af-field-stuck-alert-adjudicated', dim: 'integrity', weight: 2, grade: 'P', barrier: [], evidence: 'alert af_field_stuck_no_variance still OPEN: the "source publishes no negative value" claim needs a live satel probe and satel.sa is unreachable from CI/agent containers' },
];


// ── §14 TRENDING (contracted 2026-08-28; was this routine's own T1-T12) ─────────────────────────
const S14: Entry[] = [
  { rule: 'R14.1.1', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-trending-carries-full-filter-state'], evidence: '2026-08-28: breakdown of the eligible set, not a cached popularity list — 6 AF states each produced a different city list' },
  { rule: 'R14.1.2', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-af-city-counts-carry-advanced'], evidence: '24/24 advertised = click-through across elevator, elevator+parking, bath>=3, furnished and a 3-way stack' },
  { rule: 'R14.1.3', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-af-count-params-carry-advanced'], evidence: 'جدة/الدمام/الخبر district rows under AF answers, 24/24 exact' },
  { rule: 'R14.2.1', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-district-counts-honest'], evidence: 'browser desktop+mobile UI = REQUEST = RPC (الرياض 37,492 · جدة 22,365 · الدمام 6,988 · الخبر 5,715)' },
  { rule: 'R14.2.2', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-trending-carries-full-filter-state'], evidence: 'counts recomputed per parameter set; not adversarially re-tested live this run' },
  { rule: 'R14.2.3', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-district-counts-honest'], evidence: 'a live per-row count fires for every row, not only the first 12' },
  { rule: 'R14.2.4', dim: 'trending', weight: 3, grade: 'L', barrier: ['verify-district-orthography-match'], evidence: '2026-08-28: جدة حي الصفا match_values=2 counted whole (42), matching the UI' },
  { rule: 'R14.3.1', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-district-counts-honest'], evidence: 'every widening fallback gated on "is the user narrowed"; live-proved 2026-08-23' },
  { rule: 'R14.3.2', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-district-counts-honest'], evidence: 'no count beats a false count; scope vs narrowed differ up to 116x (696 -> 6)' },
  { rule: 'R14.4.1', dim: 'trending', weight: 3, grade: 'B', barrier: ['verify-af-count-params-carry-advanced', 'verify-af-city-counts-carry-advanced'], evidence: 'rpcAllNarrowingParams is the single definition every count surface spreads' },
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
