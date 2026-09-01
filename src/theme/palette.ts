// The two theme palettes — ZERO-DEPENDENCY literals (no react-native import), importable by
// +html.tsx (Node static render), the plain-Node barriers, themeMode.ts AND tokens.ts alike.
// This is the single place a color VALUE lives.
//
// Two consumers, one source (owner feature 2026-08-28, extended to FULL-app dark same day):
//   • themeMode.ts / useThemeColors(): a converted surface reads the LITERAL palette per render.
//   • tokens.ts: on web the static `colors` every screen already imports becomes a live
//     `var(--ez-*)` over these values (+html.tsx injects both palettes + a pre-hydration boot),
//     so ALL module-scope StyleSheets re-skin instantly — the whole app, not opt-in surfaces.
// DARK stays green-tinted by design — never a generic gray theme.

export const lightColors = {
  primary: '#2f7247', // primary green
  dark: '#1d4a37', // dark green
  tint: '#eef6f0', // light-green tint
  tintFill: '#e9f4ec', // agent box fill
  userBubble: '#d7eede', // user chat bubble — light green
  userBubbleText: '#1d4a37', // user chat bubble text — dark green (legible on light green)
  tintLine: '#d8ebdd', // tint border
  ink: '#15201b', // primary text
  body: '#34403a', // body text
  muted: '#7b8a82', // muted text
  mutedBlue: '#6b7a86', // hero subtitle
  line: '#e2e8e4', // hairline
  fieldLine: '#e7ebe8', // field/card border
  pickLine: '#dde6e0', // pick-box border (unselected)
  chipFill: '#eef6f0', // start-here suggestion chip fill
  chipLine: '#d6e8db', // start-here chip border
  chipIcon: '#16432f', // chip icon glyph
  exFill: '#1d4a37', // ai-empty example chip fill (dark green)
  exIcon: '#79c79c', // ai-empty example chip icon
  paper: '#fbfbfa', // screen background
  surface: '#ffffff', // cards / sheets BACKGROUND (text-on-green is onFill, never this)
  surface2: '#f1f3f1', // secondary chips: close buttons, tracks, quiet hover fills
  segTrack: '#f1f3f1', // segmented-control track
  accentLeaf: '#2fb672', // bright "AI" accent
  amberBg: '#fdf6ec',
  amberInk: '#92591a',
  whatsApp: '#25d366',
  onFill: '#ffffff', // text/icons ON solid green fills — white in BOTH themes
  selFill: '#2f7247', // SELECTED control fill (white text) — deeper than dark-theme primary
  danger: '#c0392b', // destructive text/icons
  dangerBg: '#fbe8e6', // destructive tinted fill
  dangerLine: '#f3cfca', // destructive tinted border
  rnplBg: '#e8efff', // RNPL banner fill — blue family, distinct from brand green
  rnplLine: '#cdd9f5',
  rnplInk: '#3868c8',
  aqsatBg: '#ecedfb', // instalments (أقساط) banner fill — indigo family
  aqsatLine: '#c9ccf2',
  scrim: 'rgba(8,18,12,0.45)', // modal/overlay backdrop
} as const;

export type PaletteKey = keyof typeof lightColors;

// Dark appearance — PR#1206's palette (deep green-black paper, warm green-tinted neutrals),
// extended with the same semantic keys the full-app sweep added to light.
export const darkColors: Record<PaletteKey, string> = {
  primary: '#3f8f5c', // brand green, lifted for legibility on dark ground
  dark: '#245c44', // interaction fill (hover/press) on dark
  tint: '#1b2a21',
  tintFill: '#18271f',
  userBubble: '#1f3a2c',
  userBubbleText: '#cfe6d6',
  tintLine: '#2a4234',
  ink: '#e9efe9', // warm off-white
  body: '#c2cdc5',
  muted: '#8fa096',
  mutedBlue: '#93a3ad',
  line: '#243029',
  fieldLine: '#273329',
  pickLine: '#2c3a31',
  chipFill: '#1b2a21',
  chipLine: '#2a4234',
  chipIcon: '#9fd0b2',
  exFill: '#12281d',
  exIcon: '#79c79c',
  paper: '#0f1712', // deep green-black paper
  surface: '#161f19', // raised cards / menu panel
  surface2: '#1d2620',
  segTrack: '#1d2620',
  accentLeaf: '#2fb672',
  amberBg: '#2b2214',
  amberInk: '#e0b070',
  whatsApp: '#25d366',
  onFill: '#ffffff',
  selFill: '#2b6f4c', // deep selected fill so onFill text keeps contrast (dark primary is lighter)
  danger: '#e0685c', // lifted red for legibility on dark
  dangerBg: '#3a1b16',
  dangerLine: '#54261f',
  rnplBg: '#1b2438',
  rnplLine: '#2d3c5c',
  rnplInk: '#93b2f0',
  aqsatBg: '#20223c',
  aqsatLine: '#343862',
  scrim: 'rgba(0,0,0,0.55)',
};

// CSS custom-property name for a palette key. tokens.ts and +html.tsx MUST agree on this.
export const cssVar = (k: PaletteKey) => `--ez-${k}`;

// A hex color at 0 alpha — for color interpolations that must START transparent-of-this-color
// (starting from plain 'transparent' = rgba(0,0,0,0) drags the blend through black).
export function alpha0(hex: string): string {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `rgba(${parseInt(f.slice(0, 2), 16)},${parseInt(f.slice(2, 4), 16)},${parseInt(f.slice(4, 6), 16)},0)`;
}

// The <style> body +html.tsx injects: light on :root, dark on explicit data-theme AND on system
// preference when no explicit choice was stored. `color-scheme` keeps scrollbars/inputs native.
export function buildThemeCss(): string {
  const decl = (p: Record<PaletteKey, string>) =>
    (Object.keys(lightColors) as PaletteKey[]).map((k) => `${cssVar(k)}:${p[k]};`).join('');
  return [
    `:root{${decl(lightColors)}color-scheme:light;}`,
    `:root[data-theme="dark"]{${decl(darkColors)}color-scheme:dark;}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${decl(darkColors)}color-scheme:dark;}}`,
    // A LIGHT-PINNED subtree (owner 2026-08-29: the Agent/chat screen keeps the white design even
    // when the rest of the app is dark). Custom properties inherit, so redefining them on the
    // subtree root beats every :root block above for everything inside it — both dark paths.
    `[data-ez-light]{${decl(lightColors)}color-scheme:light;}`,
  ].join('\n');
}
