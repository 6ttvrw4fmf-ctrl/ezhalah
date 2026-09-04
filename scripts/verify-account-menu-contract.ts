// SIDEBAR-ANCHORED ACCOUNT MENU — the interaction contract (owner 2026-08-28).
//
// The centered /settings modal is RETIRED. Account controls open as a compact panel anchored to
// the profile row at the bottom of the sidebar (ChatGPT/Perplexity concept, Ezhalah identity).
// This barrier pins:
//
//   1. The centered modal is GONE — no src/app/settings.tsx, no settings Stack.Screen, no
//      go('/settings') navigation left in the sidebar.
//   2. The panel is ANCHORED, not centered: absolutely positioned with a `bottom:` anchor inside
//      the sidebar panel, rendered by the Sidebar itself (docked AND drawer trees).
//   3. Outside-click closes (full-viewport scrim → onClose) and Escape closes (capture-phase
//      keydown registered ONLY while open — no key swallowing when closed).
//   4. APPEARANCE works and persists: the pure resolver is EXECUTED here (system follows the OS,
//      light/dark override it), setMode writes synchronously on web + AsyncStorage, and the
//      provider hydrates in effects only (SSR-parity initial state — the React #418 class).
//   5. The Arabic-only language contract is untouched: setLocale still guards `l !== 'ar'`, and
//      the menu's language view marks العربية active.
//   6. Logout and deletion kept their real paths: confirm → store signOut()/deleteAccount() with
//      the same truth-telling semantics (deletion specifics live in verify-account-deletion.ts,
//      which now reads AccountMenu.tsx).
//   7. The mobile panel cannot overflow: edge-inset anchoring (left+right, never a fixed width)
//      and a window-height cap with an internal ScrollView for the tall account view.
//   8. The testID surface routine #6 (Journey engineer) drives is present and stable.
//
//   node --experimental-strip-types scripts/verify-account-menu-contract.ts   (wired into npm test)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTheme, themeColors, isThemeMode } from '../src/theme/themeMode.ts';
// Palette literals moved to palette.ts when the full-app var() layer landed (tokens.ts now
// imports react-native and cannot load under plain node).
import { lightColors as colors, darkColors } from '../src/theme/palette.ts';

