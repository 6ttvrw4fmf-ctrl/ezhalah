// HOW THE SIGN-IN POPUP BEHAVES (owner 2026-08-28) — pure, so the barrier EXECUTES the rules.
//
// The old desktop SignInDock side card (2026-08-26) is gone. In its place the ONE existing
// AuthModal raises itself for signed-out web visitors on the Filter home and the Agent screen,
// and on desktop it can be dragged around by its header. Three rules, one file, no copies:
//
//   shouldAutoShowAuthPopup   WHEN the popup raises itself. Never for a signed-in user, never
//                             again this session once dismissed (closing it is respected — no
//                             re-pop on Filter↔Agent navigation), and never over the intro film.
//                             Every login/signup control still reopens it via openAuth().
//   canDragAuthPopup          WHERE dragging exists: desktop web only. Mobile keeps the plain
//                             centered responsive modal; native keeps its own presentation.
//   clampAuthPopupOffset      HOW FAR it can be dragged: the whole card stays on-screen.

export type AutoShowGate = {
  isWeb: boolean;
  /** The initial Supabase session restore has settled. NOT optional: during restore `user` is
   *  null, so `!user` alone flashes the popup at a LOGGED-IN visitor for a frame — the same trap
   *  GoogleOneTap and the old dock both document at their gates. */
  authChecked: boolean;
  user: unknown | null;
  /** True while the first-run intro film could still render (enabled AND not yet seen — see
   *  Shell's computation from IntroVideo.INTRO_ENABLED + store.introSeen). The popup (zIndex 200)
   *  must never cover the film (zIndex 100) — but when the intro is disabled (INTRO_SOURCE null,
   *  today's production state) it must never block the popup either: a brand-new visitor whose
   *  intro will simply never play IS the visitor this popup exists for. */
  introBlocking: boolean;
  /** Closed once this session (sessionStorage). Dismissal is respected until a fresh session. */
  dismissed: boolean;
  pathname: string;
};

export function shouldAutoShowAuthPopup(g: AutoShowGate): boolean {
  if (!g.isWeb) return false;        // native has its own auth entry points
  if (!g.authChecked) return false;  // session still restoring — say nothing yet
  if (g.user) return false;          // signed in: never
  if (g.introBlocking) return false; // the intro film goes first — never cover it
  if (g.dismissed) return false;     // closed once this session — respected
  return g.pathname === '/' || g.pathname === '/agent';  // Filter home and Agent only
}

/** Dragging is a desktop pointer affordance: web AND at/above DOCK_BREAKPOINT. Below it (mobile
 *  web) and on native the popup is the plain centered modal with no drag machinery at all. */
export function canDragAuthPopup(g: { isWeb: boolean; docked: boolean }): boolean {
  return g.isWeb && g.docked;
}

/** Margin the card keeps from every viewport edge while dragged. */
export const AUTH_POPUP_EDGE = 16;

// ── THE AUTH EPOCH (owner 2026-08-29) ───────────────────────────────────────────────────────────
// «NOT AUTHENTICATED = the popup must be ELIGIBLE to appear. Do not key it off whether the user
// previously had an account, deleted one, dismissed the popup before, or was previously signed in.»
//
// A dismissal is scoped to ONE CONTINUOUS LOGGED-OUT EPOCH — the stretch where this visitor stays
// signed out. Closing the popup is still respected inside that stretch (no re-pop nag on
// Filter↔Agent navigation), but ANY auth transition ends the epoch and voids the dismissal:
//   sign-IN   the close that follows a successful login stamped the flag while SIGNED IN; it says
//             nothing about the logged-out visitor this browser may hold later.
//   sign-OUT / account DELETION / session death
//             the person now in front of the app is a NEW logged-out visitor and must land in the
//             exact same state as any fresh guest — popup eligible, sidebar CTA present.
// THE BUG THIS ENCODES (reproduced on production 2026-08-29): sign in through the popup (close →
// dismissed=1) → delete the account → the stale flag suppressed the popup for the now-logged-out
// visitor, and nothing on screen offered auth except the small bottom-of-sidebar CTA. Deleting an
// account must end in the canonical logged-out state; it ended in a dead one.
//
// Store.tsx owns the ONE writer: an effect on the signed-in boolean calls this on every change and
// clears AUTH_POPUP_DISMISSED_KEY when it returns false. Pure so the barrier executes it.
export function dismissalOutlivesTransition(prevSignedIn: boolean, nowSignedIn: boolean): boolean {
  return prevSignedIn === nowSignedIn;   // no transition → same epoch → the dismissal stands
}

/** sessionStorage keys: the session's memory of a dismissal and of a moved position. */
export const AUTH_POPUP_DISMISSED_KEY = 'ezhalah.authPopup.dismissed';
export const AUTH_POPUP_POS_KEY = 'ezhalah.authPopup.pos';

/**
 * Clamp a drag offset so the WHOLE card stays on-screen with AUTH_POPUP_EDGE margin. `base` is
 * the card's untranslated rect (where flex centering put it); the returned offset satisfies
 * EDGE ≤ base.left+x and base.left+x+width ≤ vp.w−EDGE (same for y). If the card is LARGER than
 * the viewport the range inverts — Math.max(min, max) then prefers the LOW bound, pinning the
 * card's top-left (where the grab strip lives) on-screen so it can always be dragged back.
 */
export function clampAuthPopupOffset(
  off: { x: number; y: number },
  base: { left: number; top: number; width: number; height: number },
  vp: { w: number; h: number },
): { x: number; y: number } {
  const axis = (v: number, start: number, size: number, span: number) => {
    const min = AUTH_POPUP_EDGE - start;
    const max = span - AUTH_POPUP_EDGE - size - start;
    return Math.min(Math.max(v, min), Math.max(min, max));
  };
  return { x: axis(off.x, base.left, base.width, vp.w), y: axis(off.y, base.top, base.height, vp.h) };
}
