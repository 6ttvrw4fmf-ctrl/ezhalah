// A SIGNED-IN USER'S LANGUAGE IS KEPT — ON REFRESH AND ON EVERY DEVICE (owner 2026-10-27).
//
// «I kept English, when I do refresh it goes back to Arabic» and «the phone and laptop same account … same things».
// Root cause of the refresh bug: session restore gives up after 6 s on a slow connection; the store read that as a
// guest, ERASED the saved language and forced Arabic, and the real session arriving next found nothing to restore.
// The fix: languageOnAuth() (src/i18n.tsx) — a sign-in still stored on the device means WAIT, never erase; a signed-in
// user restores the ACCOUNT's language (user_metadata.ui_locale, written by persistUiLocale) before the device's.
// This EXECUTES languageOnAuth and checks the store and auth wiring; mutations prove each rule can fail.
//   node --experimental-strip-types scripts/verify-signed-in-language-is-kept.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = join(import.meta.dirname, '..');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

type Fn = (s: { signedIn: boolean; storedSession: boolean; accountLocale?: string | null; deviceLocale?: string | null }) => { action: string; locale?: string | null };
const PRELUDE = "type Locale = 'ar' | 'en'; type LanguageOnAuth = { action: 'restore'; locale: Locale | null } | { action: 'wait' } | { action: 'guest' };";
const lift = async (file: string) => (await liftSymbols(file, [{ header: 'export function languageOnAuth(' }], ['languageOnAuth'], PRELUDE)).languageOnAuth as Fn;
const holds = (f: Fn) => {
  const slow = f({ signedIn: false, storedSession: true });
  const guest = f({ signedIn: false, storedSession: false });
  const both = f({ signedIn: true, storedSession: true, accountLocale: 'en', deviceLocale: 'ar' });
  const deviceOnly = f({ signedIn: true, storedSession: true, accountLocale: null, deviceLocale: 'en' });
  return slow.action === 'wait' && guest.action === 'guest' && both.action === 'restore' && both.locale === 'en'
    && deviceOnly.action === 'restore' && deviceOnly.locale === 'en';
};

const i18nPath = join(root, 'src/i18n.tsx');
const real = await lift(i18nPath);
check('a slow sign-in WAITS (never erases), a real guest is a guest', real({ signedIn: false, storedSession: true }).action === 'wait' && real({ signedIn: false, storedSession: false }).action === 'guest');
check('signed in: the ACCOUNT language wins over this device (same on phone and laptop)', real({ signedIn: true, storedSession: true, accountLocale: 'en', deviceLocale: 'ar' }).locale === 'en');
check('signed in, account has none yet: this device\'s language is kept', real({ signedIn: true, storedSession: true, deviceLocale: 'en' }).locale === 'en');

const { writeFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const src = readFileSync(i18nPath, 'utf8');
const mutant = async (from: string, to: string) => {
  const f = join(tmpdir(), `ezh-lang-${process.pid}-${Math.random().toString(36).slice(2)}.tsx`);
  writeFileSync(f, src.replace(from, to));
  try { return await lift(f); } finally { rmSync(f, { force: true }); }
};
mustCatch('the old behaviour: a slow sign-in treated as a guest (language erased)',
  !holds(await mutant("return s.storedSession ? { action: 'wait' } : { action: 'guest' };", "return { action: 'guest' };")));
mustCatch('the device winning over the account (phone and laptop disagree)',
  !holds(await mutant('locale: s.accountLocale ?? s.deviceLocale ?? null', 'locale: s.deviceLocale ?? s.accountLocale ?? null')));

const store = readFileSync(join(root, 'src/store.tsx'), 'utf8');
const auth = readFileSync(join(root, 'src/lib/auth.ts'), 'utf8');
const waitsBeforeErase = (s: string) => {
  const w = s.indexOf("if (step.action === 'wait') return");
  const erase = s.indexOf('AsyncStorage.removeItem(LOCALE_KEY)');
  return w > 0 && erase > w;
};
check('the store waits on a stored sign-in BEFORE any erase of the saved language', waitsBeforeErase(store));
mustCatch('the wait removed from the store', !waitsBeforeErase(store.replace("if (step.action === 'wait') return", 'if (false) return')));
check('a signed-in language change is written to the account, only after this load restored it',
  /if \(localeRestoredRef\.current && user\.uiLocale !== locale\) persistUiLocale\(locale\)/.test(store));
check('the account language is read from user_metadata.ui_locale and written there',
  /meta\.ui_locale === 'en' \|\| meta\.ui_locale === 'ar'/.test(auth) && /updateUser\(\{ data: \{ ui_locale: l \} \}\)/.test(auth));

if (failed) { console.error(`\n❌ verify-signed-in-language-is-kept: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-signed-in-language-is-kept: a signed-in user keeps their language on refresh and on every device.');
