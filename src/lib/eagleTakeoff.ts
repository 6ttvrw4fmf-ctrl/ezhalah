// The falcon that takes off from the falconer's hand plays on EVERY open and refresh of the home page (owner
// 2026-10-26: «make it whenever the user refresh»; it replaced the earlier once-per-session-every-6-hours rule).
// Reduced motion never shows it. This is the flight's own length (assets/images/falcon-takeoff.svg runs 2.8 s),
// plus a little room, after which the falcon is unmounted.
export const TAKEOFF_MS = 3000;
