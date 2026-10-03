// "A SEARCH WAS RUN SINCE THE FILTER WAS LAST ON SCREEN" — one bit shared by the results screen and
// the Filter home (owner 2026-10-03: going back to the Filter always opens a clean form).
//
// The results screen raises it as soon as it holds a search; the Filter home takes it (read-and-clear)
// when it comes back into focus and, only if it was raised, wipes its form. A bare "reset on every
// focus" would also fire on the first focus after load and wipe a user who had already started to
// tap, and would empty a half-filled form on a mere Filter ⇄ AI-agent toggle. Zero dependencies and
// module-level on purpose: both screens are mounted by the router, not by each other, and a store
// field would re-render every consumer for a flag nothing renders.
let pending = false;

export const markSearchLeftBehind = (): void => { pending = true; };

export const takeSearchLeftBehind = (): boolean => {
  const was = pending;
  pending = false;
  return was;
};
