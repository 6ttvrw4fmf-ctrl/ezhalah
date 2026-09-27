// THE HAND-OFF IS BOUNDED PER RENDERED TURN, NEVER PER TEXT REVISION.
//
// WHY THIS EXISTS (measured 2026-09-23, routine #4; closes the third root-cause part of
// ops_incident #347 and the open half of #339/#337).
//
// `runTypewriter` (src/app/agent.tsx) already carries a bounded anti-starvation ceiling, and
// scripts/verify-typewriter-completion-guarantee.ts proves it fires: even when the interval is
// TOTALLY starved, `onDone` is forced through within max(4000, expectedMs*3) ms. That proof is
// correct — and it is a proof about ONE uninterrupted reveal, which is not the guarantee the
// product needs.
//
// `Typer`/`BrandReveal` re-run their effect on every `text` change, and the effect's cleanup clears
// the ceiling along with the interval. So a text that changes faster than the ceiling restarts the
// countdown every time and `onDone` NEVER fires. Executed against the real lifted `runTypewriter`
// driven exactly as the component drives it (cleanup → re-invoke) under a starved interval:
//
//     1000 ms text churn, 90 s:   onDone fired 0 times,  0 of 35 glyphs revealed
//     churn stops, +10 s:         onDone fired 1 time,  35 of 35 glyphs revealed
//
// 90 s of nothing is exactly what ops_incident #347 measured on production ("neither the interval
// nor the 4 s onDone fallback ever commits, for 90 s+"), and it is why that incident's own list of
// root-cause parts ends with one nobody had fixed: "runTypewriter final finish() never commits
// under 500-card render starvation". It commits fine; it is never allowed to.
//
// WHAT THE USER LOSES WHILE IT IS PENDING. `onDone` sets `doneTyping[m.id]`, which gates the
// results actions row through `resultsRowIsReady()` — «عرض المزيد», the AF "narrow it down" button,
// the feedback row and Read Aloud. So a churning sentence withholds the ONLY control that reaches
// the rest of the result set, on top of leaving a half-written Arabic sentence on screen (§42, the
// visible output contract: «أبشر طلع لنا 6,499» with no «نتيجة»).
//
// THE TEXT REALLY DOES CHURN. `introText` is `pickResultsFoundSentence({ count, name, ... })`:
// the count changes as a turn's total is revised, the name arrives when auth hydrates after first
// render, and `primeResultsFound()` can widen the pool mid-session. PR #3232's `stableKey: m.id`
// pin removed ONE churn source (the ~40 Hz re-pick); it did not, and could not, make the ceiling
// survive the others. Pinning every future caller is a whack-a-mole this module ends instead: the
// hand-off is armed once per mount and no `text` change can postpone it.
//
// This NEVER shortens or weakens the existing guarantee — it is strictly an upper bound added on
// top. The animation is still driven entirely by `runTypewriter`; this only guarantees that the
// hand-off it owes the rest of the UI is actually paid.

/** Injectable timers, so a barrier can execute this against a fake clock instead of real time. */
export type HandoffTimers = {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

const REAL_TIMERS: HandoffTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * The absolute ceiling for one rendered turn's hand-off.
 *
 * Deliberately the SAME 4000 ms floor `runTypewriter` already uses, so this bound is never looser
 * than the one the existing barrier certifies for a single uninterrupted reveal. A natural intro
 * sentence needs well under a second of TYPE_TICK_MS-paced reveal, so under healthy rendering the
 * animation always wins the race and this never fires.
 */
export const HANDOFF_CEILING_MS = 4000;

export type RevealHandoff = {
  /**
   * Start the one absolute ceiling for this mount. Call once, from a mount-only effect — never from
   * an effect keyed on `text`, which is the whole defect this module exists to remove.
   * Returns the cleanup that disarms it.
   */
  arm: (onCeiling: () => void) => () => void;
  /** The reveal finished on its own (or the ceiling already fired). Idempotent. */
  settle: () => void;
  /** True once the hand-off has been paid, by either route. */
  isSettled: () => boolean;
};

/**
 * One hand-off latch per mounted reveal.
 *
 * The latch is what makes this safe to combine with `runTypewriter`'s own completion: whichever
 * route arrives first pays the hand-off, and the other becomes a no-op. `onDone` can therefore
 * never fire twice for one mount, and can never fail to fire at all.
 */
export function createRevealHandoff(
  ceilingMs: number = HANDOFF_CEILING_MS,
  timers: HandoffTimers = REAL_TIMERS,
): RevealHandoff {
  let settled = false;
  return {
    arm(onCeiling) {
      const id = timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        onCeiling();
      }, ceilingMs);
      return () => timers.clearTimeout(id);
    },
    settle() { settled = true; },
    isSettled() { return settled; },
  };
}
