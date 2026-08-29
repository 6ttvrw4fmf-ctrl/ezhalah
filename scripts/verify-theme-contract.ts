// PERMANENT BARRIER — theming + the sidebar account menu (owner feature 2026-08-28).
//
// THE ARCHITECTURE THIS PINS: every color in src/theme/palette.ts exists in BOTH palettes and is
// served as a live `--ez-*` CSS variable by +html.tsx (light on :root, dark on data-theme="dark"
// AND on the OS preference when nothing is stored), with a pre-hydration boot script that reads the
// SAME storage key src/lib/appearance.ts writes — so the first paint is already themed, module-scope
// StyleSheets re-skin with zero re-render, and SSR/client trees never diverge. Sites that PARSE
// colors (reanimated interpolateColor, RN Animated color interpolation, expo-linear-gradient) can
// never digest var() and must use resolved-palette literals instead.
//
// EXECUTED where the logic is executable (palette + appearance with stubbed browser globals),
// grepped where the contract is wiring. Mutation-proven:
//   M1 drop a DARK key                     → parity check fails
//   M2 boot script hardcodes its own key   → single-source check fails
//   M3 setAppearance stops setting the attr→ executed round-trip fails
//   M4 a gradient/interpolation goes back to var() tokens → parser-safety grep fails
//   M5 AccountMenu gates its close on a bare .start() callback → hand-off grep fails
//      (that exact bug shipped in this menu's first draft: Escape looked dead on web)
//
//   node --experimental-strip-types scripts/verify-theme-contract.ts     (wired into `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// ── 1. palettes: parity + valid values + the CSS the page actually serves ───────────────────────
const { LIGHT, DARK, APPEARANCE_STORAGE_KEY, buildThemeCss, cssVar, alpha0 } = await import('../src/theme/palette.ts');
const lk = Object.keys(LIGHT) as (keyof typeof LIGHT)[];
const dk = Object.keys(DARK);
check('LIGHT and DARK carry the SAME keys', lk.length === dk.length && lk.every((k) => dk.includes(k)),
  `light=${lk.length} dark=${dk.length} missing=${lk.filter((k) => !dk.includes(k)).join(',')}`);
const colorRe = /^#([0-9a-f]{6})$|^rgba\(\d+,\d+,\d+,(0|1|0?\.\d+)\)$/i;
check('every palette value is a real color literal', lk.every((k) => colorRe.test(LIGHT[k]) && colorRe.test(DARK[k])));
const css = buildThemeCss();
check('CSS defines every variable in the light AND dark blocks',
  lk.every((k) => css.split('\n')[0].includes(`${cssVar(k)}:${LIGHT[k]}`) && css.includes(`${cssVar(k)}:${DARK[k]}`)));
check('system dark applies only when no explicit light choice', css.includes('prefers-color-scheme: dark') && css.includes(':root:not([data-theme="light"])'));
check('color-scheme flips with the theme (native scrollbars/inputs)', css.includes('color-scheme:light') && css.includes('color-scheme:dark'));
check('alpha0 turns a hex into its 0-alpha rgba', alpha0('#2f7247') === 'rgba(47,114,71,0)');

// ── 2. appearance module: executed round-trip against stubbed browser globals ───────────────────
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const attrs = new Map<string, string>();
(globalThis as any).document = {
  documentElement: {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  },
};
let systemDark = false;
(globalThis as any).window = { matchMedia: () => ({ matches: systemDark, addEventListener() {}, removeEventListener() {} }) };
const { getAppearance, setAppearance, getResolvedTheme } = await import('../src/lib/appearance.ts');

check('default appearance is system', getAppearance() === 'system');
setAppearance('dark');
check('choosing dark stores the key AND stamps data-theme', store.get(APPEARANCE_STORAGE_KEY) === 'dark' && attrs.get('data-theme') === 'dark');
check('resolved theme honors the explicit choice', getResolvedTheme() === 'dark');
setAppearance('light');
check('choosing light flips both', store.get(APPEARANCE_STORAGE_KEY) === 'light' && attrs.get('data-theme') === 'light');
setAppearance('system');
check('back to system removes BOTH the key and the attribute', !store.has(APPEARANCE_STORAGE_KEY) && !attrs.has('data-theme'));
systemDark = true;
check('system resolves from the OS preference', getResolvedTheme() === 'dark');

