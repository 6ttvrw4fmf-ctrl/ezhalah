// COOKIE CONSENT — appears on EVERY signed-out web visit (owner 2026-09-13, permanent; supersedes
// the "once per visitor" rule from 2026-09-06 that would hide the card on the second visit).
//
// Owner brief, verbatim intent (2026-09-13): the card must show for EVERY non-logged-in visitor, on
// every refresh — same lifecycle as SignInCard, which dismisses in-memory and returns on reload. It
// disappears only when the visitor signs in.
//
// The pure gate below is unchanged: `shouldShowCookieBanner` still refuses if `consent != null`, so
// clicking a button hides the card for THIS pageload. Reload → the component seeds `consent` to null
// again (see src/components/CookieConsent.tsx) → the card comes back. localStorage is still WRITTEN
// on click so `analyticsAllowed()` keeps the visitor's real preference across visits, but it is no
// longer READ to decide whether to show the card.
//
// Two buttons: "Allow all" records 'all'; "Only necessary" records 'necessary'. A search while the
// card is up counts as ALLOW ALL for THIS pageload (owner: "no selection = allow all"); the card
// still re-appears on the next reload, that is the point.
//
// THE HONEST HALF: whatever the popup promises, the code must keep. `analyticsAllowed()` is the ONE
// switch the future usage tracker MUST read before it measures anything. It FAILS CLOSED — no stored
// choice means analytics stays OFF, not on. The owner's "no choice = allow all" rule is honoured at
// the DISMISSAL moment (searching records 'all'); it is deliberately NOT a blanket "measure before we
// ever asked", which is the exact shape that gets consent invalidated under PDPL. There is no tracker
// wired to this yet — this is the switch waiting for one.

export type CookieConsent = 'all' | 'necessary';

export const COOKIE_CONSENT_KEY = 'ezhalah:cookieConsent';

/** The recorded choice, or null if the visitor has not chosen yet. Never throws. */
export function getCookieConsent(): CookieConsent | null {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(COOKIE_CONSENT_KEY) : null;
    return v === 'all' || v === 'necessary' ? v : null;
  } catch {
    return null;
  }
}

/** Persist the visitor's choice. Never throws (private mode / blocked storage → silent no-op). */
export function setCookieConsent(c: CookieConsent): void {
  try {
    localStorage?.setItem(COOKIE_CONSENT_KEY, c);
  } catch {
    /* storage unavailable — the card just re-appears next load, which is safe */
  }
}

/**
 * May non-essential analytics / usage measurement run for this visitor?
 * FAIL CLOSED: only an explicit (or search-implied) 'all' turns it on. The future tracker gates here.
 */
export function analyticsAllowed(): boolean {
  return getCookieConsent() === 'all';
}

/**
 * Pure gate for the banner. Shown to any signed-out web visitor after the auth session restore has
 * settled (so a returning signed-in user never sees a flash). `consent` is the IN-MEMORY choice for
 * THIS pageload — clicking a button sets it and hides the card until the next reload; the persisted
 * choice is not read here anymore (owner 2026-09-13: card must return on every refresh, matching
 * SignInCard's in-memory dismissal — see src/components/CookieConsent.tsx).
 */
export function shouldShowCookieBanner(a: {
  isWeb: boolean;
  authChecked: boolean;
  user: unknown;
  consent: CookieConsent | null;
}): boolean {
  return a.isWeb && a.authChecked && a.user == null && a.consent == null;
}
