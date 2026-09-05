// WHETHER A RESULTS TURN MAY SHOW ITS CLOSING NOTE AND ITS ACTIONS ROW.
//
// The actions row is where «عرض المزيد» lives. agent.tsx used to decide this inline with:
//
//     if ((m.typing && !doneTyping[m.id]) || shown < initialReveal(m.result)) return null;
//
// The first clause is right and is kept: while the intro is still typing, the turn has not finished
// arriving and a closing note under it would be premature.
//
// THE SECOND CLAUSE COULD STRAND A USER PERMANENTLY (ops_incident #66). It withholds the whole block
// until the card cascade has revealed `initialReveal` cards — but a cascade is not guaranteed to get
// there. dripRange() in agent.tsx carries an ownership guard:
//
//     // if a newer drip (new turn) or finalize/stop took over the shared active-ref, this cascade
//     // stops silently … Unrevealed cards stay recoverable behind «عرض المزيد» (bufferMore).
//     if (revealActiveRef.current?.id !== id) return;
//
// That recovery claim cannot come true. «عرض المزيد» is rendered INSIDE the block the unfinished
// cascade suppresses, so a halt below the target hides the very control the comment offers as the
// way out. Two separate comments in agent.tsx promise this recovery; neither could happen.
//
// Measured on production 2026-09-05, الرياض/شقة/بيع + one AF answer landing 6,723 matches: 20 cards
// on screen, all four ageFlow phases absent (so the AF browsing gate is not involved), 1 committed
// pill, and ZERO `[data-testid="results-load-more"]` elements anywhere in the DOM. The user is
// stranded at 20 of 6,723 with no way to continue — which Product Contract §6.5 forbids in the
// clearest terms it uses anywhere: "AF stops at 80. Offer button HIDDEN. Only «عرض المزيد» remains.
// This is CORRECT."
//
// THE RULE, and why it is the conservative repair rather than simply deleting the clause:
// the sequencing the clause exists for is real — the closing note should not appear above cards that
// are still arriving. So the block is withheld only while THIS turn's cascade is genuinely still
// running. A cascade that has STOPPED (finished, or silently halted because it lost ownership) can
// no longer be waited for, and waiting forever is what strands the user.
//
// This predicate is a STRICT WIDENING of the old one: everything the old gate showed, this shows.
// It can only ever reveal a row that used to be hidden, never hide one that used to render — which
// is what makes it safe to put in front of a surface as load-bearing as the results turn, and it is
// asserted as a property (over the whole input space) rather than as a handful of examples.
export type ResultsRowState = {
  /** `m.typing && !doneTyping[m.id]` — the intro text is still typing itself out. */
  introStillTyping: boolean;
  /** Cards currently revealed for this turn (`revealCount[m.id]`). */
  shown: number;
  /** This page's reveal target — `initialReveal(m.result)`. */
  initialReveal: number;
  /** This turn's cascade has been kicked off at least once (`dripStartedRef.current[m.id]`). */
  cascadeStarted: boolean;
  /** The shared cascade is running AND still owned by this turn
   *  (`revealing && revealActiveRef.current?.id === m.id`). */
  cascadeRunningForThisTurn: boolean;
};

/**
 * May this results turn render its closing note and actions row (which contains «عرض المزيد»)?
 *
 * Order matters and each branch is a separate reason:
 *   1. still typing            → no. The turn has not finished arriving.
 *   2. reveal target reached   → yes. The normal, overwhelmingly common path.
 *   3. cascade not started yet → no. It is about to; this is a frame or two, not a stranding.
 *   4. otherwise               → yes. The cascade started and is no longer running here, so it has
 *                                stopped below target and will never reach it. Withholding now would
 *                                be permanent, and a permanent withholding of the ONLY control that
 *                                can reach the rest of the set is the defect this exists to prevent.
 */
export function resultsRowIsReady(s: ResultsRowState): boolean {
  if (s.introStillTyping) return false;
  if (s.shown >= s.initialReveal) return true;
  if (!s.cascadeStarted) return false;
  return !s.cascadeRunningForThisTurn;
}

/** The predicate agent.tsx used before ops_incident #66 — kept so the widening can be proven. */
export function resultsRowWasReady_pre66(s: ResultsRowState): boolean {
  return !s.introStillTyping && s.shown >= s.initialReveal;
}
