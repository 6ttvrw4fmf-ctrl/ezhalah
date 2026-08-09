// Run a user-awaited hand-off (navigate, dismiss an overlay, …) once an animation has played —
// WITHOUT ever letting the animation be the only thing that can trigger it.
//
// WHY THIS EXISTS (real production bug, 2026-08-07 — owner: "I press بحث and nothing happens").
// On React Native Web `useNativeDriver` is a no-op: Animated is driven by requestAnimationFrame, and
// browsers SUSPEND rAF for a backgrounded tab, a minimised window, or under OS power throttling. An
// animation started in that state never completes, so a hand-off written as
//
//     Animated.timing(...).start(() => router.push(...))
//
// simply never happens — no navigation, no error, no spinner. Reproduced live with rAF frozen: the
// Search press registered and the app was still sitting on `/` ten seconds later.
//
// The rule this encodes: THE ANIMATION IS DECORATION, THE HAND-OFF IS THE FUNCTION. Play the
// animation, but drive the hand-off from a timer too. setTimeout is CLAMPED in background tabs
// (~1s) but still RUNS; rAF is suspended outright. Whichever path gets there first wins, and the
// latch makes the other a no-op — so the hand-off happens exactly once, never twice.
export function runAfterAnimation(
  /** Starts the animation. Call the supplied callback on completion (i.e. pass it to `.start()`). */
  play: (onFinished: () => void) => void,
  /** The thing the user is actually waiting for. Guaranteed to run exactly once. */
  handOff: () => void,
  /** Fallback delay. Use a hair more than the animation duration so the visual normally wins. */
  fallbackMs: number,
  /** Injectable timer — tests pass a synchronous stub; production uses setTimeout. */
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    handOff();
  };
  play(once);
  schedule(once, fallbackMs); // fires even when rAF — and therefore the animation — is frozen
}
