// PERMANENT BARRIER — FULL-APP dark mode over the PR#1206 theme system (owner 2026-08-28).
//
// PR#1206 shipped the sidebar account menu + ThemeProvider with per-surface opt-in theming; the
// owner then ordered dark to be REAL app-wide. This pins the extension that delivers it:
//   • color VALUES live once in src/theme/palette.ts (lightColors + darkColors, same keys);
//   • tokens.ts serves the static `colors` as live var(--ez-*) on web, so ALL module-scope
//     StyleSheets re-skin with zero re-render and no SSR divergence;
//   • +html.tsx injects both palettes + a pre-hydration boot reading THE SAME key ThemeProvider
//     writes (THEME_KEY), and ThemeProvider mirrors the mode onto <html data-theme>;
//   • sites that PARSE colors (reanimated interpolateColor, RN Animated interpolation,
//     expo-linear-gradient) use resolved-palette LITERALS (useThemePalette), never var() tokens;
//   • the hero sketch swaps to a pre-rendered chalk-on-night asset — no CSS filter hacks;
//   • the account menu's header carries the eagle-night artwork, melted into the panel surface.
//
// Interaction/menu behavior itself is pinned by scripts/verify-account-menu-contract.ts (PR#1206);
// this file owns the RENDERING architecture. Mutation-proven:
//   M1 drop a darkColors key → parity fails      M2 boot hardcodes its own key → single-source fails
//   M3 themeColors returns var() refs → executed literal check fails
//   M4 a gradient/interpolation reverts to var() tokens → parser-safety grep fails
//
//   node --experimental-strip-types scripts/verify-theme-contract.ts     (auto-discovered by npm test)
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
const { lightColors, darkColors, buildThemeCss, cssVar, alpha0 } = await import('../src/theme/palette.ts');
const lk = Object.keys(lightColors) as (keyof typeof lightColors)[];
const dk = Object.keys(darkColors);
check('lightColors and darkColors carry the SAME keys', lk.length === dk.length && lk.every((k) => dk.includes(k)),
  `light=${lk.length} dark=${dk.length} missing=${lk.filter((k) => !dk.includes(k)).join(',')}`);
const colorRe = /^#([0-9a-f]{6})$|^rgba\(\d+,\d+,\d+,(0|1|0?\.\d+)\)$/i;
check('every palette value is a real color literal', lk.every((k) => colorRe.test(lightColors[k]) && colorRe.test(darkColors[k])));
const css = buildThemeCss();
check('CSS defines every variable in the light AND dark blocks',
  lk.every((k) => css.split('\n')[0].includes(`${cssVar(k)}:${lightColors[k]}`) && css.includes(`${cssVar(k)}:${darkColors[k]}`)));
check('system dark applies only when no explicit light choice', css.includes('prefers-color-scheme: dark') && css.includes(':root:not([data-theme="light"])'));
check('color-scheme flips with the theme (native scrollbars/inputs)', css.includes('color-scheme:light') && css.includes('color-scheme:dark'));
check('alpha0 turns a hex into its 0-alpha rgba', alpha0('#2f7247') === 'rgba(47,114,71,0)');

// ── 2. executed: themeColors serves LITERALS (parser sites depend on it), resolution is sane ────
const { THEME_KEY, resolveTheme, themeColors } = await import('../src/theme/themeMode.ts');
check('themeColors(light) is the literal palette, never var() refs',
  themeColors('light').surface === '#ffffff' && !String(themeColors('light').ink).includes('var('));
check('themeColors(dark) is the literal dark palette', themeColors('dark').paper === darkColors.paper);
check('resolveTheme: system follows the OS, explicit wins', resolveTheme('system', true) === 'dark' && resolveTheme('light', true) === 'light');

// ── 3. the switch: ThemeProvider ↔ <html data-theme> ↔ pre-hydration boot, ONE key ─────────────
const theme = read('src/theme/theme.tsx');
check('ThemeProvider mirrors the mode onto data-theme (system REMOVES it)',
  theme.includes("d.setAttribute('data-theme', mode)") && theme.includes("d.removeAttribute('data-theme')"));
const html = read('src/app/+html.tsx');
check('+html injects buildThemeCss() (never a hand-copied palette)', html.includes('buildThemeCss()'));
check('+html boot script uses the SHARED THEME_KEY constant', html.includes('JSON.stringify(THEME_KEY)'));
check('+html boot script never hardcodes the key string', !html.includes(`'${THEME_KEY}'`) && !html.includes(`"${THEME_KEY}"`));
check('boot applies the theme pre-hydration (documentElement attribute)', html.includes("document.documentElement.setAttribute('data-theme',m)"));

// ── 4. tokens: web = var() over the palette, native = light literals ────────────────────────────
const tokens = read('src/theme/tokens.ts');
check('tokens map every key to var(--ez-*) on web', tokens.includes("Platform.OS === 'web'") && tokens.includes('`var(${cssVar(k)}, ${lightColors[k]})`'));
check('tokens fall back to light literals off-web', /:\s*lightColors;/.test(tokens));

// ── 5. parser-safety: the sites that PARSE colors never receive var() tokens ────────────────────
for (const [file, why] of [
  ['src/components/ui.tsx', 'reanimated interpolateColor'],
  ['src/components/SearchLoader.tsx', 'reanimated interpolateColor'],
] as const) {
  const src = read(file);
  const bad = src.split('\n').filter((l) => l.includes('interpolateColor(') && l.includes('colors.'));
  check(`${file}: no colors.* inside ${why}`, bad.length === 0, bad[0]?.trim().slice(0, 80));
}
check('index.tsx: Animated color interpolation uses the resolved palette', !/outputRange: \[colors\./.test(read('src/app/index.tsx')));
for (const file of ['src/components/HeroBackground.tsx', 'src/components/InfoModal.tsx', 'src/components/AccountMenu.tsx'] as const) {
  const src = read(file);
  const bad = src.split('\n').filter((l) => l.includes('<LinearGradient') && / colors\./.test(l));
  check(`${file}: no tokens fed to LinearGradient`, bad.length === 0, bad[0]?.trim().slice(0, 80));
}
check('HeroBackground swaps to the pre-rendered dark art (no CSS filter hack)', read('src/components/HeroBackground.tsx').includes("theme === 'dark' ? HERO_DARK : HERO"));

// ── 6. the eagle artwork header (owner: «add the image, blend it in») ───────────────────────────
const menu = read('src/components/AccountMenu.tsx');
check('the menu header carries the eagle-night artwork', menu.includes('eagle-night.jpg') && menu.includes('s.art'));
check('the artwork melts into the panel surface (literal gradient, alpha0)', menu.includes('alpha0(C.surface)'));

console.log(failed === 0 ? '\n✅ full-app theme contract holds.' : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
