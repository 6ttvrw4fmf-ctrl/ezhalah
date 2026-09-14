// THE COOKIE BANNER SHOWS ON EVERY SIGNED-OUT VISIT, AND ITS PROMISE IS KEPT — executed, not grepped.
//
// Guards the pure logic behind src/components/CookieConsent.tsx (owner 2026-09-06, extended
// 2026-09-13: the card must appear on EVERY refresh, not once per visitor). Hermetic: it imports
// the real functions and runs them, so a change that breaks the gating turns this RED.
//
// What it pins:
//   1. shouldShowCookieBanner — shown for a signed-out web visitor after auth settles, whenever the
//      IN-MEMORY consent for this pageload is null. Every other combination (signed in, dismissed
//      this pageload, not web, auth not settled) is hidden.
//   2. THE 2026-09-13 RULE (source-shape check, mutation-proven): CookieConsent.tsx MUST NOT seed
//      its useState from getCookieConsent() — a reload has to re-show the card. Reverting that one
//      line is the exact mutation that would restore the old "once per visitor" behavior owner
//      just banned; the check discovers the initializer's shape and fails on it.
//   3. Persistence round-trips still work at the LIBRARY level so analyticsAllowed() keeps the
//      visitor's real preference across visits; the component just does not use it to gate showing.
//   4. analyticsAllowed FAILS CLOSED — the switch the future tracker reads is OFF until an explicit
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

// 3. Persistence round-trips — the LIBRARY still round-trips so analyticsAllowed() keeps the
// visitor's preference across visits. The COMPONENT is separately pinned in section 5 to not READ
// this value at mount (owner 2026-09-13: the card must show every refresh).
localStorage.clear();
check('no choice recorded initially', getCookieConsent() === null);
setCookieConsent('all');
check('"Allow all" persists and reads back for analyticsAllowed()', getCookieConsent() === 'all');
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

// 5. THE COMPONENT MUST NOT SEED FROM localStorage AT MOUNT (owner 2026-09-13, permanent).
// The one-line mutation that would restore the old "once per visitor" rule is passing
// getCookieConsent() into useState's initializer instead of null. Reading the source shape catches
// exactly that revert — the file must NOT contain `useState<...>(() => getCookieConsent())` for the
// consent state, and must initialize it to null.
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = await import('node:path');
  const HERE = path.dirname(url.fileURLToPath(import.meta.url));
  const COMPONENT = path.join(HERE, '..', 'src', 'components', 'CookieConsent.tsx');
  const src = fs.readFileSync(COMPONENT, 'utf8');
  // Strip block + line comments before scanning so a comment MENTIONING the mutation
  // (e.g. "deliberately not seeded from getCookieConsent()") does not trip the check.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const seedsFromStorage = /useState[^;]*\(\s*\(\s*\)\s*=>\s*getCookieConsent\s*\(/.test(stripped)
                        || /useState[^;]*\(\s*getCookieConsent\s*\(\s*\)/.test(stripped);
  const initializesToNull = /const\s*\[\s*consent\s*,\s*setConsent\s*\][^;]*useState<[^>]*>\(\s*null\s*\)/
    .test(stripped);
  check('CookieConsent.tsx does NOT seed useState from getCookieConsent() (owner 2026-09-13)',
    !seedsFromStorage,
    'The card is meant to reappear on every refresh; reading the persisted choice at mount hides it.');
  check('CookieConsent.tsx initializes the in-memory consent to null',
    initializesToNull,
    'Expected: const [consent, setConsent] = useState<Consent | null>(null);');
  // Mutation: a hypothetical source that reintroduces the old seeded pattern MUST trip check 1.
  const mutated = 'const [consent, setConsent] = useState<Consent | null>(() => getCookieConsent());';
  mustCatch('a source that seeds from getCookieConsent() is caught',
    /useState[^;]*\(\s*\(\s*\)\s*=>\s*getCookieConsent\s*\(/.test(mutated));

  // 5b. FIRST TAP ANYWHERE ON THE APP COUNTS AS AGREE (owner 2026-09-13). Beyond «بحث», any tap on
  // a filter field / button / pill / sidebar dismisses the card and records 'all'. The card's own
  // click has to be excluded so its Allow all / Only necessary buttons still resolve normally.
  //
  // Rather than one giant multi-line regex (fragile — braces stop `[^}]*`), assert the three
  // independent facts the source must carry:
  //   (a) it attaches a document 'click' listener,
  //   (b) that listener calls choose('all'),
  //   (c) it excludes the card's own element via .contains() on the cookie-consent testid.
  const hasClickListener =
    /document\s*\.\s*addEventListener\s*\(\s*['"]click['"]/.test(stripped);
  const callsChooseAll = /choose\s*\(\s*['"]all['"]\s*\)/.test(stripped);
  const excludesCard = /cookie-consent[\s\S]{0,200}contains\s*\(/.test(stripped);
  check('CookieConsent.tsx attaches a document click listener',
    hasClickListener,
    'Expected document.addEventListener("click", …) inside a useEffect.');
  check('the click listener records "all" (any tap outside the card = agree)',
    callsChooseAll,
    'Expected choose("all") to run on a tap outside the card.');
  check('the click listener excludes the card itself (its own buttons resolve normally)',
    excludesCard,
    'Expected: if (card && card.contains(e.target)) return; using [data-testid="cookie-consent"].');

  // Mutation: a version that forgot to exclude the card would dismiss on the user's own click on
  // "Allow all" too (harmless there, but on "Only necessary" it would OVERWRITE their choice to 'all').
  const withoutExclude = 'document.addEventListener("click", () => choose("all"))';
  mustCatch('a listener that forgets to exclude the card is caught by the "contains" check',
    !/cookie-consent[\s\S]{0,200}contains\s*\(/.test(withoutExclude));
}

console.log(failed === 0
  ? '\n✅ cookie-consent-gating: shows on every signed-out visit; analytics stays off until allowed.\n'
  : `\n❌ cookie-consent-gating: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
