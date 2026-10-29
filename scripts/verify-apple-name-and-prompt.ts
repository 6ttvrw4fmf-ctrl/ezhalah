// Barrier — Apple's name is caught, a missing name is ASKED for (once), never derived (owner 2026-10-23).
//
// Apple sends the user's name on the FIRST authorization only, and the Supabase redirect never passes
// it on, so Apple sign-ups landed nameless. Two fixes, one guard:
//   §1 Apple JS (popup, flagged EXPO_PUBLIC_APPLE_JS_SIGNIN): the name Apple hands the page is saved.
//   §2 No name from the provider → '' (never the email), and AuthModal saves only what Apple sent.
//   §3 «وش نناديك؟» shows only to a signed-in account with an empty name that has not seen it.
//   §4 Its «حفظ» is the pencil rename's own path (useSaveName) — no second writer.
//   §5 Flag OFF → Apple sign-in is today's redirect, byte for byte.
//   node --experimental-strip-types scripts/verify-apple-name-and-prompt.ts

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { windowBetween } from './lib/sourceWindow.ts';

const AUTH = 'src/lib/auth.ts';
const MODAL = 'src/components/AuthModal.tsx';
const PROMPT = 'src/components/NamePrompt.tsx';
const MENU = 'src/components/AccountMenu.tsx';
const HOOK = 'src/lib/useSaveName.ts';
const LAYOUT = 'src/app/_layout.tsx';
const read = (p: string) => readFileSync(p, 'utf8');
const files: Record<string, string> = Object.fromEntries([AUTH, MODAL, PROMPT, MENU, HOOK, LAYOUT].map((p) => [p, read(p)]));

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

// ── §1/§2 EXECUTED: the real signInWithAppleJs + appleFullName, with Apple and Supabase stubbed ──────
const g = globalThis as any;
const PRELUDE =
  `const g = (globalThis as any);\n` +
  `const supabase = { auth: { signInWithIdToken: async (p: any) => { g.__idt.push(p); return { error: g.__idtError ?? null }; } } };\n` +
  `let appleJsReady: any = null;\n` +
  `const prepareAppleJs = async () => g.__prep;\n` +
  `const window = { AppleID: { auth: { signIn: () => g.__signIn() } } };\n`;
const { appleFullName, signInWithAppleJs } = await liftSymbols(AUTH, [
  { header: 'export function appleFullName(' },
  { header: 'export async function signInWithAppleJs(', endsWith: /^\}$/ },
], ['appleFullName', 'signInWithAppleJs'], PRELUDE) as {
  appleFullName: (n: unknown) => string;
  signInWithAppleJs: () => Promise<{ signedIn?: true; name?: string; cancelled?: true; fallback?: true }>;
};

const run = async (signIn: () => Promise<unknown>, idtError: unknown = null) => {
  g.__prep = { rawNonce: 'RAW', state: 'S1' };
  g.__idt = [];
  g.__idtError = idtError;
  g.__signIn = signIn;
  return signInWithAppleJs();
};
const firstAuth = { authorization: { id_token: 'TOK', state: 'S1' }, user: { email: 'x7k2@privaterelay.appleid.com', name: { firstName: 'يوسف', lastName: 'النشوان' } } };
const laterAuth = { authorization: { id_token: 'TOK', state: 'S1' }, user: { email: '66s7zmj7t9@privaterelay.appleid.com' } };

{
  const r = await run(async () => firstAuth);
  check('§1 the FIRST authorization: Apple\'s name comes back to be saved', r.signedIn === true && r.name === 'يوسف النشوان', JSON.stringify(r));
  check('§1 the id_token goes to Supabase with the RAW nonce (Apple got its SHA-256)',
    g.__idt.length === 1 && g.__idt[0].provider === 'apple' && g.__idt[0].token === 'TOK' && g.__idt[0].nonce === 'RAW', JSON.stringify(g.__idt));
  const r2 = await run(async () => laterAuth);
  check('§2 a later authorization (no name) gives \'\' — never the email\'s local part', r2.signedIn === true && r2.name === '', JSON.stringify(r2));
  check('§2 appleFullName of nothing is \'\'', appleFullName(undefined) === '' && appleFullName({ firstName: ' ', lastName: '' }) === '');
  const r3 = await run(async () => ({ ...firstAuth, authorization: { id_token: 'TOK', state: 'FORGED' } }));
  check('§1 a response whose state is not ours is refused (redirect fallback), never signed in', !!r3.fallback && !r3.signedIn && g.__idt.length === 0);
  const r4 = await run(async () => { throw { error: 'popup_closed_by_user' }; });
  check('§1 closing Apple\'s window is a cancel (stay on the chooser), not a redirect', !!r4.cancelled && !r4.fallback);
  const r5 = await run(async () => { throw { error: 'popup_blocked_by_browser' }; });
  check('§1 a blocked popup falls back to the redirect — never stuck', !!r5.fallback);
  const r6 = await run(async () => firstAuth, { message: 'Unacceptable audience' });
  check('§1 Supabase refusing the token falls back to the redirect', !!r6.fallback && !r6.signedIn);
  g.__prep = null;
  g.__signIn = async () => firstAuth;
  const r7 = await signInWithAppleJs();
  check('§1 Apple\'s script failing to load falls back to the redirect', !!r7.fallback);
}

// AuthModal saves EXACTLY what Apple sent, through the rename path, and only when there is one.
const appleBlock = (m: string) => {
  const i = m.indexOf('        if (APPLE_JS_SIGNIN) {');
  if (i < 0) return '';
  const j = m.indexOf('\n        }\n', i);
  return j < 0 ? '' : m.slice(i, j + '\n        }\n'.length);
};
const modalProblems = (f: Record<string, string>) => {
  const out: string[] = [];
  const b = appleBlock(f[MODAL]);
  if (!b) out.push('AuthModal has no flagged Apple JS block');
  if (!/if \(a\.name\) saveName\(a\.name\);/.test(b)) out.push('Apple\'s name is not saved (or saved without the empty check)');
  if (!/const saveName = useSaveName\(\);/.test(f[MODAL])) out.push('AuthModal\'s saveName is not the shared rename path');
  if (/email/.test(b.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))) out.push('the Apple block reads the email');
  if (!/return \{ signedIn: true, name: appleFullName\(res\?\.user\?\.name\) \};/.test(f[AUTH])) out.push('signInWithAppleJs no longer returns Apple\'s own name');
  return out;
};
{
  const p = modalProblems(files);
  check('§1 AuthModal saves Apple\'s name via useSaveName, only when present', p.length === 0, p.join('; '));
  mustCatch('Apple\'s name dropped on the floor', modalProblems({ ...files, [MODAL]: files[MODAL].replace('if (a.name) saveName(a.name);', '') }).length > 0);
  mustCatch('an empty Apple name written anyway', modalProblems({ ...files, [MODAL]: files[MODAL].replace('if (a.name) saveName(a.name);', 'saveName(a.name);') }).length > 0);
  mustCatch('a name invented from the email', modalProblems({ ...files, [MODAL]: files[MODAL].replace('if (a.name) saveName(a.name);', "saveName(a.name || a.email?.split('@')[0]);") }).length > 0);
  mustCatch('signInWithAppleJs no longer handing back user.name', modalProblems({ ...files, [AUTH]: files[AUTH].replace('name: appleFullName(res?.user?.name)', "name: ''") }).length > 0);
}

