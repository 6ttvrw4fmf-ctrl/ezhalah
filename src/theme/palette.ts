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
  hoverRow: '#1d4a37', // SIDEBAR hover fill — the dark green («محادثة جديدة»'s interaction color)
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
  // NEUTRAL CHARCOAL, not green-black (owner 2026-08-30). The previous dark palette tinted every
  // surface green (#0f1712 paper, #161f19 cards) and read as "too dark/green, not polished". This is
  // the ChatGPT-class treatment: neutral gray grounds, clear white primary text, softer gray secondary
  // text, subtle dividers — and Ezhalah green survives ONLY as the accent (primary, selected fills,
  // chip icons, the AI leaf), never as the ground. Every key below flows to `var(--ez-*)` on web, so
  // this file IS the dark redesign; no component carries its own dark hex.
  primary: '#3f9a63', // brand green, lifted for legibility on neutral dark
  dark: '#2b6f4c', // interaction fill (hover/press)
  // SIDEBAR hover fill in dark (owner 2026-09-03): a MUTED deep green-gray — clearly visible on the
  // charcoal panel, keeps white text/icons legible, still Ezhalah green, never bright/neon.
  hoverRow: '#26483f',
  tint: '#1e2320', // agent box fill — near-neutral with the faintest warm-green cast
  tintFill: '#1c211e',
  userBubble: '#2f2f2f', // user bubble — neutral gray (green must not dominate)
  userBubbleText: '#ececec',
  tintLine: '#2c332e',
  ink: '#ececec', // primary text — clear white
  body: '#c9cbc9', // body text
  muted: '#8f938f', // secondary text — softer gray
  mutedBlue: '#9aa3ab',
  line: '#2e2e2e', // hairline dividers — subtle, not invisible
  fieldLine: '#343434', // input / card borders
  pickLine: '#3b3b3b', // unselected pick-box border
  chipFill: '#262626',
  chipLine: '#3a3a3a',
  chipIcon: '#8fd0a8',
  exFill: '#1f3a2c', // example chips keep the green accent fill
  exIcon: '#79c79c',
  paper: '#171717', // screen background — charcoal
  surface: '#212121', // raised cards / menu panels
  surface2: '#2a2a2a', // secondary chips, tracks, quiet hover fills
  segTrack: '#2a2a2a',
  accentLeaf: '#2fb672',
  amberBg: '#2b2416',
  amberInk: '#e3b56f',
  whatsApp: '#25d366',
  onFill: '#ffffff',
  selFill: '#2f7247', // selected control fill — brand green as ACCENT
  danger: '#e46a5e',
  dangerBg: '#3a1e19',
  dangerLine: '#562a23',
  rnplBg: '#1c2434',
  rnplLine: '#2d3a55',
  rnplInk: '#93b2f0',
  aqsatBg: '#20223a',
  aqsatLine: '#34385e',
  scrim: 'rgba(0,0,0,0.62)',
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
