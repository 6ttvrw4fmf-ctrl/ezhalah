// THE LANGUAGE SURVIVES THE SIGN-IN ROUND TRIP (2026-10-24) — executed on the REAL src/i18n.tsx code.
// A visitor who picked English and signed in with Google or Apple landed back in Arabic: the OAuth redirect is a
// fresh page load, and a guest's choice is never read on a fresh load (guests start in Arabic — that rule stays,
// pinned by verify-chat-language-is-not-interface-language.ts). The choice is now handed across that one trip.
//   1. English picked → sign-in starts → the /auth landing starts in English, and the signed-in account keeps it;
//   2. the hand-over is read ONCE (taken), only on /auth, only while fresh — so an abandoned sign-in never turns a
//      guest's next visit English, and the guest-starts-in-Arabic rule still holds everywhere else;
//   3. wiring: the OAuth start writes it before leaving; the module's first language reads it before the saved one.
//   node --experimental-strip-types scripts/verify-language-survives-sign-in.ts   (in `npm test`)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const root = resolve(import.meta.dirname, '..');
const I18N = join(root, 'src/i18n.tsx');
const AUTH = join(root, 'src/lib/auth.ts');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
const mustCatch = (label: string, problems: string[]) => check(`(mutation) catches ${label}`, problems.length > 0);

// A fake device: one localStorage that outlives "page loads", and a location.
const saved = new Map<string, string>();
const g = globalThis as any;
g.window = {
  localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => { saved.set(k, String(v)); }, removeItem: (k: string) => { saved.delete(k); } },
  location: { pathname: '/' },
};

async function lift(i18nSource: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ez-lang-signin-'));
  const file = join(dir, 'i18n.tsx');
  writeFileSync(file, i18nSource);
  return liftSymbols(file, [
    { header: 'export const LOCALE_KEY =', endsWith: /;$/ },
    { header: 'function readSavedLocale(' },
    { header: 'export const SIGN_IN_LOCALE_KEY =', endsWith: /;$/ },
    { header: 'export const SIGN_IN_LOCALE_MAX_MS =', endsWith: /;$/ },
    { header: 'type KeyStore =', endsWith: /;$/ },
    { header: 'export function takeSignInLocale(' },
    { header: 'export function rememberLocaleForSignIn(' },
    { header: 'const signInLandingLocale =', endsWith: /;$/ },
    { header: 'export function setLocalePersistence(' },
  ], ['readSavedLocale', 'takeSignInLocale', 'rememberLocaleForSignIn', 'signInLandingLocale', 'setLocalePersistence', 'SIGN_IN_LOCALE_KEY', 'SIGN_IN_LOCALE_MAX_MS', 'pageLoad', 'pick'],
  `type Locale = 'ar' | 'en';
const Platform = { OS: 'web' };
let _persistEnabled = false;
let _locale: Locale = 'ar';
const pick = (l: Locale) => { _locale = l; };
// A fresh page load: the module's first language, by the SAME expression src/i18n.tsx uses (read from it below).
const pageLoad = (path: string): Locale => { (globalThis as any).window.location.pathname = path; _persistEnabled = false; _locale = (${firstLocaleExpr(i18nSource)}); return _locale; };`);
}
// The real initializer of `_locale` in the module, so the guard runs the module's own order of reads.
function firstLocaleExpr(src: string): string {
  const m = src.match(/^let _locale: Locale = (.+);$/m);
  if (!m) throw new Error('src/i18n.tsx: no `let _locale: Locale = …;` initializer');
  return m[1];
}

