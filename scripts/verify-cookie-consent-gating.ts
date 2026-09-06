// THE COOKIE BANNER SHOWS ONCE, TO THE RIGHT VISITOR, AND ITS PROMISE IS KEPT — executed, not grepped.
//
// Guards the pure logic behind src/components/CookieConsent.tsx (owner 2026-09-06). Hermetic: it
// imports the real functions and runs them, so a change that breaks the gating turns this RED.
//
// What it pins:
//   1. shouldShowCookieBanner — shown ONLY for a signed-out web visitor who has not chosen, after auth
//      settles. Every other combination (signed in, already chose, not web, auth not settled) is hidden.
//   2. Persistence round-trips: a recorded choice is read back, so the card is genuinely once-per-visitor.
//   3. analyticsAllowed FAILS CLOSED — the switch the future tracker reads is OFF until an explicit
//      (or search-implied) 'all'. This is the honesty half: the "we don't measure without permission"
//      promise is a code fact, not just banner text.
//
// Run: node --experimental-strip-types scripts/verify-cookie-consent-gating.ts

import {
  shouldShowCookieBanner,
  analyticsAllowed,
  getCookieConsent,
  setCookieConsent,
  COOKIE_CONSENT_KEY,
  type CookieConsent,
} from '../src/lib/cookieConsent.ts';

// In-memory localStorage stub so persistence is exercised for real (node has no localStorage).
const makeStore = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
};
(globalThis as unknown as { localStorage: ReturnType<typeof makeStore> }).localStorage = makeStore();

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${label}`);
  if (!caught) failed++;
};

console.log('\nCookie consent — shows once, to the right visitor, promise kept\n');

const guest = { isWeb: true, authChecked: true, user: null, consent: null as CookieConsent | null };

// 1. The one case that SHOWS.
check('shows for a signed-out web visitor who has not chosen (auth settled)',
  shouldShowCookieBanner(guest) === true);

// 2. Every case that must stay HIDDEN — each is a mutation of the shown case.
mustCatch('hidden for a signed-in user',
  shouldShowCookieBanner({ ...guest, user: { sub: 'u1' } }) === false);
mustCatch('hidden once the visitor chose "all"',
  shouldShowCookieBanner({ ...guest, consent: 'all' }) === false);
mustCatch('hidden once the visitor chose "necessary"',
  shouldShowCookieBanner({ ...guest, consent: 'necessary' }) === false);
mustCatch('hidden before the session restore settles (authChecked=false → no flash)',
  shouldShowCookieBanner({ ...guest, authChecked: false }) === false);
mustCatch('hidden on native (not web)',
  shouldShowCookieBanner({ ...guest, isWeb: false }) === false);

// 3. Persistence round-trips → genuinely once-per-visitor.
localStorage.clear();
check('no choice recorded initially', getCookieConsent() === null);
setCookieConsent('all');
check('"Allow all" persists and reads back', getCookieConsent() === 'all');
check('recording a choice hides the banner on the next load',
  shouldShowCookieBanner({ ...guest, consent: getCookieConsent() }) === false);
setCookieConsent('necessary');
check('"Only necessary" persists and reads back', getCookieConsent() === 'necessary');
check('the key is the documented one', COOKIE_CONSENT_KEY === 'ezhalah:cookieConsent');

// 4. THE PROMISE: analytics is OFF until 'all' — fail closed.
localStorage.clear();
check('analytics OFF when nothing chosen (fail closed)', analyticsAllowed() === false);
setCookieConsent('necessary');
check('analytics OFF under "Only necessary"', analyticsAllowed() === false);
setCookieConsent('all');
check('analytics ON only under "Allow all"', analyticsAllowed() === true);

// A garbage stored value must never read as a valid consent (fail closed).
localStorage.setItem(COOKIE_CONSENT_KEY, 'yes-please');
mustCatch('a corrupt stored value is treated as no-choice, not as consent',
  getCookieConsent() === null && analyticsAllowed() === false);

console.log(failed === 0
  ? '\n✅ cookie-consent-gating: shows once to signed-out web visitors; analytics stays off until allowed.\n'
  : `\n❌ cookie-consent-gating: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
