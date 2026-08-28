// WHEN THE DESKTOP SIGN-IN DOCK MAY APPEAR (owner 2026-08-26) — pure, so a barrier can execute it.
//
// The card is a prompt for signed-out DESKTOP visitors on the home screen. Every input below is
// state the app already maintains; nothing here tracks sessions or searches on its own:
//
//   docked        useDocked()          the SSR-safe viewport gate (useAtLeast + DOCK_BREAKPOINT 900).
//                                      Also the mobile answer: below the breakpoint this is false.
//   authChecked   store                the initial Supabase session restore has settled.
//   user          store                the signed-in user, or null.
//   activeChatId  store                the open conversation. recordHistory sets it when a search
//                                      lands; newChat() clears it and returns to the filter home.
//   pathname      expo-router          '/' is the filter home, where New Chat lands.
//
// WHY authChecked IS NOT OPTIONAL. During session restore `user` is null, so `!user` alone reports a
// LOGGED-IN visitor as logged out and flashes the card at them for a frame — the owner's "if they
// are already logged in, never show it" fails on exactly that frame. GoogleOneTap documents the same
// trap at its own gate; this makes it un-forgettable instead of a comment.
//
// WHY activeChatId IS THE SEARCH SIGNAL. "Disappears once a search starts" and "returns on a fresh
// New Chat" are not two behaviours needing two flags that can disagree — they are one condition read
// twice, because newChat() clears the very field recordHistory sets.
export type DockGate = {
  docked: boolean;
  authChecked: boolean;
  user: unknown | null;
  activeChatId: string | null;
  pathname: string;
  isWeb: boolean;
};

export function shouldShowSignInDock(g: DockGate): boolean {
  if (!g.isWeb) return false;        // native has its own auth entry points
  if (!g.docked) return false;       // mobile / narrow desktop: never
  if (!g.authChecked) return false;  // session still restoring — say nothing yet
  if (g.user) return false;          // signed in: never
  if (g.activeChatId) return false;  // a conversation is open — the user is searching
  return g.pathname === '/';         // the filter home only
}