type Mod = Awaited<ReturnType<typeof lift>> & Record<string, any>;
/** Every way the round trip can fail, for one version of the module. Empty = it works. */
function problems(M: Mod): string[] {
  const bad: string[] = [];
  const now = Date.now();
  // 1. English picked as a guest, Google/Apple sign-in starts, the provider sends the browser back to /auth.
  saved.clear(); M.pageLoad('/');
  M.pick('en'); M.rememberLocaleForSignIn();
  if (M.pageLoad('/auth') !== 'en') bad.push('the /auth landing after an English sign-in starts in Arabic');
  M.setLocalePersistence(true); // the store does this the moment the signed-in user is known
  if (M.pageLoad('/') !== 'en' || saved.get('locale') !== 'en') bad.push('the signed-in account does not keep the English it signed in with');
  // Arabic picked → Arabic, never a stuck English.
  saved.clear(); M.pageLoad('/'); M.pick('ar'); M.rememberLocaleForSignIn();
  if (M.pageLoad('/auth') !== 'ar') bad.push('an Arabic sign-in lands in English');
  // 2a. read ONCE: a second /auth load (back button, refresh of the stub) does not re-apply an old hand-over.
  saved.clear(); M.pageLoad('/'); M.pick('en'); M.rememberLocaleForSignIn(); M.pageLoad('/auth');
  if (saved.has(M.SIGN_IN_LOCALE_KEY)) bad.push('the hand-over is not removed once the /auth landing has read it');
  // 2b. only on /auth: an abandoned sign-in (back to the home page) keeps the guest rule — Arabic.
  saved.clear(); M.pageLoad('/'); M.pick('en'); M.rememberLocaleForSignIn();
  if (M.pageLoad('/') !== 'ar') bad.push('an abandoned sign-in turned a guest\'s next visit English (guests start in Arabic)');
  // 2c. only while fresh.
  saved.clear(); saved.set(M.SIGN_IN_LOCALE_KEY, JSON.stringify({ locale: 'en', at: now - M.SIGN_IN_LOCALE_MAX_MS - 1000 }));
  if (M.pageLoad('/auth') !== 'ar') bad.push('a stale hand-over (older than the window) still applied');
  // 2d. junk never throws and never picks a language.
  saved.clear(); saved.set(M.SIGN_IN_LOCALE_KEY, '{oops');
  try { if (M.pageLoad('/auth') !== 'ar') bad.push('a malformed hand-over picked a language'); } catch { bad.push('a malformed hand-over threw on page load'); }
  // The guest rule itself is untouched: a guest's English, with no sign-in, is Arabic on the next load.
  saved.clear(); M.pageLoad('/'); M.pick('en');
  if (M.pageLoad('/') !== 'ar') bad.push('a guest\'s language now survives a reload (guests start in Arabic — owner rule)');
  return bad;
}

const i18nSrc = readFileSync(I18N, 'utf8');
const real = (await lift(i18nSrc)) as Mod;
const found = problems(real);
check('English picked → Google/Apple sign-in → the /auth landing is English and the account keeps it', found.length === 0);
for (const p of found) console.log(`      ↳ ${p}`);

// 3. wiring: the OAuth start writes the hand-over BEFORE the redirect; the module's first language reads it first.
const authSrc = readFileSync(AUTH, 'utf8');
const wiringProblems = (auth: string, i18n: string): string[] => {
  const bad: string[] = [];
  const fn = auth.slice(auth.indexOf('export async function signInWithProvider('), auth.indexOf('\n}\n', auth.indexOf('export async function signInWithProvider(')));
  const w = fn.indexOf('rememberLocaleForSignIn()'), o = fn.indexOf('signInWithOAuth(');
  if (w < 0 || o < 0 || w > o) bad.push('signInWithProvider does not hand the language over before the OAuth redirect');
  if (!/^let _locale: Locale = signInLandingLocale\(\) \?\? readSavedLocale\(\);$/m.test(i18n)) bad.push('the first language does not read the sign-in hand-over first');
  return bad;
};
const wp = wiringProblems(authSrc, i18nSrc);
check('wiring: the OAuth start hands the language over; the first language reads it first', wp.length === 0);
for (const p of wp) console.log(`      ↳ ${p}`);

// Mutation proof: each broken version must be caught.
const mutate = async (from: string, to: string) => {
  if (!i18nSrc.includes(from)) throw new Error(`mutation target missing: ${from}`);
  return problems((await lift(i18nSrc.replace(from, to))) as Mod);
};
mustCatch('the hand-over read on every page, not only /auth', await mutate("!/^\\/auth(\\.html)?\\/?$/.test(path)", 'false'));
mustCatch('the hand-over kept after it is read', await mutate('    store.removeItem(SIGN_IN_LOCALE_KEY);\n', ''));
mustCatch('no freshness window', await mutate('age >= 0 && age < SIGN_IN_LOCALE_MAX_MS', 'true'));
mustCatch('the hand-over never written', await mutate("window.localStorage?.setItem(SIGN_IN_LOCALE_KEY, JSON.stringify({ locale: _locale, at: Date.now() }))", 'void 0'));
mustCatch('the first language ignoring the hand-over', await mutate('let _locale: Locale = signInLandingLocale() ?? readSavedLocale();', 'let _locale: Locale = readSavedLocale();'));
mustCatch('the OAuth start not handing the language over', wiringProblems(authSrc.replace('    rememberLocaleForSignIn();\n', ''), i18nSrc));
mustCatch('the hand-over written AFTER the redirect started', wiringProblems(authSrc.replace('    rememberLocaleForSignIn();\n', '').replace(/(const \{ error \} = await supabase\.auth\.signInWithOAuth\([^\n]*\n)/, '$1    rememberLocaleForSignIn();\n'), i18nSrc));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✅ the language survives the sign-in round trip; guests still start in Arabic');
