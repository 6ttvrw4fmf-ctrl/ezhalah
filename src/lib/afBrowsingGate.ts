// WHEN THE ADVANCED FILTER INTERVIEW OWNS THE MOMENT, AND WHEN IT HANDS BROWSING BACK.
//
// OWNER RULE (2026-09-05), settling the tension this file is named after:
//
//   1. While the Advanced Filter interview is still ACTIVE and there are still useful certified
//      questions available, do NOT show the normal «عرض المزيد» pager yet. Keep narrowing with new
//      truthful questions that were not already asked.
//   2. Once the interview is actually FINISHED, normal browsing/pagination resumes if needed.
//   3. Once the result set reaches the final small-result threshold, the flow FINISHES CLEANLY
//      instead of asking the user to keep browsing or narrowing forever.
//   4. Counts are never changed and results are never widened. MATCH FIRST, always.
//
// WHY THIS IS A MODULE AND NOT AN INLINE `!ageFlow`. The gate was literally `!ageFlow`, which
// happened to satisfy clause 1 for every phase that exists today — but only by accident, because
// every reachable phase currently has (or is about to have) a question. Nothing tied the gate to
// question availability, so a phase added tomorrow, or an interview left open in a dead state,
// would withhold the pager from a user with thousands of matches and no way to reach them. That is
// precisely the ceiling the owner removed on 2026-08-29, coming back through a side door.
//
// It is worse than it sounds, because on 2026-09-05 the live sweep's «عرض المزيد» journey was taught
// to STAND DOWN whenever the AF card is open (before that it reported the intended behaviour as a
// PAGER-MISSING defect). So the one layer that drives the real browser and would have noticed a
// stuck-open interview was, from that moment, blind to it. A rule this load-bearing has to be stated
// where it can be executed and mutation-proven, not inferred from a truthy check on a state object.
//
// EXHAUSTIVE BY CONSTRUCTION. `AfPhase` is the union of the interview's own phases. The switch below
// has no `default:`, so TypeScript fails the build if a new phase is added without deciding — the
// decision becomes deliberate instead of inheriting "withhold" from a truthiness test.
//
// WHAT THIS DOES NOT DO: it does not touch the eligible set, any count, any predicate, or any
// ordering. It decides ONLY whether the results turn's action row is rendered right now. Clause 4 is
// therefore satisfied structurally — there is no search input on this path to widen.

/** The Advanced Filter interview's phases, mirroring the `ageFlow` union in src/app/agent.tsx. */
export type AfPhase = 'loading' | 'intro' | 'asking' | 'mining';

/**
 * Does the Advanced Filter interview currently own browsing — i.e. must the «عرض المزيد» /
 * «خلّنا نحدد الطلب أكثر» row stay hidden?
 *
 * `null` means no interview is open: the interview is FINISHED (or never started) and browsing
 * belongs to the user again — clause 2.
 */
export function afInterviewOwnsBrowsing(phase: AfPhase | null): boolean {
  if (phase === null) return false;          // clause 2 — finished, hand browsing back
  switch (phase) {
    // A question is on screen right now. Clause 1 in its purest form, and the original 2026-08-21
    // reason still holds underneath it: the AF card is an ABSOLUTE OVERLAY, so a row rendered here
    // would sit unreachable beneath it — visible to the DOM, untappable by the user.
    case 'asking':
      return true;
    // The invitation card. It is only ever opened on a cohort the plan already proved has qualifying
    // questions ("never open an empty card — on BOTH verdicts", startAgeFlow), so a useful question
    // IS available; the user simply has not begun yet. Also an overlay.
    case 'intro':
      return true;
    // The plan is still resolving. Question availability is UNKNOWN, not known-absent — and an
    // unknown must never harden into a claim in either direction (the repo's standing
    // silent→NULL/never unknown→NO rule). Withholding for the moment it takes to resolve is the
    // conservative half: it cannot strand a user, because `loading` always resolves — to `asking`
    // when a question qualifies, or to `null` when none does, which immediately restores the row.
    case 'loading':
      return true;
    // The interview is over and its FINAL search is running behind the deep-search card. Browsing has
    // not resumed yet only because the results it would page are still being fetched; the card is an
    // overlay, and `mining` is latched to `null` on every exit path (success, empty, throw, and a
    // 15s backstop). Rendering a pager against the OLD turn here would page a set the user has
    // already moved past.
    case 'mining':
      return true;
  }
}

/**
 * Clause 3, as a predicate over the honest total: at or below the small-result threshold the flow is
 * FINISHED — there is nothing left to page and nothing truthful left to ask, so the user is never
 * invited to keep going.
 *
 * This does not re-implement the reveal or the counts; `initialRevealPure` already reveals the whole
 * set at this threshold (so `resultCounts` reports `hasMore: false` on its own) and
 * `canNarrowFurther` already requires `> stopAt`. It states the shared line those two independently
 * obey, so a barrier can prove they still agree rather than trusting that they do.
 *
 * `honestTotal` is `null` whenever the total would overstate (client-only narrowing, agent-annualised
 * budgets). An unknown total is NOT a small one: it returns false and the normal paths apply.
 */
export function searchIsFinishedAtThreshold(honestTotal: number | null, stopAt: number): boolean {
  return honestTotal != null && honestTotal <= stopAt;
}
