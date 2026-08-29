// HOW THE SIGN-IN SURFACES BEHAVE (owner 2026-08-29 revision) — pure, so barriers EXECUTE the rules.
//
// The large AUTO-SHOWING popup (owner 2026-08-28, PR #1205) was RETIRED by the owner's next-day
// revision: «i dont want this popup to show, i want it small where the user can drag and move
// around in the filter and ai agent, it goes away once the user sends something, put it in the
// side.» So there are now two PRESENTATIONS of the ONE auth UI (AuthModal.tsx's AuthForm — never
// a second auth system):
//
//   SignInCard   the UNPROMPTED surface: a small draggable glass card for signed-out desktop-web
//                visitors on the Filter home and the Agent screen, default-docked at the side
//                slot the retired 2026-08-26 SignInDock owned (owner-approved placement). The
//                full compact login lives inside it. shouldShowSignInCard decides WHEN it exists.
//   AuthModal    the ON-DEMAND surface: the centered large popup, opened ONLY by explicit sign-in
//                controls (sidebar CTA, top-bar pills, One Tap fallbacks) via openAuth(). It
//                never raises itself anymore — deliberate intent gets the full modal.
//
//   canDragAuthPopup             WHERE dragging exists: desktop web only (both surfaces).
//   clampAuthPopupOffset         HOW FAR either surface drags: fully on-screen, EDGE margin.
//   dismissalOutlivesTransition  the auth-epoch rule (#1214), retargeted to the card's flag.

export type SignInCardGate = {
  isWeb: boolean;
  /** Desktop web only — at/above DOCK_BREAKPOINT. Mobile keeps the top-bar sign-in pill and the
   *  sidebar CTA, both opening the centered modal on demand (the retired dock's own precedent). */
  docked: boolean;
  /** The initial Supabase session restore has settled. NOT optional: during restore `user` is
   *  null, so `!user` alone flashes the card at a LOGGED-IN visitor for a frame — the same trap
   *  GoogleOneTap and the retired dock both document at their gates. */
  authChecked: boolean;
  user: unknown | null;
  /** IN-MEMORY ONLY (store state, never persisted): true once this LOAD's visitor SENT something
   *  (a Filter search submit, an Agent message — voice included) or closed the card with its X.
   *  A page refresh resets it by construction — exactly the owner's return rule («when the user
   *  refresh» the card comes back). An auth transition also clears it (#1214 epoch, below). */
  dismissed: boolean;
  /** MUTUAL EXCLUSION (owner, locked spec): while the centered AuthModal is open (an explicit
   *  login click), the card is SUPPRESSED — never both on top of each other. Closing the modal
   *  without logging in brings the card back, because this is a separate gate input, not a write
   *  to `dismissed`: the card's own dismissal state persists through modal open/close. */
  modalOpen: boolean;
  pathname: string;
};

export function shouldShowSignInCard(g: SignInCardGate): boolean {
  if (!g.isWeb) return false;        // native has its own auth entry points
  if (!g.docked) return false;       // mobile / narrow desktop: never (pill + on-demand modal)
  if (!g.authChecked) return false;  // session still restoring — say nothing yet
  if (g.user) return false;          // signed in: never
  if (g.modalOpen) return false;     // the full modal is up — suppressed, never stacked
  if (g.dismissed) return false;     // sent something or closed it — gone until a refresh
  return g.pathname === '/' || g.pathname === '/agent';  // Filter home and Agent only
}

/** Dragging is a desktop pointer affordance: web AND at/above DOCK_BREAKPOINT. Below it (mobile
 *  web) and on native the modal is the plain centered sheet with no drag machinery at all. */
export function canDragAuthPopup(g: { isWeb: boolean; docked: boolean }): boolean {
  return g.isWeb && g.docked;
}

/** Margin either surface keeps from every viewport edge while dragged. */
export const AUTH_POPUP_EDGE = 16;

// The card's owner-approved geometry — the retired SignInDock's exact side slot (measured on
// production at 1280×720: nav rail 14→285, filter card 529→1051, free right column 229px wide).
export const SIGNIN_CARD_W = 208;
export const signInCardDefaultPos = (vw: number, vh: number) => ({
  x: vw - SIGNIN_CARD_W - AUTH_POPUP_EDGE,
  y: Math.round(vh * 0.46),
});

// ── THE AUTH EPOCH (owner 2026-08-29) ───────────────────────────────────────────────────────────
// «NOT AUTHENTICATED = the invitation must be ELIGIBLE to appear. Do not key it off whether the
// user previously had an account, deleted one, dismissed the invitation before, or was previously
// signed in.»
//
// A dismissal is scoped to ONE CONTINUOUS LOGGED-OUT EPOCH — the stretch where this visitor stays
// signed out. Sending something (or closing the card) is respected inside that stretch, but ANY
// auth transition ends the epoch and voids the dismissal:
//   sign-IN   a dismissal stamped on the way into an account says nothing about the logged-out
//             visitor this browser may hold later.
//   sign-OUT / account DELETION / session death
//             the person now in front of the app is a NEW logged-out visitor and must land in the
//             exact same state as any fresh guest — card eligible, sidebar CTA present.
// THE BUG THIS ENCODES (production, 2026-08-29, against the then-modal): sign in → delete the
// account → a stale dismissal suppressed the invitation for the now-logged-out visitor. The rule
// carries over unchanged to the card's in-memory flag.
//
// Store.tsx owns the ONE writer: an effect on the signed-in boolean calls this on every change
// and resets the in-memory card dismissal when it returns false. Pure so the barrier executes it.
export function dismissalOutlivesTransition(prevSignedIn: boolean, nowSignedIn: boolean): boolean {
  return prevSignedIn === nowSignedIn;   // no transition → same epoch → the dismissal stands
}

/** sessionStorage keys — POSITION memory only (owner: "preserve if safe/easy"). Dismissal is
 *  deliberately NOT here: it must die with the load so a refresh brings the card back. */
export const AUTH_POPUP_POS_KEY = 'ezhalah.authPopup.pos';
export const SIGNIN_CARD_POS_KEY = 'ezhalah.signInCard.pos';

/**
 * Clamp a drag offset so the WHOLE card stays on-screen with AUTH_POPUP_EDGE margin. `base` is
 * the card's untranslated rect: where flex centering put the modal (offset mode), or {0,0,w,h}
 * for the small card whose translate IS its absolute position. The returned offset satisfies
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
