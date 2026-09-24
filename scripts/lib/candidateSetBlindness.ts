// THE JUDGEMENT SHARED BY BOTH HALVES OF THE CANDIDATE-SET GUARD (ops_incident #391, routine #10).
//
// THE CLASS. A detector whose CANDIDATE SET is filtered before its predicate ever runs is blind to a
// whole class BY CONSTRUCTION, and reads as a clean bill of health. The predicate is correct; the
// WHERE that chooses what the predicate is applied to silently excludes a class; nothing is ever
// wrong, because nothing in that class is ever looked at. It is distinct from every shape this
// routine already ratchets: the check is not asserting text, not asserting the defect, not supplying
// its own input, and it may even carry mutation proofs — the mutants just never live in the excluded
// class.
//
// THE INSTANCE. mon_detect_unresolvable_detector() applies its predicate only to detectors whose
// source matches `mon_raise`. Measured 2026-09-22 and 2026-09-23: 239 of 239 mon_detect_* functions
// are inside that set, so it excludes ZERO today. It is ONE refactor away from excluding some — a
// detector that raises through a wrapper whose name lacks the literal text `mon_raise` leaves the
// population silently, and the check keeps reading clean.
//
// This file holds ONLY the judgement, so the hermetic half can mutation-prove the exact function
// that decides production's verdict rather than a copy of it. The membership filter itself is NOT
// duplicated here — it lives once, in the database, as mon_detector_raises(text), and both
// mon_detect_unresolvable_detector() and mon_detectors_outside_raise_candidate_set() call it.

/** A synthetic detector source injected through the live filter, exactly as production stores one. */
export type InjectedSource = { name: string; src: string };

/**
 * A source that raises through a WRAPPER. This is the refactor the guard exists to catch: it is a
 * perfectly reasonable detector, it really does open alerts, and the literal text `mon_raise` does
 * not appear in it — so it falls OUT of the candidate set and nothing looks at it again.
 */
export const WRAPPER_RAISER: InjectedSource = {
  name: 'mon_detect_zz_candidate_set_probe_via_wrapper',
  src: "begin perform public.ops_alert('P2','probe','all','probe','{}'::jsonb); return 1; end",
};

/** The control: an ordinary detector that raises directly, therefore INSIDE the candidate set. */
export const DIRECT_RAISER: InjectedSource = {
  name: 'mon_detect_zz_candidate_set_probe_direct',
  src: "begin return public.mon_raise('P2','probe','all','probe','{}'::jsonb); end",
};

export type CandidateSetAnswers = {
  /** mon_detectors_outside_raise_candidate_set() — the standing verdict over the real population. */
  bare: string[];
  /** …(array[WRAPPER_RAISER]) — must report the wrapper-raiser. */
  withWrapperRaiser: string[];
  /** …(array[DIRECT_RAISER]) — must NOT report the direct raiser. */
  withDirectRaiser: string[];
};

/**
 * Returns one line per way the live guard has stopped being able to tell "inside the candidate set"
 * from "outside it". Empty means healthy.
 *
 * Note the direction of each test. (1) is the guard's whole reason to exist. (2) is the negative
 * control without which a guard that flagged EVERYTHING would satisfy (1) and be just as useless.
 * (3) is the standing production verdict, and it is a real finding rather than noise: a detector
 * outside the candidate set is a detector mon_detect_unresolvable_detector() will never examine
 * again, silently, forever.
 */
export function candidateSetBlindness(a: CandidateSetAnswers): string[] {
  const blind: string[] = [];

  if (!a.withWrapperRaiser.includes(WRAPPER_RAISER.name)) {
    blind.push(
      `an injected detector that raises through a WRAPPER (${WRAPPER_RAISER.name}) was not reported ` +
        'as outside the candidate set. mon_detectors_outside_raise_candidate_set() can no longer see ' +
        'the departure it exists to notice, so every claim that the unresolvable-detector check ' +
        'covers the whole fleet is unbacked',
    );
  }

  if (a.withDirectRaiser.includes(DIRECT_RAISER.name)) {
    blind.push(
      `${DIRECT_RAISER.name} raises directly and was still reported as OUTSIDE the candidate set. ` +
        'Either the filter now flags everything — which satisfies the positive half and is just as ' +
        'useless — or mon_detector_raises() has stopped matching the real raise call',
    );
  }

  if (a.bare.length > 0) {
    blind.push(
      `${a.bare.length} detector(s) are OUTSIDE the raise candidate set, so ` +
        'mon_detect_unresolvable_detector() never examines them and they can open an alert that is ' +
        `never closed without anything noticing: ${a.bare.join(', ')}. Either route the raise back ` +
        'through mon_raise, or widen mon_detector_raises(text) — the ONE definition of the filter — ' +
        'so the new shape is inside the population. Never widen it by exempting the detector',
    );
  }

  return blind;
}