// ── §3 EXECUTED: the real shouldAskName truth table ─────────────────────────────────────────────────
{
  // SIGN-UP ONLY (owner 2026-10-23): the box opens by itself only for the sign-in that CREATED the account.
  // The real isFreshSignUp (lib/loginWelcome.ts) is read into the lifted module — never a copy of it.
  const LW = read('src/lib/loginWelcome.ts');
  const fresh = (src: string) => (windowBetween(src, 'export const SIGN_UP_WINDOW_MS', '\n}\n', 'src/lib/loginWelcome.ts') + '\n}\n').replace(/^export /gm, '');
  const liftAsk = async (prompt: string, lw: string) => {
    const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-ask-')), 'NamePrompt.tsx');
    writeFileSync(tmp, prompt);
    return (await liftSymbols(tmp, [{ header: 'export function shouldAskName(' }], ['shouldAskName'],
      'const isBackendLive = true;\ntype AuthUser = any;\n' + fresh(lw))) as { shouldAskName: (u: any, checked: boolean, open: boolean, now: number) => boolean };
  };
  const NOW = Date.parse('2026-10-23T22:00:00Z');
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const u = (o: { name?: string; seen?: boolean; created?: number; last?: number }) => ({ method: 'apple', name: o.name ?? '', initials: '', sub: 'a@b.c',
    namePromptSeen: o.seen, createdAt: at(o.created ?? 30_000), lastSignInAt: at(o.last ?? (o.created ?? 30_000) - 1_000) });
  const askTable = (ask: (u: any, c: boolean, o: boolean, n: number) => boolean): [string, boolean][] => [
    ['an Apple SIGN-UP (created now, first sign-in, no name) → ASK', ask(u({}), true, false, NOW) === true],
    ['a Google SIGN-UP with Google\'s name → NO box (owner 2026-10-26: the name is kept, the party plays)', ask(u({ name: 'Yusuf AlNashwan' }), true, false, NOW) === false],
    ['a returning Google/Apple LOG-IN (account 2 days old) → never', ask(u({ name: 'Sara', created: 2 * 86_400_000, last: 5_000 }), true, false, NOW) === false],
    ['a SECOND sign-in 5 min after sign-up → never (not the first session)', ask(u({ created: 5 * 60_000, last: 10_000 }), true, false, NOW) === false],
    ['a first session restored 2 days later → never (not a fresh sign-up)', ask(u({ created: 2 * 86_400_000, last: 2 * 86_400_000 - 1_000 }), true, false, NOW) === false],
    ['an existing nameless account (the owner\'s Apple, 3 h old) → never by itself', ask(u({ created: 3 * 3_600_000, last: 3 * 3_600_000 - 1_000 }), true, false, NOW) === false],
    ['a sign-up that already answered (seen) → never again', ask(u({ seen: true }), true, false, NOW) === false],
    ['a guest → never', ask(null, true, false, NOW) === false],
    ['before the session is restored → not yet', ask(u({}), false, false, NOW) === false],
    ['while the sign-in popup is open → not yet', ask(u({}), true, true, NOW) === false],
  ];
  const real = await liftAsk(files[PROMPT], LW);
  for (const [l, ok] of askTable(real.shouldAskName)) check(`§3 ${l}`, ok);
  const failsTable = async (prompt: string, lw: string) => askTable((await liftAsk(prompt, lw)).shouldAskName).some(([, ok]) => !ok);
  mustCatch('the box on every log-in (no sign-up test)', await failsTable(files[PROMPT].replace(' && isFreshSignUp(user.createdAt, user.lastSignInAt, now)', ''), LW));
  mustCatch('a sign-up test without the first-session rule (a second sign-in is asked again)', await failsTable(files[PROMPT], LW.replace(' && Math.abs(l - c) <= 60_000', '')));
  mustCatch('a sign-up window of days, not minutes', await failsTable(files[PROMPT], LW.replace('SIGN_UP_WINDOW_MS = 10 * 60 * 1000', 'SIGN_UP_WINDOW_MS = 10 * 86_400_000')));
  mustCatch('a named sign-up asked anyway (owner 2026-10-26: only a nameless one gets the box)', await failsTable(files[PROMPT].replace(" && !(user.name ?? '').trim()", ''), LW));
  mustCatch('the seen flag ignored (asked again after an answer)', await failsTable(files[PROMPT].replace(' && !user.namePromptSeen', ''), LW));
  const mapOk = (a: string) => /createdAt: u\?\.created_at, lastSignInAt: u\?\.last_sign_in_at/.test(a);
  check('§3 the account\'s created_at / last_sign_in_at reach the user (mapSupabaseUser)', mapOk(files[AUTH]));
  mustCatch('the sign-up facts never read from the auth user', !mapOk(files[AUTH].replace('createdAt: u?.created_at, ', '')));
  const flagOk = (a: string) => /namePromptSeen: meta\.name_prompt_seen === true/.test(a) && /data: \{ name_prompt_seen: true \}/.test(a);
  check('§3 the seen flag lives in user_metadata (follows the account across devices)', flagOk(files[AUTH]));
  mustCatch('the flag not read back from user_metadata', !flagOk(files[AUTH].replace('namePromptSeen: meta.name_prompt_seen === true', 'namePromptSeen: false')));
  const closeOk = (src: string) => /const close = \(\) => \{ setClosed\(true\); setReopened\(false\); markNamePromptSeen\(\); setPhase\('leave'\);/.test(src) && /onPress=\{skip\}/.test(src) && /const skip = \(\) => \{\n[^}]*\n\s*close\(\);/.test(src);
  check('§3 «لاحقاً» and Save both mark it seen', closeOk(files[PROMPT]) && /saveName\(v\);\n\s*close\(\);/.test(files[PROMPT]));
  mustCatch('«لاحقاً» not recording that it was shown', !closeOk(files[PROMPT].replace(' markNamePromptSeen();', '')));
  check('§3 the prompt is mounted at the root', /<NamePrompt \/>/.test(files[LAYOUT]));
  // Owner 2026-10-23: the box speaks the UI's language — «وش نناديك؟» / «اكتب اسمك» / «حفظ» / «لاحقاً».
  const i18n = read('src/i18n.tsx');
  const wordsOk = (p: string, i: string) => /tr\('What should we call you\?'\)/.test(p) && /placeholder=\{translate\(lang, 'Type your name'\)\}/.test(p)
    && /tr\('Save'\)/.test(p) && /tr\('Skip'\)/.test(p)
    && /'What should we call you\?': 'وش نناديك؟'/.test(i) && /'Type your name': 'اكتب اسمك'/.test(i)
    && /'Save': 'حفظ'/.test(i) && /'Skip': 'تخطي'/.test(i);
  check('§3 the owner\'s words, in both languages', wordsOk(files[PROMPT], i18n));
  mustCatch('a placeholder other than «اكتب اسمك»', !wordsOk(files[PROMPT].replace("translate(lang, 'Type your name')", "translate(lang, 'Display Name')"), i18n));
  mustCatch('the Arabic title drifting', !wordsOk(files[PROMPT], i18n.replace("'وش نناديك؟'", "'ما اسمك؟'")));
  // Apple sign-up: empty. Google sign-up: PREFILLED with the name Google sent, the switch on its script.
  // Never the email (no email / user.sub anywhere in the box's code); the menu's reopen starts empty.
  const prefillOk = (src: string) => /const given = \(user\?\.name \?\? ''\)\.trim\(\);\n\s*setName\(given\);\n\s*setLang\(given \? scriptOf\(given\) : locale\);/.test(src)
    && /const o = \(\) => \{ setName\(''\); setLang\(locale\); setReopened\(true\); \};/.test(src)
    && /useState\(''\);/.test(src) && !/email|user\.sub\b/.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'));
  check('§3 Google sign-up prefilled with Google\'s name (switch on its script); Apple and the menu start empty; never the email', prefillOk(files[PROMPT]));
  mustCatch('a Google sign-up shown an empty box', !prefillOk(files[PROMPT].replace('    setName(given);\n', "    setName('');\n")));
  mustCatch('the switch not following the prefilled name\'s script', !prefillOk(files[PROMPT].replace('setLang(given ? scriptOf(given) : locale);', 'setLang(locale);')));
  mustCatch('a box prefilled from the email', !prefillOk(files[PROMPT].replace("const given = (user?.name ?? '').trim();", "const given = (user?.name || user?.sub?.split('@')[0] || '').trim();")));
}

// ── §6 after «حفظ»: the SAME welcome a Google sign-in gets, once; the switch (owner 2026-10-23) ───────
{
  // §6.1 EXECUTED: the real welcomeOnceSaved, with supabase's auth events and markJustSignedIn stubbed.
  // It must fire the sign-in welcome exactly once, and only after the SAVED name is in the session.
  const PRE6 = `const g = globalThis as any;\n` +
    `const setTimeout = (_f: any, _ms: number) => 0 as any; const clearTimeout = (_t: any) => {};\n` +
    `const supabase = { auth: { onAuthStateChange: (cb: any) => { g.__subs.push(cb); return { data: { subscription: { unsubscribe: () => { g.__subs = g.__subs.filter((x: any) => x !== cb); } } } }; } } };\n` +
    `const markJustSignedIn = () => { g.__marks++; };\n`;
  const liftWelcome = async (src: string) => {
    const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-w-')), 'NamePrompt.tsx');
    writeFileSync(tmp, src);
    return (await liftSymbols(tmp, [{ header: 'export function welcomeOnceSaved(' }], ['welcomeOnceSaved'], PRE6)) as { welcomeOnceSaved: (v: string, onWelcome: () => void) => void };
  };
  const gg = globalThis as any;
  const emit = (event: string, fullName?: string, seen?: boolean) => { for (const cb of [...gg.__subs]) cb(event, fullName === undefined ? null : { user: { user_metadata: { full_name: fullName, ...(seen ? { name_prompt_seen: true } : {}) } } }); };
  const run = async (src: string) => {
    gg.__subs = []; gg.__marks = 0; gg.__party = 0;
    const { welcomeOnceSaved } = await liftWelcome(src);
    welcomeOnceSaved('يوسف النشوان', () => { gg.__party++; });
    const afterSave = gg.__marks + gg.__party;       // nothing yet: the name is not in the session
    emit('INITIAL_SESSION', 'يوسف النشوان', true);
    emit('USER_UPDATED', 'سارة', true);              // someone else's / an older write
    emit('USER_UPDATED', 'يوسف النشوان');            // the name landed, the «seen» write not yet (the home would still wait)
    const beforeOwn = gg.__marks + gg.__party;
    emit('USER_UPDATED', 'يوسف النشوان', true);      // the name AND «seen» are in the session
    const once = gg.__marks, party = gg.__party;
    emit('USER_UPDATED', 'يوسف النشوان', true);      // any later update
    return { afterSave, beforeOwn, once, party, total: gg.__marks + gg.__party, subs: gg.__subs.length };
  };
  const r = await run(files[PROMPT]);
  check('§6 the welcome waits for the saved name (nothing at the tap, nothing on other events)', r.afterSave === 0 && r.beforeOwn === 0, JSON.stringify(r));
  check('§6 …then exactly ONE headline welcome and ONE party, and it stops listening', r.once === 1 && r.party === 1 && r.total === 2 && r.subs === 0, JSON.stringify(r));
  mustCatch('a welcome that keeps listening (two welcomes)', (await run(files[PROMPT].replace('    stop();\n    markJustSignedIn();', '    markJustSignedIn();'))).total > 2);
  mustCatch('a welcome before the saved name is in the session (a nameless greeting)', (await run(files[PROMPT].replace(" || String(m.full_name ?? '') !== v", ''))).beforeOwn > 0);
  mustCatch('a welcome before «seen» lands (the home would still be waiting — no greeting)', (await run(files[PROMPT].replace(" || m.name_prompt_seen !== true", ''))).beforeOwn > 0);
  mustCatch('a welcome with no party', (await run(files[PROMPT].replace('    onWelcome();\n', ''))).party === 0);
  mustCatch('a welcome on any auth event', (await run(files[PROMPT].replace("event !== 'USER_UPDATED' || ", ''))).beforeOwn > 0);

  // §6.2 the SAME function a Google sign-in uses; after «حفظ» only; never «لاحقاً»; no celebration card.
  const AUTHPAGE = read('src/app/auth.tsx'), ONETAP = read('src/components/GoogleOneTap.tsx'), WELCOME = read('src/lib/useFilterWelcome.ts');
  const welcomeProblems = (p: string, w: string) => {
    const out: string[] = [];
    const code = p.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    if (!/import \{ markJustSignedIn, isFreshSignUp \} from '@\/lib\/loginWelcome';/.test(code) || (code.match(/markJustSignedIn\(\);/g) ?? []).length !== 2) out.push('not the sign-in welcome Google uses (markJustSignedIn) — in BOTH the «حفظ» and the «تخطي» welcome');
    if (!/markJustSignedIn\(\);/.test(AUTHPAGE) || !/markJustSignedIn\(\)/.test(ONETAP)) out.push('the Google paths no longer use markJustSignedIn');
    // the party: only after a NON-EMPTY «حفظ» (an empty one shakes and returns), never from «لاحقاً»
    if (!/if \(!v\) \{ setShakeN\(\(n\) => n \+ 1\); field\.current\?\.focus\(\); return; \}\n\s*saveName\(v\);\n\s*close\(\);\n\s*welcomeOnceSaved\(v, \(\) => startNamePartyFromBox\(reduced\)\);/.test(code)) out.push('the welcome + party do not follow a non-empty «حفظ»');
    // Owner 2026-10-26: the party starts from exactly two places — a non-empty «حفظ», and a sign-up that arrived WITH
    // a name (no box): «seen» first, then the same welcomeOnceSaved, gated by shouldPartyOnSignUp, once per account.
    if ((code.match(/welcomeOnceSaved\(v, /g) ?? []).length !== 1 || (code.match(/startNamePartyFromBox\(/g) ?? []).length !== 3) out.push('the welcome or the party is started from somewhere other than «حفظ», the named sign-up and «تخطي»');
    // «تخطي» on the SIGN-UP box of a nameless account (owner 2026-10-26: «with party it's fine»): welcomed as «ضيف إزهله»
    // once «seen» lands; never from the menu's reopen, and close() itself still fires nothing.
    if (!/const skip = \(\) => \{\n\s*const signUpBox = !reopened && !\(user\?\.name \?\? ''\)\.trim\(\);\n\s*close\(\);\n\s*if \(signUpBox\) welcomeOnceSkipped\(\(\) => startNamePartyFromBox\(reduced\)\);/.test(code)) out.push('«تخطي» is not close() + the guest welcome on the sign-up box only');
    if (!/const party = shouldPartyOnSignUp\(user, authChecked, authOpen, Date\.now\(\)\);/.test(code)
      || !/if \(!party \|\| !user \|\| partied\.current === user\?\.sub\) return;\n\s*partied\.current = user\?\.sub \?\? null;\n\s*const given = user\.name\.trim\(\);\n\s*markNamePromptSeen\(\);\n\s*welcomeOnceSaved\(given, \(\) => startNamePartyFromBox\(reduced\)\);/.test(code)) out.push('the named sign-up party is not «seen» + welcomeOnceSaved, once per account');
    const close = /const close = \(\) => \{[^\n]*\};/.exec(code)?.[0] ?? '';
    if (!close || /markJustSignedIn|welcomeOnceSaved|startNamePartyFromBox/.test(close)) out.push('«لاحقاً» (close) can fire the welcome or the party');
    if (/name-celebration|ConfettiOverlay|partyConfetti\(|Welcome, \{name\}/.test(code)) out.push('a separate celebration card is back');
    // a nameless sign-in gets NO greeting before the box (the home greets only a named session)
    if (!/if \(!session\.present \|\| session\.awaitingName \|\| !\(session\.nameAr \|\| session\.nameEn\) \|\| !hasJustSignedIn\(now\)\) return null;/.test(w)) out.push('the home could greet a nameless sign-in before the box');
    // …nor a Google sign-up before its box is answered (exactly one welcome: the one after «حفظ»)
    if (!/const awaitingName = isFreshSignUp\(u\?\.created_at, u\?\.last_sign_in_at, Date\.now\(\)\) && m\.name_prompt_seen !== true;/.test(w)) out.push('the home greets a Google sign-up before its box (two welcomes)');
    return out;
  };
  const wp = welcomeProblems(files[PROMPT], WELCOME);
  check('§6 after «حفظ» (and «تخطي» on the sign-up box): the Google sign-in welcome (markJustSignedIn), once; close() alone fires nothing; no celebration card', wp.length === 0, wp.join('; '));
  // A nameless account that pressed «تخطي» is «ضيف إزهله» in its greeting and facts (owner 2026-10-26) — only once the
  // box was answered (seen), so a sign-up whose box is still open is never greeted by the guest name.
  const guestOk = (w: string) => /if \(!base && m\.name_prompt_seen === true\) return \{ present: true, nameAr: 'ضيف إزهله', nameEn: 'Ezhalah Guest',/.test(w);
  check('§6 a skipped, nameless account is greeted and gets its facts as «ضيف إزهله» / Ezhalah Guest', guestOk(WELCOME));
  mustCatch('the guest name used before the box is answered', !guestOk(WELCOME.replace('if (!base && m.name_prompt_seen === true)', 'if (!base)')));
  mustCatch('the celebration card coming back', welcomeProblems(files[PROMPT].replace('<View style={s.prev}>', '<View testID="name-celebration" />\n              <View style={s.prev}>'), WELCOME).length > 0);
  mustCatch('a named sign-up partying on every render (no once-per-account guard)', welcomeProblems(files[PROMPT].replace('if (!party || !user || partied.current === user?.sub) return;', 'if (!party || !user) return;'), WELCOME).length > 0);
  mustCatch('a named sign-up party without recording «seen» (the home would wait forever)', welcomeProblems(files[PROMPT].replace('    const given = user.name.trim();\n    markNamePromptSeen();\n', '    const given = user.name.trim();\n'), WELCOME).length > 0);
  mustCatch('«تخطي» welcoming from the menu\'s reopen too (no sign-up-box guard)', welcomeProblems(files[PROMPT].replace("if (signUpBox) welcomeOnceSkipped", "welcomeOnceSkipped"), WELCOME).length > 0);
  mustCatch('a save with no welcome / party', welcomeProblems(files[PROMPT].replace('    welcomeOnceSaved(v, () => startNamePartyFromBox(reduced));\n', ''), WELCOME).length > 0);
  mustCatch('a party after an EMPTY «حفظ»', welcomeProblems(files[PROMPT].replace("if (!v) { setShakeN((n) => n + 1); field.current?.focus(); return; }", "if (!v) { setShakeN((n) => n + 1); startNamePartyFromBox(reduced); return; }"), WELCOME).length > 0);
  mustCatch('«لاحقاً» throwing the party', welcomeProblems(files[PROMPT].replace("markNamePromptSeen(); setPhase('leave');", "markNamePromptSeen(); startNamePartyFromBox(reduced); setPhase('leave');"), WELCOME).length > 0);
  mustCatch('the home greeting a Google sign-up BEFORE its box (two welcomes)', welcomeProblems(files[PROMPT], WELCOME.replace('!session.present || session.awaitingName || ', '!session.present || ')).length > 0);
  mustCatch('a home-made welcome instead of Google\'s (an event without the mark)', welcomeProblems(files[PROMPT].replace('    markJustSignedIn();\n    onWelcome();', "    globalThis.dispatchEvent(new Event('ezhalah:signed-in'));\n    onWelcome();"), WELCOME).length > 0);
  mustCatch('the home greeting a nameless Apple sign-in (a welcome BEFORE the box)', welcomeProblems(files[PROMPT], WELCOME.replace('session.awaitingName || !(session.nameAr || session.nameEn) || ', 'session.awaitingName || ')).length > 0);
  const i18nNow = read('src/i18n.tsx');
  check('§6 the box speaks both languages', /"We'll greet you by name and share a property fact every day": 'نرحّب فيك باسمك، ونعطيك معلومة عقارية كل يوم'/.test(i18nNow)
    && /'In English:': 'بالإنجليزي:'/.test(i18nNow) && /'In Arabic:': 'بالعربي:'/.test(i18nNow));

  // §6.3 the switch sets the field's direction and placeholder; it starts on the app's language.
  const switchProblems = (src: string) => {
    const out: string[] = [];
    if (!/const \[lang, setLang\] = useState<Lang>\(locale\);/.test(src)) out.push('the switch does not start on the app\'s language');
    if (!/onPress=\{\(\) => setLang\(l\.id\)\}/.test(src)) out.push('the switch is not wired');
    if (!/style=\{\[s\.input, focused && s\.inputFocus, lang === 'ar' \? s\.inputAr : s\.inputEn\]\}/.test(src)) out.push('the field\'s direction does not follow the switch');
    if (!/inputAr: \{ textAlign: 'right', writingDirection: 'rtl' \}/.test(src) || !/inputEn: \{ textAlign: 'left', writingDirection: 'ltr' \}/.test(src)) out.push('the two directions are not RTL / LTR');
    if (!/placeholder=\{translate\(lang, 'Type your name'\)\}/.test(src)) out.push('the placeholder does not follow the switch');
    if (!/\{ id: 'en', label: 'English' \}, \{ id: 'ar', label: 'عربي' \}/.test(src)) out.push('the switch is not English | عربي');
    return out;
  };
  const sp = switchProblems(files[PROMPT]);
  check('§6 the عربي | English switch sets the field direction and placeholder', sp.length === 0, sp.join('; '));
  mustCatch('the direction tied to the app language instead of the switch', switchProblems(files[PROMPT].replace("lang === 'ar' ? s.inputAr : s.inputEn", "locale === 'ar' ? s.inputAr : s.inputEn")).length > 0);
  mustCatch('an Arabic field stuck left-to-right', switchProblems(files[PROMPT].replace("inputAr: { textAlign: 'right', writingDirection: 'rtl' }", "inputAr: { textAlign: 'left', writingDirection: 'ltr' }")).length > 0);
  mustCatch('the placeholder stuck on the app language', switchProblems(files[PROMPT].replace("translate(lang, 'Type your name')", "t('Type your name')")).length > 0);
  mustCatch('the switch tap doing nothing', switchProblems(files[PROMPT].replace('onPress={() => setLang(l.id)}', 'onPress={() => {}}')).length > 0);

}

// ── §7 the FINAL box, mockups/name-box-v4.png (owner 2026-10-23) ─────────────────────────────────────
{
  // §7.1 EXECUTED: the live letter and the preview chip's freshness rule.
  const liftV4 = async (src: string) => {
    const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-v4-')), 'NamePrompt.tsx');
    writeFileSync(tmp, src);
    return (await liftSymbols(tmp, [{ header: 'export function letterOf(' }, { header: 'export function previewFor(' }], ['letterOf', 'previewFor'])) as {
      letterOf: (t: string) => string; previewFor: (p: { for: string; text: string } | null, t: string) => string;
    };
  };
  const { letterOf, previewFor } = await liftV4(files[PROMPT]);
  check('§7 the circle shows the first letter, live («ي» / "Y"), and nothing for an empty field',
    letterOf('يوسف النشوان') === 'ي' && letterOf(' yusuf') === 'Y' && letterOf('  ') === '');
  check('§7 the chip shows the spelling computed for exactly what is typed', previewFor({ for: 'يوسف', text: 'Yusuf' }, 'يوسف ') === 'Yusuf');
  check('§7 …never a stale one for an earlier input, and nothing while empty or loading',
    previewFor({ for: 'يوس', text: 'Yus' }, 'يوسف') === '' && previewFor(null, 'يوسف') === '' && previewFor({ for: 'يوسف', text: '' }, 'يوسف') === '');
  const staleV4 = await liftV4(files[PROMPT].replace('p && p.text && p.for === (typed ?? \'\').trim() ? p.text', 'p && p.text ? p.text'));
  mustCatch('a chip showing the spelling of an older input', staleV4.previewFor({ for: 'يوس', text: 'Yus' }, 'يوسف') !== '');

  const v4Problems = (f: Record<string, string>, ns: string) => {
    const out: string[] = [];
    const p = f[PROMPT];
    // the chip: the SAME source as the saved spelling, 400 ms after typing stops
    if (!/const PREVIEW_DEBOUNCE_MS = 400;/.test(p) || !/setTimeout\(\(\) => \{\n\s*otherSpelling\(v\)\.then\(\(text\) => \{ if \(live\) setPreview\(\{ for: v, text \}\); \}\)/.test(p)) out.push('the chip is not the debounced otherSpelling');
    if (!/const other = await otherSpelling\(v\);/.test(ns)) out.push('the saved spelling and the chip no longer share otherSpelling');
    if (!/const chip = previewFor\(preview, name\);/.test(p)) out.push('the chip skips the freshness rule');
    // «لاحقاً» small, ABOVE the full-width «حفظ» at the very bottom
    const later = p.indexOf('testID="name-prompt-later"'), save = p.indexOf('testID="name-prompt-save"');
    if (!(later > 0 && save > later)) out.push('«لاحقاً» is not above «حفظ»');
    if (!/<Text style=\{s\.saveText\}>\{tr\('Save'\)\}<\/Text>\n\s*<\/Pressable>\n\s*<\/View>/.test(p)) out.push('«حفظ» is not the last thing in the box');
    if (!/laterText: \{ color: '#9aa6a0', fontSize: 12/.test(p)) out.push('«لاحقاً» is not small muted text');
    // the switch flips the WHOLE box: direction and words
    if (!/style=\{\[s\.card, lang === 'ar' \? s\.rtl : s\.ltr\]\}/.test(p)) out.push('the box\'s direction does not follow the switch');
    if (!/const tr = \(en: string\) => translate\(lang, en\);/.test(p)) out.push('the box\'s words do not follow the switch');
    if (!/\? <Text key=\{letter\} style=\{s\.avatarText\} \{\.\.\.ds\(\{ ezhLetter: '1' \}\)\}>\{letter\}<\/Text>/.test(p) || !/const letter = letterOf\(name\);/.test(p)) out.push('the circle is not the live letter (popping on each new letter)');
    // «أضف اسمك ✏️» reopens the same box
    if (!/if \(!pickName\(user, locale\)\) \{ onClose\(\); openNamePrompt\(\); return; \}/.test(f[MENU])) out.push('«أضف اسمك» in the menu does not open the box');
    if (!/\{pickName\(user, locale\) \? '' : ' ✏️'\}/.test(f[MENU]) || !/!pickName\(user, locale\) && s\.addName/.test(f[MENU])) out.push('the menu row is not the green «أضف اسمك ✏️»');
    // the box becomes visible on a TIMER (rAF never fires in a background tab → an invisible overlay over the page)
    if (!/if \(phase !== 'enter'\) return;\n\s*const id = setTimeout\(\(\) => \{/.test(p) || /requestAnimationFrame/.test(p)) out.push('the box can stay invisible over the page (enter → on waits on requestAnimationFrame)');
    if (!/const shown = open \|\| \(reopened && !!user && !user\.name\.trim\(\)\);/.test(p) || !/if \(shown && \(phase === 'off' \|\| phase === 'leave'\)\) setPhase\('enter'\);/.test(p)) out.push('the box ignores the reopen');
    return out;
  };
  const NS = read('src/lib/nameSync.ts');
  const v4 = v4Problems(files, NS);
  check('§7 centered v4 box: live letter, debounced fresh chip, switch flips the box, «لاحقاً» above «حفظ», menu reopens it', v4.length === 0, v4.join('; '));
  mustCatch('«حفظ» above «لاحقاً» (the old order)', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('testID="name-prompt-later"', 'testID="__x"').replace('testID="name-prompt-save"', 'testID="name-prompt-later"').replace('testID="__x"', 'testID="name-prompt-save"') }, NS).length > 0);
  mustCatch('the box direction tied to the app language', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace("s.card, lang === 'ar' ? s.rtl : s.ltr", "s.card, locale === 'ar' ? s.rtl : s.ltr") }, NS).length > 0);
  mustCatch('the box words stuck on the app language', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('const tr = (en: string) => translate(lang, en);', 'const tr = (en: string) => t(en);') }, NS).length > 0);
  mustCatch('a chip with no debounce (a backend call per keystroke)', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('const PREVIEW_DEBOUNCE_MS = 400;', 'const PREVIEW_DEBOUNCE_MS = 0;') }, NS).length > 0);
  mustCatch('the save spelling drifting from the chip\'s source', v4Problems(files, NS.replace('const other = await otherSpelling(v);', 'const other = await transliterateName(v, "en");')).length > 0);
  mustCatch('the menu row opening the old pencil field instead of the box', v4Problems({ ...files, [MENU]: files[MENU].replace('if (!pickName(user, locale)) { onClose(); openNamePrompt(); return; } ', '') }, NS).length > 0);
  mustCatch('the enter → on step back on requestAnimationFrame (invisible box in a background tab)', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace("const id = setTimeout(() => {", "const id = requestAnimationFrame(() => {") }, NS).length > 0);
  mustCatch('a reopen the box never shows', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('const shown = open || (reopened && !!user && !user.name.trim());', 'const shown = open;') }, NS).length > 0);
  mustCatch('a static circle instead of the live letter', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('const letter = letterOf(name);', "const letter = '';") }, NS).length > 0);
}