const root = join(import.meta.dirname, '..');
// Comments narrate history ("go('/settings') went with it") — strip them so only CODE can satisfy
// or violate a check.
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[^\n:]\/\/[^\n]*$/gm, '');
const menu = readFileSync(join(root, 'src/components/AccountMenu.tsx'), 'utf8');
const sidebar = readFileSync(join(root, 'src/components/Sidebar.tsx'), 'utf8');
const sidebarCode = codeOnly(sidebar);
const layout = readFileSync(join(root, 'src/app/_layout.tsx'), 'utf8');
const theme = readFileSync(join(root, 'src/theme/theme.tsx'), 'utf8');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}`);
};

console.log('\nSidebar-anchored account menu — interaction contract\n');

// ── 1) The centered Settings modal is gone from the desktop flow ─────────────────────────────────
check('src/app/settings.tsx no longer exists', !existsSync(join(root, 'src/app/settings.tsx')));
check('no settings Stack.Screen remains in the root layout', !/Stack\.Screen name="settings"/.test(layout));
check("the sidebar no longer navigates to '/settings'", !/'\/settings'/.test(sidebarCode));
check('the sidebar renders the AccountMenu instead', /<AccountMenu visible=\{acctOpen\}/.test(sidebar));
// Both sidebar modes host the menu — the docked desktop column AND the mobile drawer.
check('the menu is mounted in BOTH sidebar trees (docked + drawer)',
  (sidebar.match(/<AccountMenu visible=\{acctOpen\}/g) ?? []).length === 2);

// ── 2) Anchored, never centered ──────────────────────────────────────────────────────────────────
check('the panel is absolutely positioned with a bottom anchor (grows up from the profile row)',
  /panel: \{\s*position: 'absolute', left: 10, right: 10, bottom: \d+/.test(menu));
check('the profile row is the trigger (testID account-menu-trigger)',
  /testID="account-menu-trigger"/.test(sidebar) && /onPress=\{\(\) => \(acctOpen \? setAcctOpen\(false\) : openAccountMenu\(\)\)\}/.test(sidebar));
check('the settings nav link opens the menu for signed-in users and sign-in for guests',
  /onPress=\{\(\) => \(user \? openAccountMenu\(\) : openSignIn\(\)\)\}/.test(sidebar));

// ── 3) Outside-click and Escape close it ─────────────────────────────────────────────────────────
check('a full-viewport scrim closes on outside click',
  /testID="account-menu-scrim"[\s\S]{0,80}?onPress=\{onClose\}/.test(menu)
  && /scrim: \{[\s\S]{0,220}?position: 'fixed'/.test(menu));
check('Escape closes — capture-phase keydown, registered only while open',
  /if \(!visible \|\| Platform\.OS !== 'web'[\s\S]{0,400}?e\.key !== 'Escape'[\s\S]{0,200}?addEventListener\('keydown', onKey, true\)/.test(menu)
  && /removeEventListener\('keydown', onKey, true\)/.test(menu));
check('the unmount hand-off is timer-driven, never an animation callback (rAF freeze rule)',
  /closeTimer\.current = setTimeout\(/.test(menu) && !/withTiming\([^)]*,\s*\(\s*finished/.test(menu));

// ── 4) Appearance: EXECUTE the real resolver, and pin persistence + SSR parity ───────────────────
check("resolveTheme('system', OS dark) === 'dark'", resolveTheme('system', true) === 'dark');
check("resolveTheme('system', OS light) === 'light'", resolveTheme('system', false) === 'light');
check("resolveTheme('dark', OS light) === 'dark' — an explicit choice beats the OS", resolveTheme('dark', false) === 'dark');
check("resolveTheme('light', OS dark) === 'light'", resolveTheme('light', true) === 'light');
check('themeColors maps resolved themes to the right palettes',
  themeColors('dark') === darkColors && (themeColors('light') as unknown) === colors);
check('isThemeMode accepts exactly the three modes',
  isThemeMode('system') && isThemeMode('light') && isThemeMode('dark') && !isThemeMode('sepia') && !isThemeMode(null));
check('the dark palette covers every light token (no key can fall through to undefined)',
  Object.keys(colors).every((k) => typeof (darkColors as Record<string, string>)[k] === 'string'));
check('setMode persists synchronously on web AND mirrors to AsyncStorage',
  /setModeState\(m\);[\s\S]{0,220}?localStorage\?\.setItem\(THEME_KEY, m\)[\s\S]{0,120}?AsyncStorage\.setItem\(THEME_KEY, m\)/.test(theme));
check('SSR parity: initial state is the server value; storage/matchMedia are read in effects only',
  /useState<ThemeMode>\('system'\)/.test(theme) && /useState\(false\)/.test(theme)
  && /useEffect\(\(\) => \{[\s\S]{0,400}?localStorage\?\.getItem\(THEME_KEY\)/.test(theme));
check("'system' tracks the OS LIVE (a change listener, not a one-time read)",
  /matchMedia\('\(prefers-color-scheme: dark\)'\)/.test(theme) && /addEventListener\('change', onChange\)/.test(theme)
  && /Appearance\.addChangeListener/.test(theme));
check('the menu offers exactly System / Light / Dark and applies the choice via setMode',
  /\(\['system', 'light', 'dark'\] as ThemeMode\[\]\)\.map/.test(menu) && /onPress=\{\(\) => setMode\(mm\)\}/.test(menu));

// ── 5) Language: the Arabic-only contract is untouched ───────────────────────────────────────────
check("i18n setLocale still guards l !== 'ar' (the product is Arabic-only)",
  /if \(l !== 'ar'\) return; \/\/ Arabic-only product/.test(i18n));
check('the menu marks العربية active and lists English as disabled',
  /testID="language-ar"/.test(menu) && /testID="language-en"/.test(menu) && /langDisabled/.test(menu));

// ── 6) Logout + deletion kept their real paths ───────────────────────────────────────────────────
check('logout confirm calls signOut() and lands on the logged-out home',
  /setTimeout\(\(\) => \{ signOut\(\); router\.replace\('\/'\); \}, 1200\)/.test(menu));
check('deletion awaits deleteAccount() and only navigates on confirmed success',
  /const ok = await deleteAccount\(\);\s*if \(!ok\) \{/.test(menu) && /router\.replace\('\/'\);\s*\}/.test(menu.slice(menu.indexOf('onDeleteAccount'))));
check('the destructive action lives in the account view, not the menu root',
  menu.indexOf('account-menu-delete"') > menu.indexOf("view === 'account'")
  && menu.slice(menu.indexOf("view === 'root'"), menu.indexOf("view === 'appearance'")).indexOf('account-menu-delete"') === -1);

// ── 7) The mobile panel cannot overflow ──────────────────────────────────────────────────────────
// `[^{}]*` deliberately stops at any nested brace — a bare `[^}]*` would wander into
// `shadowOffset: { width: … }` and read layout intent out of a shadow (the vacuous-regex class).
check('the panel is inset from both edges (left+right) — width follows the sidebar, no fixed width',
  /panel: \{\s*position: 'absolute', left: 10, right: 10,/.test(menu) && !/panel: \{[^{}]*width: \d/.test(menu));
// CONTRACT CHANGE (owner 2026-08-28, same day): the account view now lives in the CENTERED popup,
// so its scroll cap follows the window fraction, not the anchored panel's maxH.
check('height is capped to the window with an internal ScrollView for the account view',
  /Math\.min\(winH - 120, \d+\)/.test(menu) && /<ScrollView style=\{\{ maxHeight: winH \* 0\.72 \}\}/.test(menu));

// ── 9) Centered full-app popups (owner revision 2026-08-28) ─────────────────────────────────────
// «The sidebar is only the launcher.» إدارة الحساب, its delete flow, and the تسجيل الخروج
// confirmation are NOT confined to the sidebar — they render in a real RN <Modal>, centered over
// the whole app, on a dimmed+blurred backdrop. The quick views (root/appearance/language) stay
// anchored; the view value alone decides the container, so one state machine drives both.
check('the three heavy views render in the centered container, quick views stay anchored',
  /const centered = view === 'account' \|\| view === 'signout' \|\| view === 'delete';/.test(menu)
  && /\{!centered && \(/.test(menu) && /\{centered && \(\s*<Modal visible transparent/.test(menu));
check('the centered root is a full-viewport fixed layer, card centered — never bottom-anchored',
  /centerRoot: \{ flex: 1, alignItems: 'center', justifyContent: 'center'/.test(menu)
  && !/centerCard(Wide)?: \{[^}]*bottom:/.test(menu));
check('the backdrop dims AND blurs the app behind it (web)',
  /centerBack: \{[^}]*backgroundColor: dark \? 'rgba/.test(menu) && /backdropFilter: 'blur\(6px\)'/.test(menu));
// 2026-08-29: the × is now shared by ALL THREE centered popups (owner: consistent top-right X on
// every dialog) — one Pressable whose testID follows the view and whose press is the SAFE dismissal.
check('the account popup is the LARGE surface (560); confirmations stay 360; ALL carry the top-right ×',
  /centerCardWide: \{[^}]*maxWidth: 560/.test(menu) && /centerCard: \{[^}]*maxWidth: 360/.test(menu)
  && /'account-popup-close' : view === 'signout' \? 'logout-popup-close' : 'delete-popup-close'/.test(menu)
  && /onPress=\{\(\) => \{ if \(view === 'delete'\) go\('account', -1\); else onClose\(\); \}\}[\s\S]{0,160}?centerClose/.test(menu));
check('backdrop/Escape CANCEL the safest step: delete steps back to account, others close',
  /onRequestClose=\{\(\) => \{ if \(view === 'delete'\) go\('account', -1\); else onClose\(\); \}\}/.test(menu)
  && /if \(viewRef\.current === 'delete'\) \{ go\('account', -1\); return; \}/.test(menu));
check('logout cancel closes the popup — never a hop back into the sidebar panel',
  /testID="logout-popup-cancel"[\s\S]{0,80}?onPress=\{onClose\}/.test(menu));

// ── 8) The Journey-engineer testID surface ───────────────────────────────────────────────────────
for (const id of ['account-menu', 'account-menu-appearance', 'appearance-${mm}', 'account-menu-language',
  'account-menu-help', 'account-menu-account', 'account-menu-signout', 'account-menu-delete',
  'account-menu-signout-confirm', 'account-menu-delete-confirm', 'account-menu-back',
  'account-popup', 'logout-popup', 'delete-popup', 'account-popup-backdrop', 'account-popup-close',
  'logout-popup-cancel']) {
  // The three centered-popup ids are assigned via a view ternary, so the string literal — not a
  // testID="…" attribute — is the honest presence signal for them.
  check(`testID ${id.replace('${mm}', 'system|light|dark')} is present`,
    menu.includes(`testID={\`${id}\`}`) || menu.includes(`testID="${id}"`) || menu.includes(`'${id}'`));
}

