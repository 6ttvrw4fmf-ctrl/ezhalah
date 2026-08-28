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
  /** store.introSeen: null = flag still being read, false = intro pending/playing, true = done.
   *  Only `true` may show — the popup (zIndex 200) must never cover the intro film (zIndex 100). */
  introSeen: boolean | null;
  /** Closed once this session (sessionStorage). Dismissal is respected until a fresh session. */
  dismissed: boolean;
  pathname: string;
};

export function shouldAutoShowAuthPopup(g: AutoShowGate): boolean {
  if (!g.isWeb) return false;        // native has its own auth entry points
  if (!g.authChecked) return false;  // session still restoring — say nothing yet
  if (g.user) return false;          // signed in: never
  if (g.introSeen !== true) return false;  // intro undecided or playing — it goes first
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