// ── §8 the celebration is FIREWORKS (owner 2026-10-28, from the moving preview: «make it like fireworks, exploding … a
//     lot and quick … keep sending»): rockets every ~70 ms for 3.5 s across the whole width, one full-screen canvas,
//     «نورت» at the FIRST pop and the fact at the END (events), gone by PARTY_MS, never two stacked, no external script;
//     reduced motion → nothing (EXECUTED) ──────────────────────────────────────────────────────────────────────────────
{
  const PARTY = 'src/lib/nameParty.ts';
  const PRE8 = [
    'const g = globalThis as any;',
    "const Platform = { OS: 'web' };",
    'const ensureNameBoxCss = () => {};',
    'const Date = { now: () => g.__now };',
    'const setTimeout = (f: any, ms: number) => { g.__timers.push({ f, ms }); return 0; };',
    "const mk = () => { const el: any = { attrs: {} as Record<string, string>, kids: [] as any[], removed: false, setAttribute: (k: string, v: string) => { el.attrs[k] = v; }, appendChild: (c: any) => { el.kids.push(c); }, remove: () => { el.removed = true; } }; return el; };",
    'const document = { createElement: (t: string) => { const el = mk(); el.tag = t; g.__created.push(el); return el; }, body: { appendChild: (el: any) => { g.__appended.push(el); } } };',
    '',
  ].join('\n');
  type PartyMod = { startNameParty: (r: boolean) => void; startNamePartyFromBox: (r: boolean) => void; claimNameParty: () => () => void;
    launchEveryFor: (w: number) => number; LAUNCH_EVERY_MS: number; fireworksPlan: (rand?: () => number, every?: number) => { at: number; x: number; ty: number; c: string; c2: string }[];
    PARTY_MS: number; LAUNCH_FOR_MS: number; FIREWORK_COLORS: string[]; PARTY_GAP_MS: number;
    PARTY_FIRST_POP_EVENT: string; PARTY_END_EVENT: string; NAME_PARTY_EVENT: string };
  const liftParty = async (code: string) => {
    const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-party-')), 'nameParty.ts');
    writeFileSync(tmp, code);
    return (await liftSymbols(tmp, [
      { header: 'export const LAUNCH_FOR_MS', endsWith: /;$/ },
      { header: 'export const LAUNCH_EVERY_MS', endsWith: /;$/ },
      { header: 'export const launchEveryFor', endsWith: /;$/ },
      { header: 'export const SPARKS_PER_BURST', endsWith: /;$/ },
      { header: 'export const PARTY_MS', endsWith: /;$/ },
      { header: 'export const FIREWORK_COLORS', endsWith: /;$/ },
      { header: 'export const PARTY_FIRST_POP_EVENT', endsWith: /;$/ },
      { header: 'export const PARTY_END_EVENT', endsWith: /;$/ },
      { header: 'export const ROCKET_GRAVITY', endsWith: /;$/ },
      { header: 'export const OPENING_MS', endsWith: /;$/ },
      { header: 'export const OPENING_HOP', endsWith: /;$/ },
      { header: 'export function fireworksPlan(' },
      { header: 'export const PARTY_GAP_MS', endsWith: /;$/ },
      { header: 'export const NAME_PARTY_EVENT', endsWith: /;$/ },
      { header: 'let lastParty', endsWith: /;$/ },
      { header: 'let heroOwners', endsWith: /;$/ },
      { header: 'export function claimNameParty(' },
      { header: 'export function startNamePartyFromBox(' },
      { header: 'export function startNameParty(' },
    ], ['startNameParty', 'startNamePartyFromBox', 'claimNameParty', 'fireworksPlan', 'launchEveryFor', 'LAUNCH_EVERY_MS', 'PARTY_MS', 'LAUNCH_FOR_MS', 'FIREWORK_COLORS', 'PARTY_GAP_MS',
        'PARTY_FIRST_POP_EVENT', 'PARTY_END_EVENT', 'NAME_PARTY_EVENT', 'ROCKET_GRAVITY', 'OPENING_MS', 'OPENING_HOP'], PRE8)) as PartyMod;
  };
  // one module instance, parties started at the given clock times; returns what each start drew and said
  const run = async (code: string, starts: { at: number; reduced: boolean; box?: boolean; heroOn?: boolean }[]) => {
    const g = globalThis as any;
    Object.assign(g, { __now: 0, __timers: [], __created: [], __appended: [], __events: [] });
    const hadDispatch = g.dispatchEvent;
    g.dispatchEvent = (e: Event) => { g.__events.push(e.type); return true; };
    const P = await liftParty(code);
    const shots = starts.map(({ at, reduced, box, heroOn }) => {
      const before = g.__appended.length; g.__timers = []; g.__events = []; g.__now = at;
      const release = heroOn ? P.claimNameParty() : null;
      if (box) P.startNamePartyFromBox(reduced); else P.startNameParty(reduced);
      release?.();
      const layer = g.__appended.slice(before).find((el: any) => 'data-ezh-party' in el.attrs) ?? null;
      const said = [...g.__events];
      let removeAt: number | null = null, endSaid = false;
      if (layer) for (const t of g.__timers) { const was = layer.removed; const ev0 = g.__events.length; t.f(); if (layer.removed && !was) { removeAt = t.ms; endSaid = g.__events.slice(ev0).includes(P.PARTY_END_EVENT); break; } }
      return { drew: g.__appended.length > before, layer, canvas: !!layer && layer.kids.some((k: any) => k.tag === 'canvas'), removeAt, endSaid, said };
    });
    g.dispatchEvent = hadDispatch;
    return { P, shots };
  };
  const SRC = read(PARTY);
  const one = (await run(SRC, [{ at: 0, reduced: false }])).shots[0];
  const P8 = (await run(SRC, [])).P;
  // the launch plan, executed with a seeded random
  let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const planOk = (P: PartyMod) => { const r = P.fireworksPlan(rand);
    return r.length >= 70 && r[r.length - 1].at >= 3000 && r[r.length - 1].at < P.LAUNCH_FOR_MS && r.every((x, i) => i === 0 || x.at >= r[i - 1].at)
      && r.every((x) => x.x >= 0.06 && x.x <= 0.94 && x.ty >= 0.06 && x.ty <= 0.6) && Math.min(...r.map((x) => x.x)) < 0.2 && Math.max(...r.map((x) => x.x)) > 0.8; };
  check('§8 a LOT of fireworks, quick and non-stop: 70+ rockets over 3+ seconds, spread across the whole width and height', planOk(P8));
  const laptopFull = (P: PartyMod) => P.launchEveryFor(1440) < P.LAUNCH_EVERY_MS && P.launchEveryFor(1440) >= 0.6 * P.LAUNCH_EVERY_MS && P.launchEveryFor(390) === P.LAUNCH_EVERY_MS;
  check('§8 a laptop gets proportionally more rockets than a phone (the full laptop screen fills too), bounded', laptopFull(P8));
  // SOONER (owner 2026-10-29 «the fireworks come up a bit late»): the first pop within ~0.4 s on a phone — the opening
  // volley starts OPENING_HOP of the screen below its burst point and climbs at ROCKET_GRAVITY.
  const firstPopMs = (P: PartyMod) => { const H = 812, d = (P as any).OPENING_HOP * H, g = (P as any).ROCKET_GRAVITY; return Math.sqrt((2 * d) / g) * 16.7; };
  const soon = (P: PartyMod, src: string) => (P as any).OPENING_MS >= 100 && firstPopMs(P) <= 400
    && /y: r\.at < OPENING_MS \? \(r\.ty \+ OPENING_HOP\) \* H : H \+ 10/.test(src) && /r\.vy \+= ROCKET_GRAVITY \* dt;/.test(src);
  check(`§8 the first pop lands fast (${Math.round(firstPopMs(P8))} ms on a phone): an opening volley that starts high, rockets that climb quick`, soon(P8, SRC));
  const slowSrc = SRC.replace('export const OPENING_HOP = 0.09;', 'export const OPENING_HOP = 0.9;');
  mustCatch('the first pop coming late again (a full climb from the bottom)', !soon((await run(slowSrc, [])).P, slowSrc));
  mustCatch('a laptop as sparse as a phone', !laptopFull((await run(SRC.replace('Math.max(0.6, 500 / (width || 500))', 'Math.max(1, 500 / (width || 500))'), [])).P));
  check('§8 …in party colours (several hues, Ezhalah green and gold among them)', new Set(P8.FIREWORK_COLORS).size >= 6 && P8.FIREWORK_COLORS.includes('#2f7247') && P8.FIREWORK_COLORS.includes('#d8b14a'));
  check('§8 a celebration draws ONE full-screen canvas layer and tells the headline: the party started, then the first pop',
    !!one.layer && one.canvas && one.said[0] === P8.NAME_PARTY_EVENT && one.said.includes(P8.PARTY_FIRST_POP_EVENT), JSON.stringify(one.said));
  check('§8 the layer is gone by PARTY_MS at the latest, and going it tells the headline the fireworks are over (→ the fact)',
    one.removeAt === P8.PARTY_MS && one.endSaid && P8.PARTY_MS >= 5000 && P8.PARTY_MS <= 8000, JSON.stringify({ removeAt: one.removeAt, ms: P8.PARTY_MS }));
  const fullScreen = (code: string) => /\[data-ezh-party\]\{position:fixed;inset:0;/.test(code) && code.includes('[data-ezh-party] canvas{position:absolute;inset:0;width:100%;height:100%}');
  check('§8 it covers the whole screen on any device (fixed layer, canvas fills it)', fullScreen(SRC));
  const still = (await run(SRC, [{ at: 0, reduced: true }])).shots[0];
  check('§8 reduced motion → nothing is drawn at all', !still.drew && !still.layer);
  const twice = (await run(SRC, [{ at: 0, reduced: false }, { at: 1000, reduced: false }, { at: 20000, reduced: false }])).shots;
  check('§8 a second celebration within PARTY_GAP_MS is skipped (sign-up box and sign-in never stack), a later one plays', twice[0].drew && !twice[1].drew && twice[2].drew);
  // judged on CODE, not prose
  const noExternal = (code: string) => !/createElement\(['"]script['"]\)|https?:\/\/|data-ezh-disco|data-ezh-rain/i.test(code.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ''));
  check('§8 no external script, no disco lights, no leftover rain layer in the module', noExternal(SRC));
  mustCatch('fireworks that are never cleared', (await run(SRC.replace('  setTimeout(finish, PARTY_MS);\n', ''), [{ at: 0, reduced: false }])).shots[0].removeAt === null);
  mustCatch('an end the headline never hears (the fact would wait for its fallback)', !(await run(SRC.replace('layer.remove(); say(PARTY_END_EVENT);', 'layer.remove();'), [{ at: 0, reduced: false }])).shots[0].endSaid);
  mustCatch('a thin show (a rocket every 400 ms)', !planOk((await run(SRC.replace('export const LAUNCH_EVERY_MS = 35;', 'export const LAUNCH_EVERY_MS = 400;'), [])).P));
  mustCatch('a short burst instead of non-stop (1 s)', !planOk((await run(SRC.replace('export const LAUNCH_FOR_MS = 3500;', 'export const LAUNCH_FOR_MS = 1000;'), [])).P));
  mustCatch('a layer that is not full screen', !fullScreen(SRC.replace('[data-ezh-party]{position:fixed;inset:0;', '[data-ezh-party]{position:absolute;top:0;height:40vh;')));
  mustCatch('fireworks under reduced motion', (await run(SRC.replace('if (reduced || ', 'if ('), [{ at: 0, reduced: true }])).shots[0].drew);
  mustCatch('two celebrations stacking', (await run(SRC.replace('if (now - lastParty < PARTY_GAP_MS) return;', ''), [{ at: 0, reduced: false }, { at: 1000, reduced: false }])).shots[1].drew);
  mustCatch('the disco lights coming back', !noExternal(SRC.replace('[data-ezh-party]{position:fixed', '[data-ezh-disco]{opacity:1}\n[data-ezh-party]{position:fixed')));
  const passOk = (p: string, css: string) => /const reduced = useReducedMotion\(\);/.test(p)
    && (p.match(/startNamePartyFromBox\(/g) ?? []).length > 0 && (p.match(/startNamePartyFromBox\(/g) ?? []).length === (p.match(/startNamePartyFromBox\(reduced\)/g) ?? []).length
    && !/startNameParty\(/.test(p)
    && css.includes('@media (prefers-reduced-motion:reduce){[data-ezh-scrim],[data-ezh-scrim] *,[data-ezh-shine]{animation:none!important;transition:none!important}[data-ezh-party]{display:none}}');
  check('§8 the box hands the real reduced-motion flag to the party, and the CSS stills every motion (fireworks hidden)', passOk(files[PROMPT], SRC));
  mustCatch('the party told motion is fine regardless', !passOk(files[PROMPT].replace('startNamePartyFromBox(reduced)', 'startNamePartyFromBox(false)'), SRC));
  // ONE confetti per sign-in (owner 2026-10-27: «it shows twice»): while the home's falconer is on screen the name box's
  // trigger draws nothing (he starts it after his story); with no falconer the box still gives the party. EXECUTED.
  const boxWithHero = (await run(SRC, [{ at: 0, reduced: false, box: true, heroOn: true }])).shots[0];
  const boxAlone = (await run(SRC, [{ at: 0, reduced: false, box: true }])).shots[0];
  check('§8 the name box draws no fireworks while the falconer is on screen (his come after his story); alone it still does', !boxWithHero.drew && boxAlone.drew);
  mustCatch('the box firing its own confetti on top of the falconer\'s', (await run(SRC.replace('  if (heroOwners > 0) return;\n', ''), [{ at: 0, reduced: false, box: true, heroOn: true }])).shots[0].drew);
  mustCatch('the box calling the raw party again', !passOk(files[PROMPT].replace('startNamePartyFromBox(reduced)', 'startNameParty(reduced)'), SRC));
  const heroSrc = read('src/components/HeroFalconer.tsx');
  const heroClaims = (c: string) => c.includes('useEffect(() => claimNameParty(), []);');
  check('§8 the falconer claims the confetti while he is mounted', heroClaims(heroSrc));
  mustCatch('a falconer that never claims it', !heroClaims(heroSrc.replace('useEffect(() => claimNameParty(), []);', '')));
}

// ── §9 owner P1s 2026-10-24: both spellings stored · never the other script in a sentence · the name
//     bidi-isolated · one paint on refresh · the «seen» flag only from «حفظ» / «لاحقاً» ───────────────────
{
  const NS9 = 'src/lib/nameSync.ts', FW = 'src/lib/filterWelcome.ts', UFW = 'src/lib/useFilterWelcome.ts', STORE = 'src/store.tsx', HOME = 'src/app/index.tsx';
  const src9: Record<string, string> = { [AUTH]: files[AUTH], [NS9]: read(NS9), [FW]: read(FW), [UFW]: read(UFW), [STORE]: read(STORE), [HOOK]: files[HOOK], [HOME]: read(HOME), [PROMPT]: files[PROMPT] };
  const liftFrom = async (name: string, code: string, syms: { header: string; endsWith?: RegExp }[], names: string[], pre: string) => {
    const tmp = join(mkdtempSync(join(tmpdir(), 'ezh-p1-')), name);
    writeFileSync(tmp, code);
    return liftSymbols(tmp, syms, names, pre) as Promise<any>;
  };
  const g9 = globalThis as any;
  // the real name helpers (pickName → sentenceName), with the phonetic table stubbed
  const names9 = (f: Record<string, string>) => liftFrom('nameSync.ts', f[NS9], [
    { header: 'export function scriptOf(' }, { header: 'export function pickName(' }, { header: 'export function sentenceName(' },
  ], ['scriptOf', 'pickName', 'sentenceName'], `type Locale = 'ar' | 'en';\nconst phoneticAr = (s: string, _x?: boolean) => (globalThis as any).__phon(s);\n`);
  // the real mapSupabaseUser
  const map9 = (f: Record<string, string>) => liftFrom('auth.ts', f[AUTH], [
    { header: 'function initialsFrom(' }, { header: 'export function mapSupabaseUser(' },
  ], ['mapSupabaseUser'], `type AuthUser = any;\n`);
  // the real readStoredSession (what the headline reads at first paint)
  const stored9 = (f: Record<string, string>) => liftFrom('useFilterWelcome.ts', f[UFW], [{ header: 'function readStoredSession(' }], ['readStoredSession'],
    `type StoredSession = any;\nconst g = globalThis as any;\nconst sentenceName = (u: any, l: any) => g.__sentence(u, l);\nconst isFreshSignUp = () => false;\n`);
  const fill9 = (f: Record<string, string>) => liftFrom('filterWelcome.ts', f[FW], [{ header: 'export const NAME_SLOT', endsWith: /;$/ }, { header: 'export function fillName(' }], ['fillName', 'NAME_SLOT'], '');

  // A refresh: the stored session (first paint), then the store's user (after the restore). Same text, no translit.
  const meta = { full_name: 'يوسف النشوان', name: 'يوسف النشوان', nameAr: 'يوسف النشوان', nameEn: 'Yusuf AlNashwan', name_spellings_for: 'يوسف النشوان' };
  const refresh = async (f: Record<string, string>, m: any = meta) => {
    const N = await names9(f); g9.__phon = () => ''; g9.__sentence = N.sentenceName;
    const M = await map9(f), S = await stored9(f), F = await fill9(f);
    const store = new Map<string, string>([['sb-x-auth-token', JSON.stringify({ user: { id: 'u1', user_metadata: m } })]]);
    (globalThis as any).localStorage = { length: store.size, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null };
    const first = S.readStoredSession();                                   // paint 1: device storage only
    const user = M.mapSupabaseUser({ email: 'x@privaterelay.appleid.com', user_metadata: m }, 'apple'); // paint 2: the restored user
    const line = `Hi ${F.NAME_SLOT}, the market moves every day.`;
    return { en1: F.fillName(line, first.nameEn, 'en'), en2: F.fillName(line, N.sentenceName(user, 'en') || first.nameEn, 'en'), user, N, F };
  };
  const r9 = await refresh(src9);
  check('§9 a refresh paints the English greeting ONCE, with the English spelling, no translit (both spellings stored)',
    r9.en1 === 'Hi ⁨Yusuf⁩, the market moves every day.' && r9.en2 === r9.en1 && r9.user.nameEn === 'Yusuf AlNashwan' && r9.user.nameAr === 'يوسف النشوان', JSON.stringify([r9.en1, r9.en2]));
  mustCatch('mapSupabaseUser not reading the stored spellings (translit on every load; the line changes when it answers)', !(await refresh({ ...src9, [AUTH]: src9[AUTH].replace("const spelled = !!name && String(meta.name_spellings_for ?? '') === name;", 'const spelled = false;') })).user.nameEn);
  const stale = await refresh(src9, { ...meta, name_spellings_for: 'خالد' });
  check('§9 spellings stored for a PREVIOUS name are ignored (never another name in the line)', !stale.user.nameEn && stale.en1 === null, JSON.stringify([stale.user.nameEn, stale.en1]));
  // never the other script inside a sentence
  const N = r9.N, F = r9.F;
  check('§9 an Arabic-only name never goes into an English sentence («يوسف, the market…»)', N.sentenceName({ name: 'يوسف' }, 'en') === '' && F.fillName('Hi ⟦n⟧, x', 'يوسف', 'en') === null);
  check('§9 …and a Latin-only name never into an Arabic one', N.sentenceName({ name: 'Yusuf' }, 'ar') === '' && F.fillName('هلا ⟦n⟧', 'Yusuf', 'ar') === null);
  check('§9 the right spelling is used when it is known', N.sentenceName({ name: 'يوسف', nameEn: 'Yusuf' }, 'en') === 'Yusuf' && N.sentenceName({ name: 'Yusuf', nameAr: 'يوسف' }, 'ar') === 'يوسف');
  mustCatch('sentenceName falling back to the other script (pickName as-is)', (await names9({ ...src9, [NS9]: src9[NS9].replace('return wrongScript ? \'\' : n;', 'return n;') })).sentenceName({ name: 'يوسف' }, 'en') !== '');
  mustCatch('fillName letting an Arabic name into an English line', (await fill9({ ...src9, [FW]: src9[FW].replace(" || (locale === 'en' && /[\\u0600-\\u06FF]/.test(first))", '') })).fillName('Hi ⟦n⟧, x', 'يوسف', 'en') !== null);
  // the name is isolated; the headline has an explicit direction
  check('§9 the name is bidi-isolated (U+2068 … U+2069) in both languages', F.fillName('Hi ⟦n⟧, x', 'Yusuf', 'en') === 'Hi ⁨Yusuf⁩, x' && F.fillName('هلا ⟦n⟧، x', 'يوسف', 'ar') === 'هلا ⁨يوسف⁩، x');
  mustCatch('a bare name (punctuation can jump across it)', (await fill9({ ...src9, [FW]: src9[FW].replace('join(`\\u2068${first}\\u2069`)', 'join(first)') })).fillName('Hi ⟦n⟧, x', 'Yusuf', 'en') !== 'Hi ⁨Yusuf⁩, x');
  const dirOk = (h: string) => /dir: locale === 'ar' \? 'rtl' : 'ltr'/.test(h) && /useFilterWelcome\(!!user, sentenceName\(user, locale\)/.test(h);
  check('§9 the headline carries the UI direction and a sentence name', dirOk(src9[HOME]));
  mustCatch('the headline with no explicit direction', !dirOk(src9[HOME].replace("dir: locale === 'ar' ? 'rtl' : 'ltr'", "dir: 'auto'")));

  // both spellings PERSISTED: on every save, and once on the backfill; a spelling for a replaced name is skipped
  const liftPersist = (code: string) => liftFrom('auth.ts', code, [
    { header: 'let nameWriteQueue: Promise<unknown> = Promise.resolve();', endsWith: /;$/ },
    { header: 'let latestIntendedName: string | null = null;', endsWith: /;$/ },
    { header: 'export function persistDisplayName(v: string): void {', endsWith: /^\}$/ },
    { header: 'export function persistNameSpellings(', endsWith: /^\}$/ },
  ], ['persistNameSpellings', 'persistDisplayName'], `const NAME_WRITE_TIMEOUT_MS = 300;\nconst supabase = { auth: { updateUser: async (p: any) => { (globalThis as any).__w.push(p.data); return {}; } } };\n`);
  const writes = async (code: string) => {
    const P = await liftPersist(code);
    g9.__w = [];
    P.persistDisplayName('يوسف');
    P.persistNameSpellings({ name: 'يوسف', nameAr: 'يوسف', nameEn: 'Yusuf' });
    await new Promise((r) => setTimeout(r, 30));
    const saved = [...g9.__w];
    P.persistDisplayName('خالد');
    P.persistNameSpellings({ name: 'يوسف', nameAr: 'يوسف', nameEn: 'Yusuf' });   // a late answer for the replaced name
    await new Promise((r) => setTimeout(r, 30));
    return { saved, late: g9.__w.slice(saved.length) as any[] };
  };
  const w9 = await writes(src9[AUTH]);
  check('§9 the spellings are written with the name they belong to', w9.saved.some((d: any) => d.nameEn === 'Yusuf' && d.nameAr === 'يوسف' && d.name_spellings_for === 'يوسف'), JSON.stringify(w9));
  check('§9 …and a late spelling for a name the user already replaced is skipped', !w9.late.some((d: any) => d.name_spellings_for === 'يوسف'), JSON.stringify(w9.late));
  mustCatch('a late spelling overwriting the new name\'s (no supersede check)', (await writes(src9[AUTH].replace('      if (latestIntendedName !== null && latestIntendedName !== s.name) return; // superseded by a newer name\n', ''))).late.some((d: any) => d.name_spellings_for === 'يوسف'));
  const persistOk = (f: Record<string, string>) =>
    /buildSyncedName\(v\)\.then\(\(synced\) => \{ applySyncedName\(\{ \.\.\.synced, initials: initialsOf\(v\) \}\); persistNameSpellings\(synced\); \}\);/.test(f[HOOK])
    && /buildSyncedName\(nm\)\.then\(\(synced\) => \{ if \(!cancelled\) \{ applySyncedName\(synced\); persistNameSpellings\(synced\); \} \}\);/.test(f[STORE])
    && /if \(!nm \|\| \(user\?\.nameEn && user\?\.nameAr\)\) return;/.test(f[STORE]);
  check('§9 spellings persisted on every save (box, pencil, Apple) and on the backfill, which skips a user who has both', persistOk(src9));
  mustCatch('a save that keeps the spellings in memory only', !persistOk({ ...src9, [HOOK]: src9[HOOK].replace(' persistNameSpellings(synced); });', ' });') }));
  mustCatch('a backfill that never stores what it generated (translit on every load)', !persistOk({ ...src9, [STORE]: src9[STORE].replace(' persistNameSpellings(synced); } });', ' } });') }));
  // a re-map never drops spellings of the same name (the «Yusuf» → «يوسف» flip)
  const { keepSpellings } = await liftFrom('store.tsx', src9[STORE], [{ header: 'export function keepSpellings(' }], ['keepSpellings'], 'type AuthUser = any;\n');
  const kept = keepSpellings({ name: 'يوسف', nameEn: 'Yusuf', nameAr: 'يوسف' }, { name: 'يوسف' });
  check('§9 an auth re-map keeps this tab\'s spellings of the same name; a new name starts clean',
    kept.nameEn === 'Yusuf' && !keepSpellings({ name: 'يوسف', nameEn: 'Yusuf' }, { name: 'خالد' }).nameEn);
  const remapOk = (st: string) => /setUser\(\(prev\) => keepSpellings\(prev, mapSupabaseUser\(su, method\)\)\);/.test(st);
  check('§9 the auth listener re-maps through keepSpellings', remapOk(src9[STORE]));
  mustCatch('a re-map that drops the spellings (the flip on tab focus)', !remapOk(src9[STORE].replace('setUser((prev) => keepSpellings(prev, mapSupabaseUser(su, method)));', 'setUser(mapSupabaseUser(su, method));')));

  // the «seen» flag: ONLY «حفظ» or «لاحقاً» (owner P1: a Google sign-up was marked seen 3.4 s after the callback)
  const seenProblems = (f: Record<string, string>, extra: Record<string, string> = {}) => {
    const out: string[] = [];
    const all = { ...walkSrc(), ...extra };
    for (const [file, text] of Object.entries(all)) {
      const code = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n');
      if (file !== AUTH && /name_prompt_seen: true/.test(code)) out.push(`${file} writes name_prompt_seen itself`);
      if (file !== PROMPT && file !== AUTH && /markNamePromptSeen\(/.test(code)) out.push(`${file} marks the box seen`);
    }
    const p = f[PROMPT].split('\n').filter((l) => !/^\s*(\/\/|\{\/\*)/.test(l)).join('\n');
    // Two writers only: close() (Save / Skip), and the sign-up that arrived WITH a name and so never gets the box
    // (owner 2026-10-26), gated by shouldPartyOnSignUp. Any third write (e.g. inside the box's prefill) is RED.
    if ((p.match(/markNamePromptSeen\(\)/g) ?? []).length !== 2 || !/const close = \(\) => \{ setClosed\(true\); setReopened\(false\); markNamePromptSeen\(\);/.test(p)
      || !/if \(!party \|\| !user \|\| partied\.current === user\?\.sub\) return;\n\s*partied\.current = user\?\.sub \?\? null;\n\s*const given = user\.name\.trim\(\);\n\s*markNamePromptSeen\(\);/.test(p)) out.push('the seen write is not only in close() and the named sign-up');
    const closeUses = (p.match(/\bclose\b(?!\s*=)/g) ?? []).length;
    if (!/testID="name-prompt-later" style=\{s\.later\} onPress=\{skip\}/.test(p) || !/\n\s*close\(\);\n\s*welcomeOnceSaved/.test(p) || closeUses !== 2) out.push(`close() is reachable from something other than «لاحقاً» / «حفظ» (${closeUses} uses)`);
    return out;
  };
  const walkSrc = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) out[p] = read(p); } };
    walk('src');
    return out;
  };
  const sp9 = seenProblems(files);
  check('§9 the «seen» flag is written ONLY by «حفظ» / «تخطي», or by a sign-up that already has a name (no tap-outside, no other path)', sp9.length === 0, sp9.join('; '));
  mustCatch('a tap outside the box marking it seen (the Google sign-up P1)', seenProblems({ ...files, [PROMPT]: files[PROMPT].replace('<View style={[s.card,', '<Pressable style={StyleSheet.absoluteFill} onPress={close} />\n      <View style={[s.card,') }).length > 0);
  mustCatch('a "has a name → mark seen" shortcut', seenProblems({ ...files, [PROMPT]: files[PROMPT].replace('    setName(given);\n', '    setName(given);\n    if (given) markNamePromptSeen();\n') }).length > 0);
  mustCatch('another file writing the flag (e.g. the /auth landing)', seenProblems(files, { 'src/app/auth.tsx': read('src/app/auth.tsx').replace('markJustSignedIn();', 'markJustSignedIn(); supabase.auth.updateUser({ data: { name_prompt_seen: true } });') }).length > 0);
}

// ── §4 one writer: NamePrompt, AccountMenu and AuthModal all save through useSaveName ───────────────
const writerProblems = (f: Record<string, string>) => {
  const out: string[] = [];
  if (!/const saveName = useSaveName\(\);/.test(f[PROMPT]) || !/saveName\(v\);/.test(f[PROMPT])) out.push('NamePrompt does not save via useSaveName');
  if (!/const persistName = useSaveName\(\);/.test(f[MENU])) out.push('the pencil rename is not useSaveName');
  for (const p of [PROMPT, MENU, MODAL]) {
    const code = f[p].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    if (/\b(persistDisplayName|buildSyncedName|applySyncedName|updateUser)\s*\(/.test(code)) out.push(`${p} writes the name itself instead of useSaveName`);
  }
  if (!/persistDisplayName\(v\);/.test(f[HOOK]) || !/applySyncedName\(/.test(f[HOOK])) out.push('useSaveName lost the persist/translit steps');
  return out;
};
{
  const p = writerProblems(files);
  check('§4 the prompt\'s Save is the pencil rename\'s own path', p.length === 0, p.join('; '));
  mustCatch('the prompt writing user_metadata directly', writerProblems({ ...files, [PROMPT]: files[PROMPT].replace('saveName(v);', 'persistDisplayName(v);') }).length > 0);
  mustCatch('the prompt patching the store directly', writerProblems({ ...files, [PROMPT]: files[PROMPT].replace('saveName(v);', 'updateUser({ name: v });') }).length > 0);
  mustCatch('the rename forking its own copy again', writerProblems({ ...files, [MENU]: files[MENU].replace('const persistName = useSaveName();', 'const persistName = (v: string) => persistDisplayName(v);') }).length > 0);
}

// ── §5 flag OFF = today's redirect, byte for byte ───────────────────────────────────────────────────
// sha256 of the pre-change texts (origin/main 2026-10-23): signInWithProvider, and onAppleContinue
// with the flagged block removed. A change to either must update this pin on purpose.
// Re-pinned 2026-10-24 on purpose: signInWithProvider now hands the language on screen to the /auth landing
// (rememberLocaleForSignIn, verify-language-survives-sign-in.ts) before the SAME redirect call — unchanged.
// Re-pinned 2026-10-24 (2) on purpose: signInWithProvider marks the sidebar eagle's one light-up (markEagleLightUp,
// verify-eagle-lights-up-once.ts) before the SAME redirect call — unchanged.
const PIN_PROVIDER = '5d3168c99c4635cb1668ebaea68be9d85acf1f14efdd27f7dc8127b7dc3f0b45';
const PIN_APPLE = 'b92d8266e4122734558bf9687519eb3c8380a55c799c37f12ebe50d2f497f1e6';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const between = (src: string, head: string, end: string) => {
  const i = src.indexOf(head);
  if (i < 0) return '';
  const j = src.indexOf(end, i);
  return j < 0 ? '' : src.slice(i, j + end.length);
};
const providerText = (a: string) => between(a, 'export async function signInWithProvider(', '\n}\n');
const appleText = (m: string) => between(m, '  const onAppleContinue = async () => {', '\n  };\n').replace(appleBlock(m), '');
const flagProblems = (f: Record<string, string>) => {
  const out: string[] = [];
  if (sha(providerText(f[AUTH])) !== PIN_PROVIDER) out.push('signInWithProvider changed');
  if (sha(appleText(f[MODAL])) !== PIN_APPLE) out.push('onAppleContinue (outside the flagged block) changed');
  if (!/export const APPLE_JS_SIGNIN = process\.env\.EXPO_PUBLIC_APPLE_JS_SIGNIN !== '0';/.test(f[AUTH])) out.push('the flag is not on-by-default with a "0" off switch (owner 2026-10-26)');
  if (!/if \(APPLE_JS_SIGNIN && isBackendLive && Platform\.OS === 'web'\) void prepareAppleJs\(\);/.test(f[MODAL])) out.push('Apple\'s script loads with the flag off');
  const outside = f[MODAL].replace(appleBlock(f[MODAL]), '');
  if (/signInWithAppleJs\(/.test(outside)) out.push('signInWithAppleJs is reachable outside the flagged block');
  return out;
};
{
  const p = flagProblems(files);
  check('§5 the Apple popup is on (owner 2026-10-26), the redirect is unchanged and still the fallback', p.length === 0, p.join('; '));
  mustCatch('the redirect itself edited', flagProblems({ ...files, [AUTH]: files[AUTH].replace("options: { redirectTo, queryParams }", "options: { redirectTo, queryParams, skipBrowserRedirect: true }") }).length > 0);
  mustCatch('the Apple JS path made unconditional', flagProblems({ ...files, [MODAL]: files[MODAL].replace('        if (APPLE_JS_SIGNIN) {', '        if (true) {') }).length > 0);
  mustCatch('the flag back to off-by-default (Apple names lost again)', flagProblems({ ...files, [AUTH]: files[AUTH].replace("!== '0';", "=== '1';") }).length > 0);
  mustCatch('Apple\'s script preloaded for everyone', flagProblems({ ...files, [MODAL]: files[MODAL].replace('if (APPLE_JS_SIGNIN && isBackendLive', 'if (isBackendLive') }).length > 0);
  mustCatch('the fallback redirect removed after a JS failure', flagProblems({ ...files, [MODAL]: files[MODAL].replace("        const r = await signInWithProvider('apple');", "        return;") }).length > 0);
}

console.log(failures === 0 ? '\nOK — Apple\'s name is kept, a missing one is asked for once, never invented.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
