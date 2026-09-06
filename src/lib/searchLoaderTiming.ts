// THE SEARCHING BEAT'S TIMING CONTRACT — one home, pure, executable by a barrier.
//
// OWNER, 2026-09-06: "when user uses the filter the animation pops up, let the user wait 10 seconds
// ok, and make sure all the platforms in the animation show clearly ok, cuz doing it quick will make
// them lost."
//
// The platform roster is the product's primary trust signal — it is where a user learns Ezhalah
// searches the WHOLE Saudi market instead of one site. For that to land, two things must finish
// before the loader is allowed to leave:
//
//   REVEAL — every pill has faded in           (roster−1) × PILL_STAGGER + PILL_FADE
//   SWEEP  — every pill has been HIGHLIGHTED    one full pass of the travelling wave
//
// and the searching floor (agent.tsx SEARCH_MIN_MS) must cover REVEAL + SWEEP.
//
// This lives in lib/ rather than inside SearchLoader.tsx for the same reason lib/responsive.ts holds
// the breakpoints: a `.tsx` module cannot be imported by a plain Node barrier (JSX), so a contract
// that only exists inside the component can only ever be GREPPED. Here it is arithmetic that
// scripts/verify-search-loader-shows-every-platform.ts EXECUTES against the shipped numbers.
//
// Before 2026-09-06 the floor was 2,200ms and the sweep 3,600ms — the wave could not complete even
// once, so the platforms at the end of the roster were never lit on a fast query. That is the defect
// the owner reported, and `everyPlatformSeen(2200, …)` is false, which is how the barrier proves it.

/** Fade-in stagger between consecutive pills (owner v4 range 60–100ms). */
export const PILL_STAGGER = 60;
/** One pill's own fade-in duration. */
export const PILL_FADE = 260;
/**
 * The largest roster the reveal budget is sized for. Kept ≥ the real catalogue by the barrier, so a
 * newly onboarded platform can never quietly push the tail of the reveal past the floor.
 *
 * 40 → 50 on 2026-09-06: abwbna's onboarding took the real catalogue to 41, past the old ceiling —
 * caught by this barrier, not by review. Raised with real headroom (the 40-candidate audit still
 * has several platforms queued) instead of bumping it one-at-a-time on every onboarding; SEARCH_MIN_MS
 * (agent.tsx) raised alongside it so REVEAL + SWEEP still lands inside the floor.
 */
export const MAX_ROSTER = 50;
/** Every pill is on screen by this point, worst case. */
export const LOADER_REVEAL_MS = (MAX_ROSTER - 1) * PILL_STAGGER + PILL_FADE;
/**
 * One complete pass of the travelling highlight. Deliberately slow: at the current 38-platform
 * roster this is ~195ms per pill (each lit ~940ms, several glowing at once) so the wave reads as a
 * wave and every platform gets a moment that can actually be seen. "Doing it quick will make them
 * lost."
 *
 * Sized so REVEAL + SWEEP lands exactly on the owner's ten seconds: 2,600 + 7,400 = 10,000ms. The
 * first draft used 7,600 and overran by 200ms — caught by the barrier, not by review, which is the
 * whole reason this arithmetic is executable rather than a comment.
 */
export const LOADER_SWEEP_MS = 7400;

/** How long one pill waits before the wave reaches it. Never faster than a readable step. */
export function highlightStepMs(roster: number): number {
  return Math.max(180, Math.round(LOADER_SWEEP_MS / Math.max(1, roster)));
}

/**
 * THE CONTRACT: has every platform both appeared AND been highlighted before the loader may exit?
 * `floorMs` is agent.tsx's SEARCH_MIN_MS — the minimum time the searching beat stays on screen.
 */
export function everyPlatformSeen(floorMs: number, roster: number): boolean {
  const reveal = Math.max(0, roster - 1) * PILL_STAGGER + PILL_FADE;
  return reveal <= LOADER_REVEAL_MS && floorMs >= LOADER_REVEAL_MS + LOADER_SWEEP_MS;
}
