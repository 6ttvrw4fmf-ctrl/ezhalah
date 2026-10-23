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

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { liftSymbols } from './lib/liftSymbols.ts';

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
  const { shouldAskName } = await liftSymbols(PROMPT, [{ header: 'export function shouldAskName(' }], ['shouldAskName'],
    'const isBackendLive = true;\ntype AuthUser = any;\n') as { shouldAskName: (u: any, checked: boolean, open: boolean) => boolean };
  const u = (name: string, seen?: boolean) => ({ method: 'apple', name, initials: '', sub: 'a@b.c', namePromptSeen: seen });
  const table: [string, boolean][] = [
    ['empty name, not seen → ASK', shouldAskName(u(''), true, false) === true],
    ['whitespace name counts as empty → ASK', shouldAskName(u('  '), true, false) === true],
    ['a user with a name → never', shouldAskName(u('Sara'), true, false) === false],
    ['already seen → never again', shouldAskName(u('', true), true, false) === false],
    ['a guest → never', shouldAskName(null, true, false) === false],
    ['before the session is restored → not yet', shouldAskName(u(''), false, false) === false],
    ['while the sign-in popup is open → not yet', shouldAskName(u(''), true, true) === false],
  ];
  for (const [l, ok] of table) check(`§3 ${l}`, ok);
  const p3 = (src: string) => /!user\.name\.trim\(\) && !user\.namePromptSeen/.test(src) && /!!user/.test(src);
  check('§3 the predicate reads the name AND the seen flag', p3(files[PROMPT]));
  mustCatch('the seen flag ignored (asked on every load)', !p3(files[PROMPT].replace(' && !user.namePromptSeen', '')));
  mustCatch('asked even when a name exists', !p3(files[PROMPT].replace('!user.name.trim() && ', '')));
  const flagOk = (a: string) => /namePromptSeen: meta\.name_prompt_seen === true/.test(a) && /data: \{ name_prompt_seen: true \}/.test(a);
  check('§3 the seen flag lives in user_metadata (follows the account across devices)', flagOk(files[AUTH]));
  mustCatch('the flag not read back from user_metadata', !flagOk(files[AUTH].replace('namePromptSeen: meta.name_prompt_seen === true', 'namePromptSeen: false')));
  const closeOk = (src: string) => /const close = \(\) => \{ setClosed\(true\); markNamePromptSeen\(\); \};/.test(src) && /onPress=\{close\}/.test(src);
  check('§3 «لاحقاً» and Save both mark it seen', closeOk(files[PROMPT]) && /saveName\(v\);\n\s*close\(\);/.test(files[PROMPT]));
  mustCatch('«لاحقاً» not recording that it was shown', !closeOk(files[PROMPT].replace(' markNamePromptSeen();', '')));
  check('§3 the prompt is mounted at the root', /<NamePrompt \/>/.test(files[LAYOUT]));
  // Owner 2026-10-23: the box speaks the UI's language — «وش نناديك؟» / «اكتب اسمك» / «حفظ» / «لاحقاً».
  const i18n = read('src/i18n.tsx');
  const wordsOk = (p: string, i: string) => /t\('What should we call you\?'\)/.test(p) && /placeholder=\{t\('Type your name'\)\}/.test(p)
    && /t\('Save'\)/.test(p) && /t\('Later'\)/.test(p)
    && /'What should we call you\?': 'وش نناديك؟'/.test(i) && /'Type your name': 'اكتب اسمك'/.test(i)
    && /'Save': 'حفظ'/.test(i) && /'Later': 'لاحقاً'/.test(i);
  check('§3 the owner\'s words, in both languages', wordsOk(files[PROMPT], i18n));
  mustCatch('a placeholder other than «اكتب اسمك»', !wordsOk(files[PROMPT].replace("t('Type your name')", "t('Display Name')"), i18n));
  mustCatch('the Arabic title drifting', !wordsOk(files[PROMPT], i18n.replace("'وش نناديك؟'", "'ما اسمك؟'")));
  check('§3 the field starts EMPTY (never prefilled)', /useState\(''\);/.test(files[PROMPT]) && !/email|user\.sub/.test(files[PROMPT].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
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
const PIN_PROVIDER = '61cbee466afe595548e0fa374850ef4ca2d2a3b44377e47ca8cde4b978f3667e';
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
  if (!/export const APPLE_JS_SIGNIN = process\.env\.EXPO_PUBLIC_APPLE_JS_SIGNIN === '1';/.test(f[AUTH])) out.push('the flag is not strictly opt-in');
  if (!/if \(APPLE_JS_SIGNIN && isBackendLive && Platform\.OS === 'web'\) void prepareAppleJs\(\);/.test(f[MODAL])) out.push('Apple\'s script loads with the flag off');
  const outside = f[MODAL].replace(appleBlock(f[MODAL]), '');
  if (/signInWithAppleJs\(/.test(outside)) out.push('signInWithAppleJs is reachable outside the flagged block');
  return out;
};
{
  const p = flagProblems(files);
  check('§5 flag off → Apple sign-in is today\'s redirect, byte for byte', p.length === 0, p.join('; '));
  mustCatch('the redirect itself edited', flagProblems({ ...files, [AUTH]: files[AUTH].replace("options: { redirectTo, queryParams }", "options: { redirectTo, queryParams, skipBrowserRedirect: true }") }).length > 0);
  mustCatch('the Apple JS path made unconditional', flagProblems({ ...files, [MODAL]: files[MODAL].replace('        if (APPLE_JS_SIGNIN) {', '        if (true) {') }).length > 0);
  mustCatch('the flag defaulting ON', flagProblems({ ...files, [AUTH]: files[AUTH].replace("=== '1';", "!== '0';") }).length > 0);
  mustCatch('Apple\'s script preloaded for everyone', flagProblems({ ...files, [MODAL]: files[MODAL].replace('if (APPLE_JS_SIGNIN && isBackendLive', 'if (isBackendLive') }).length > 0);
  mustCatch('the fallback redirect removed after a JS failure', flagProblems({ ...files, [MODAL]: files[MODAL].replace("        const r = await signInWithProvider('apple');", "        return;") }).length > 0);
}

console.log(failures === 0 ? '\nOK — Apple\'s name is kept, a missing one is asked for once, never invented.' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
