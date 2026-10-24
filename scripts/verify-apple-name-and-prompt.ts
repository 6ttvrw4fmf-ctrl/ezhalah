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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const closeOk = (src: string) => /const close = \(\) => \{ setClosed\(true\); setReopened\(false\); markNamePromptSeen\(\); \};/.test(src) && /onPress=\{close\}/.test(src);
  check('§3 «لاحقاً» and Save both mark it seen', closeOk(files[PROMPT]) && /saveName\(v\);\n\s*close\(\);/.test(files[PROMPT]));
  mustCatch('«لاحقاً» not recording that it was shown', !closeOk(files[PROMPT].replace(' markNamePromptSeen();', '')));
  check('§3 the prompt is mounted at the root', /<NamePrompt \/>/.test(files[LAYOUT]));
  // Owner 2026-10-23: the box speaks the UI's language — «وش نناديك؟» / «اكتب اسمك» / «حفظ» / «لاحقاً».
  const i18n = read('src/i18n.tsx');
  const wordsOk = (p: string, i: string) => /tr\('What should we call you\?'\)/.test(p) && /placeholder=\{translate\(lang, 'Type your name'\)\}/.test(p)
    && /tr\('Save'\)/.test(p) && /tr\('Later'\)/.test(p)
    && /'What should we call you\?': 'وش نناديك؟'/.test(i) && /'Type your name': 'اكتب اسمك'/.test(i)
    && /'Save': 'حفظ'/.test(i) && /'Later': 'لاحقاً'/.test(i);
  check('§3 the owner\'s words, in both languages', wordsOk(files[PROMPT], i18n));
  mustCatch('a placeholder other than «اكتب اسمك»', !wordsOk(files[PROMPT].replace("translate(lang, 'Type your name')", "translate(lang, 'Display Name')"), i18n));
  mustCatch('the Arabic title drifting', !wordsOk(files[PROMPT], i18n.replace("'وش نناديك؟'", "'ما اسمك؟'")));
  check('§3 the field starts EMPTY (never prefilled)', /useState\(''\);/.test(files[PROMPT]) && !/email|user\.sub/.test(files[PROMPT].split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
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
    return (await liftSymbols(tmp, [{ header: 'export function welcomeOnceSaved(' }], ['welcomeOnceSaved'], PRE6)) as { welcomeOnceSaved: (v: string) => void };
  };
  const gg = globalThis as any;
  const emit = (event: string, fullName?: string) => { for (const cb of [...gg.__subs]) cb(event, fullName === undefined ? null : { user: { user_metadata: { full_name: fullName } } }); };
  const run = async (src: string) => {
    gg.__subs = []; gg.__marks = 0;
    const { welcomeOnceSaved } = await liftWelcome(src);
    welcomeOnceSaved('يوسف النشوان');
    const afterSave = gg.__marks;                    // nothing yet: the name is not in the session
    emit('INITIAL_SESSION', 'يوسف النشوان');
    emit('USER_UPDATED', 'سارة');                    // someone else's / an older write
    const beforeOwn = gg.__marks;
    emit('USER_UPDATED', 'يوسف النشوان');            // the saved name has landed
    const once = gg.__marks;
    emit('USER_UPDATED', 'يوسف النشوان');            // a later update (the «seen» flag write)
    return { afterSave, beforeOwn, once, total: gg.__marks, subs: gg.__subs.length };
  };
  const r = await run(files[PROMPT]);
  check('§6 the welcome waits for the saved name (nothing at the tap, nothing on other events)', r.afterSave === 0 && r.beforeOwn === 0, JSON.stringify(r));
  check('§6 …then fires exactly once, and stops listening', r.once === 1 && r.total === 1 && r.subs === 0, JSON.stringify(r));
  mustCatch('a welcome that keeps listening (two welcomes)', (await run(files[PROMPT].replace('    stop();\n    markJustSignedIn();', '    markJustSignedIn();'))).total > 1);
  mustCatch('a welcome before the saved name is in the session (a nameless greeting)', (await run(files[PROMPT].replace(" || String(session?.user?.user_metadata?.full_name ?? '') !== v", ''))).beforeOwn > 0);
  mustCatch('a welcome on any auth event', (await run(files[PROMPT].replace("event !== 'USER_UPDATED' || ", ''))).beforeOwn > 0);

  // §6.2 the SAME function a Google sign-in uses; after «حفظ» only; never «لاحقاً»; no celebration card.
  const AUTHPAGE = read('src/app/auth.tsx'), ONETAP = read('src/components/GoogleOneTap.tsx'), WELCOME = read('src/lib/useFilterWelcome.ts');
  const welcomeProblems = (p: string, w: string) => {
    const out: string[] = [];
    const code = p.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    if (!/import \{ markJustSignedIn \} from '@\/lib\/loginWelcome';/.test(code) || !/markJustSignedIn\(\);/.test(code)) out.push('not the sign-in welcome Google uses (markJustSignedIn)');
    if (!/markJustSignedIn\(\);/.test(AUTHPAGE) || !/markJustSignedIn\(\)/.test(ONETAP)) out.push('the Google paths no longer use markJustSignedIn');
    if (!/saveName\(v\);\n\s*close\(\);\n\s*welcomeOnceSaved\(v\);/.test(code)) out.push('the welcome does not follow «حفظ»');
    if ((code.match(/welcomeOnceSaved\(v\)/g) ?? []).length !== 1) out.push('the welcome is started from somewhere other than «حفظ»');
    const close = /const close = \(\) => \{[^\n]*\};/.exec(code)?.[0] ?? '';
    if (!close || /markJustSignedIn|welcomeOnceSaved/.test(close)) out.push('«لاحقاً» (close) can fire the welcome');
    if (/name-celebration|ConfettiOverlay|partyConfetti\(|Welcome, \{name\}/.test(code)) out.push('a separate celebration card is back');
    // a nameless sign-in gets NO greeting before the box (the home greets only a named session)
    if (!/if \(!session\.present \|\| !\(session\.nameAr \|\| session\.nameEn\) \|\| !hasJustSignedIn\(now\)\) return null;/.test(w)) out.push('the home could greet a nameless sign-in before the box');
    return out;
  };
  const wp = welcomeProblems(files[PROMPT], WELCOME);
  check('§6 after «حفظ»: the Google sign-in welcome (markJustSignedIn), once; never «لاحقاً»; no celebration card', wp.length === 0, wp.join('; '));
  mustCatch('the celebration card coming back', welcomeProblems(files[PROMPT].replace('<View style={s.prev}>', '<View testID="name-celebration" />\n              <View style={s.prev}>'), WELCOME).length > 0);
  mustCatch('a save with no welcome', welcomeProblems(files[PROMPT].replace('    welcomeOnceSaved(v);\n', ''), WELCOME).length > 0);
  mustCatch('«لاحقاً» firing the welcome', welcomeProblems(files[PROMPT].replace('const close = () => { setClosed(true); setReopened(false); markNamePromptSeen(); };', "const close = () => { setClosed(true); setReopened(false); markNamePromptSeen(); welcomeOnceSaved(''); };"), WELCOME).length > 0);
  mustCatch('a home-made welcome instead of Google\'s (an event without the mark)', welcomeProblems(files[PROMPT].replace('    markJustSignedIn();\n  });', "    globalThis.dispatchEvent(new Event('ezhalah:signed-in'));\n  });"), WELCOME).length > 0);
  mustCatch('the home greeting a nameless Apple sign-in (a welcome BEFORE the box)', welcomeProblems(files[PROMPT], WELCOME.replace('!session.present || !(session.nameAr || session.nameEn) || ', '!session.present || ')).length > 0);
  const i18nNow = read('src/i18n.tsx');
  check('§6 the box speaks both languages', /"We'll greet you by name and share a property fact every day": 'نرحّب فيك باسمك، ونعطيك معلومة عقارية كل يوم'/.test(i18nNow)
    && /'In English:': 'بالإنجليزي:'/.test(i18nNow) && /'In Arabic:': 'بالعربي:'/.test(i18nNow));

  // §6.3 the switch sets the field's direction and placeholder; it starts on the app's language.
  const switchProblems = (src: string) => {
    const out: string[] = [];
    if (!/const \[lang, setLang\] = useState<Lang>\(locale\);/.test(src)) out.push('the switch does not start on the app\'s language');
    if (!/onPress=\{\(\) => setLang\(l\.id\)\}/.test(src)) out.push('the switch is not wired');
    if (!/style=\{\[s\.input, lang === 'ar' \? s\.inputAr : s\.inputEn\]\}/.test(src)) out.push('the field\'s direction does not follow the switch');
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
    if (!/\{letter \? <Text style=\{s\.avatarText\}>\{letter\}<\/Text>/.test(p) || !/const letter = letterOf\(name\);/.test(p)) out.push('the circle is not the live letter');
    // «أضف اسمك ✏️» reopens the same box
    if (!/if \(!pickName\(user, locale\)\) \{ onClose\(\); openNamePrompt\(\); return; \}/.test(f[MENU])) out.push('«أضف اسمك» in the menu does not open the box');
    if (!/\{pickName\(user, locale\) \? '' : ' ✏️'\}/.test(f[MENU]) || !/!pickName\(user, locale\) && s\.addName/.test(f[MENU])) out.push('the menu row is not the green «أضف اسمك ✏️»');
    if (!/const shown = open \|\| \(reopened && !!user && !user\.name\.trim\(\)\);/.test(p) || !/\{shown && \(/.test(p)) out.push('the box ignores the reopen');
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
  mustCatch('a reopen the box never shows', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('const shown = open || (reopened && !!user && !user.name.trim());', 'const shown = open;') }, NS).length > 0);
  mustCatch('a static circle instead of the live letter', v4Problems({ ...files, [PROMPT]: files[PROMPT].replace('const letter = letterOf(name);', "const letter = '';") }, NS).length > 0);
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