// ── MUTATION PROOF (centered-popup revision) ────────────────────────────────────────────────────
console.log('\n  mutation proof — each new guard must FAIL on its own defect\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const mut = (src: string, from: string, to: string) => {
  if (!src.includes(from)) throw new Error(`mutation anchor missing: ${from}`);
  return src.replace(from, to);
};
mustCatch('the account view being squeezed back into the anchored panel',
  !/const centered = view === 'account' \|\| view === 'signout' \|\| view === 'delete';/.test(
    mut(menu, "const centered = view === 'account' || view === 'signout' || view === 'delete';",
              "const centered = view === 'signout' || view === 'delete';")));
mustCatch('the backdrop losing its blur (plain dim only)',
  !/backdropFilter: 'blur\(6px\)'/.test(mut(menu, "backdropFilter: 'blur(6px)'", '')));
mustCatch('Escape during delete falling through to a full close (losing the safe step-back)',
  !/if \(viewRef\.current === 'delete'\) \{ go\('account', -1\); return; \}/.test(
    mut(menu, "if (viewRef.current === 'delete') { go('account', -1); return; }", '')));
mustCatch('logout cancel hopping back into the sidebar panel again',
  !/testID="logout-popup-cancel"[\s\S]{0,80}?onPress=\{onClose\}/.test(
    mut(menu, 'testID="logout-popup-cancel" style={s.cancelBtn} onPress={onClose}',
              'testID="logout-popup-cancel" style={s.cancelBtn} onPress={() => go(\'root\', -1)}')));

if (mutFail) { console.error(`\n❌ ${mutFail} guard(s) are BLIND to their own defect`); process.exit(1); }
console.log(failures === 0 ? '\n✅ account-menu contract holds.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