// ── 3. +html.tsx: the one place the page learns the theme, from the one source ──────────────────
const html = read('src/app/+html.tsx');
check('+html injects buildThemeCss() (never a hand-copied palette)', html.includes('buildThemeCss()'));
check('+html boot script uses the SHARED storage key constant', html.includes('JSON.stringify(APPEARANCE_STORAGE_KEY)'));
check('+html boot script never hardcodes the key string', !html.includes(`'${APPEARANCE_STORAGE_KEY}'`) && !html.includes(`"${APPEARANCE_STORAGE_KEY}"`));
check('boot applies the theme pre-hydration (documentElement attribute)', html.includes("document.documentElement.setAttribute('data-theme',m)"));

// ── 4. tokens: web = var() over the palette, native = light literals ────────────────────────────
const tokens = read('src/theme/tokens.ts');
check('tokens map every key to var(--ez-*) on web', tokens.includes("Platform.OS === 'web'") && tokens.includes('`var(${cssVar(k)}, ${LIGHT[k]})`'));
check('tokens fall back to LIGHT literals off-web', /:\s*LIGHT;/.test(tokens));

// ── 5. parser-safety: the sites that PARSE colors never receive var() tokens ────────────────────
for (const [file, why] of [
  ['src/components/ui.tsx', 'reanimated interpolateColor'],
  ['src/components/SearchLoader.tsx', 'reanimated interpolateColor'],
] as const) {
  const src = read(file);
  const bad = src.split('\n').filter((l) => l.includes('interpolateColor(') && l.includes('colors.'));
  check(`${file}: no colors.* inside ${why}`, bad.length === 0, bad[0]?.trim().slice(0, 80));
}
const idx = read('src/app/index.tsx');
check('index.tsx: Animated color interpolation uses the resolved palette', !/outputRange: \[colors\./.test(idx));
for (const file of ['src/components/HeroBackground.tsx', 'src/components/InfoModal.tsx'] as const) {
  const src = read(file);
  const bad = src.split('\n').filter((l) => l.includes('<LinearGradient') && l.includes('colors.'));
  check(`${file}: no colors.* fed to LinearGradient`, bad.length === 0, bad[0]?.trim().slice(0, 80));
}
check('HeroBackground swaps to the pre-rendered dark art (no CSS filter hack)', read('src/components/HeroBackground.tsx').includes("theme === 'dark' ? HERO_DARK : HERO"));

// ── 6. the account menu replaces the Settings modal WITHOUT a parallel system ───────────────────
const menu = read('src/components/AccountMenu.tsx');
check('menu reuses the store account actions (no parallel auth)', menu.includes('signOut') && menu.includes('deleteAccount') && menu.includes('updateUser') && menu.includes('useApp()'));
check("Help opens the existing support popup", menu.includes("openModal('support')"));
check('appearance choice goes through the ONE setAppearance', menu.includes('setAppearance(o.v)'));
check('Arabic-only product: the menu never calls setLocale', !menu.includes('setLocale'));
check('Escape closes (web keydown listener)', menu.includes("e.key === 'Escape'"));
check('close/view hand-offs ride runAfterAnimation, NEVER a bare .start(cb)',
  menu.includes('runAfterAnimation(') && !/\.start\(\(\) => closeAccountMenu\(\)\)/.test(menu) && !/\.start\(\(\) => \{\s*setView/.test(menu));
const settings = read('src/app/settings.tsx');
check('the centered Settings modal is GONE — the route just raises the menu', settings.includes('openAccountMenu') && !settings.includes('ScrollView'));
check('_layout mounts the menu overlay', read('src/app/_layout.tsx').includes('<AccountMenu />'));
const sidebar = read('src/components/Sidebar.tsx');
check('sidebar gear/profile open the anchored menu (no /settings hop)', sidebar.includes('openAccountMenu') && !sidebar.includes("go('/settings')"));

console.log(failed === 0 ? '\n✅ theme + account-menu contract holds.' : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
