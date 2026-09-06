// COOKIE CONSENT — capture for signed-out, first-time web visitors (owner 2026-09-06).
//
// Owner brief, verbatim intent: a Perplexity-style cookie card that
//   • pops up when the visitor is NOT logged in,
//   • shows only the FIRST time (never again once a choice is recorded),
//   • goes away the moment the user runs a search, and
//   • treats "left without choosing" (e.g. dismissed by searching) as ALLOW ALL.
//
// Two buttons: "Allow all" records 'all'; "Only necessary" records 'necessary'. The choice is
// persisted to localStorage so the card is genuinely once-per-visitor, surviving reloads (unlike the
// in-memory SignInCard dismissal, which is meant to return).
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
 * Pure gate for the banner. Shown only to a signed-out web visitor who has not chosen yet, and only
 * after the auth session restore has settled (so a returning signed-in user never sees a flash).
 */
export function shouldShowCookieBanner(a: {
  isWeb: boolean;
  authChecked: boolean;
  user: unknown;
  consent: CookieConsent | null;
}): boolean {
  return a.isWeb && a.authChecked && a.user == null && a.consent == null;
}
