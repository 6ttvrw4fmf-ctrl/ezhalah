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
 * The largest roster the SEARCHING FLOOR can serve — i.e. the biggest catalogue for which every pill
 * is still both on screen and lit before the loader is allowed to leave. Kept ≥ the real catalogue by
 * the barrier, so onboarding a platform can never quietly push the tail of the wave past the floor.
 *
 * 40 → 50 on 2026-09-06 (abwbna's onboarding took the catalogue to 41, past the old ceiling).
 *
 * 56 → 112 on 2026-09-20, when seven small platforms took the catalogue to 59. Not a nudge: the
 * wave now lights PILL_GROUP pills per step (owner decision — see PILL_GROUP), which halves the
 * tail's wait, so the honest ceiling of the SAME 10,600ms floor moved. Derived exactly as before,
 * and the grouping is why it lands on an even number: pills 111 and 112 share a step, both lit at
 * 10,460ms, while a 113th would start a new step and not be lit until 10,640ms.
 *
 * 112 → 168 on 2026-09-25 with PILL_GROUP 2 → 3, and derived the same way against the SAME floor:
 * pills 166/167/168 share the 56th step and are lit at floor(167/3) x 180 + 560 = 10,580ms, while a
 * 169th starts a new step and waits 10,760ms. The reveal side is not what binds — a 168-roster has
 * faded in by 167 x 60 + 260 = 10,280ms — which is why this number comes off the SWEEP.
 *
 * 50 → 56 on 2026-09-19, when the ksaaqar / sadiqeltajer / toor logos took the catalogue to 52 and
 * this barrier failed. Investigating that failure showed the ceiling had been computed from a model
 * that did not match the animation (see everyPlatformSeen below): the OLD arithmetic added REVEAL and
 * SWEEP as if they ran back to back, when both start at mount and overlap, and it used the nominal
 * LOADER_SWEEP_MS even where highlightStepMs()'s 180ms readable-step floor overrides it — which it
 * has done for every roster above 41. 56 is now derived, not guessed: at PILL_STAGGER 60 / step 180
 * the last pill of a 56-roster is lit at 10,460ms, and of a 57-roster at 10,640ms — past the 10,600ms
 * floor. So 56 is the real ceiling of the owner's ten seconds, and platform #57 needs a decision
 * (a longer floor, or a wave that lights more than one pill per step) rather than a nudged constant.
 */
export const MAX_ROSTER = 168;
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

/**
 * The travelling highlight's own envelope. These live here rather than in SearchLoader.tsx because
 * everyPlatformSeen() is arithmetic OVER them: a pill only counts as seen once it has risen and been
 * held lit, and a copy of these numbers inside the component would divorce the animation from the
 * floor this contract checks — the exact way the sweep and the floor drifted apart before.
 */
export const WAVE_RISE = 300;
export const WAVE_HOLD = 260;
export const WAVE_FALL = 380;
/** A pill counts as SEEN once the wave has risen on it and held it lit. */
export const WAVE_LIT_MS = WAVE_RISE + WAVE_HOLD;

/**
 * How many pills the travelling wave lights AT ONCE.
 *
 * OWNER DECISION 2026-09-19. The wave used to light exactly one pill per step, so the tail's wait
 * was (roster−1) × 180ms and the catalogue could not grow past 56 without either breaking the
 * owner's ten seconds or leaving the last platforms unlit. Offered the choice, the owner kept the
 * ten seconds and took the wider wave: "2 pills at a time".
 *
 * Each pill is still lit for its full WAVE_RISE + WAVE_HOLD + WAVE_FALL (940ms) — the wave gets
 * WIDER, not faster, so no platform gets less time on screen than before. What changes is that the
 * front of the wave advances several pills per step instead of one, which cuts the tail's wait and
 * lifts the ceiling at the same 10,600ms floor.
 *
 * 2 -> 3 on 2026-09-25, and this REVISES the owner's own "2 pills at a time" from 2026-09-19, so it
 * is flagged rather than buried. The wave-1 ten took the catalogue to 116 and the tail stopped
 * fitting: lastPillLitMs(116) = floor(115/2) x 180 + 560 = 10,820ms against a 10,600ms floor, so the
 * last two platforms would never have been lit — the exact defect the owner reported in the first
 * place. The two honest levers were a wider wave or a longer wait, and the owner's words pin which
 * one: "let the user wait 10 seconds ... doing it quick will make them lost". A wider wave keeps BOTH
 * halves of that — the ten seconds, and 940ms of light per pill, unchanged. A longer wait would break
 * the first half for every search. Nothing is quicker; three pills simply share a step.
 * At 3 the honest ceiling is 168 platforms, which also covers the 27 sites still to build.
 */
export const PILL_GROUP = 3;

/** When the wave reaches pill `index` — pills share a step in groups of PILL_GROUP. */
export function waveDelayMs(index: number, step: number): number {
  return Math.floor(Math.max(0, index) / PILL_GROUP) * step;
}

/** How long one pill waits before the wave reaches it. Never faster than a readable step. */
export function highlightStepMs(roster: number): number {
  return Math.max(180, Math.round(LOADER_SWEEP_MS / Math.max(1, roster)));
}

/** When the LAST pill has finished fading in, measured from the loader's mount. */
export function lastPillAppearedMs(roster: number): number {
  return Math.max(0, roster - 1) * PILL_STAGGER + PILL_FADE;
}
/**
 * When the LAST pill has been lit, measured from the loader's mount.
 *
 * The wave delays pill `i` by `i × highlightStepMs(roster)` — so the tail's wait grows with the
 * roster whenever the 180ms readable-step floor binds, and the nominal LOADER_SWEEP_MS stops being
 * the sweep's real length. Above 41 platforms the floor always binds, which is why this is computed
 * from the shipped step function instead of from that constant.
 */
export function lastPillLitMs(roster: number): number {
  return waveDelayMs(Math.max(0, roster - 1), highlightStepMs(roster)) + WAVE_LIT_MS;
}

/**
 * THE CONTRACT: has every platform both appeared AND been highlighted before the loader may exit?
 * `floorMs` is agent.tsx's SEARCH_MIN_MS — the minimum time the searching beat stays on screen.
 *
 * Both phases start at mount and run CONCURRENTLY, so the deadline is the later of the two, never
 * their sum. (Until 2026-09-19 this added them and compared against a nominal sweep the step floor
 * had already overridden — wrong in both directions at once. scripts/verify-search-loader-shows-
 * every-platform.ts now mutation-proofs against that exact model.)
 */
export function everyPlatformSeen(floorMs: number, roster: number): boolean {
  return roster <= MAX_ROSTER
    && floorMs >= Math.max(lastPillAppearedMs(roster), lastPillLitMs(roster));
}
