// The two theme palettes — ZERO-DEPENDENCY literals (no react-native import), so this module is
// importable by +html.tsx (Node static render), plain-Node barriers, AND tokens.ts alike. This is
// the single place a color VALUE lives; tokens.ts wraps these as live CSS variables on web.
//
// DARK is green-tinted by design, never neutral gray — the brand is the green. Every key exists in
// BOTH palettes (scripts/verify-theme-contract.ts pins the parity), and both are consumed through
// the same `--ez-<key>` CSS variable, flipped by `data-theme` / `prefers-color-scheme` (see
// +html.tsx). Appearance choice: 'system' = no data-theme attribute (media query decides);
// 'light'/'dark' = explicit attribute. src/lib/appearance.ts owns reading/writing it.

export const LIGHT = {
  primary: '#2f7247', // primary green
  dark: '#1d4a37', // dark green (heavy fills with white/onFill text, strong headings)
  tint: '#eef6f0', // light-green tint
  tintFill: '#e9f4ec', // agent box fill
  userBubble: '#d7eede', // user chat bubble
  userBubbleText: '#1d4a37', // user chat bubble text
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
  exFill: '#1d4a37', // ai-empty example chip fill
  exIcon: '#79c79c', // ai-empty example chip icon
  paper: '#fbfbfa', // screen background
  surface: '#ffffff', // cards / sheets BACKGROUND (never use as text-on-green — that's onFill)
  surface2: '#f1f3f1', // secondary chips: close buttons, tracks, quiet fills
  segTrack: '#f1f3f1', // segmented-control track
  accentLeaf: '#2fb672', // bright "AI" accent
  amberBg: '#fdf6ec',
  amberInk: '#92591a',
  whatsApp: '#25d366',
  selFill: '#2f7247', // SELECTED control fill (white text) — deeper than dark-theme primary
  onFill: '#ffffff', // text/icons ON solid green fills — white in BOTH themes
  danger: '#c0392b', // destructive text/icons
  dangerBg: '#fbe8e6', // destructive tinted fill
  dangerLine: '#f3cfca', // destructive tinted border
  rnplBg: '#e8efff', // RNPL (rent-now-pay-later) banner fill — blue family, distinct from brand green
  rnplLine: '#cdd9f5',
  rnplInk: '#3868c8',
  aqsatBg: '#ecedfb', // instalments (أقساط) banner fill — indigo family
  aqsatLine: '#c9ccf2',
  scrim: 'rgba(8,18,12,0.45)', // modal/overlay backdrop
} as const;

export type PaletteKey = keyof typeof LIGHT;

export const DARK: Record<PaletteKey, string> = {
  primary: '#4aa671', // brightened for contrast on dark surfaces
  dark: '#26654a', // heavy fills — still deep enough for white onFill text
  tint: '#1b2a21',
  tintFill: '#182720',
  userBubble: '#234534',
  userBubbleText: '#d5eddf',
  tintLine: '#2b4534',
  ink: '#ecf3ee',
  body: '#c7d4cb',
  muted: '#93a89b',
  mutedBlue: '#8fa3ad',
  line: '#26312a',
  fieldLine: '#2a3630',
  pickLine: '#2e3d34',
  chipFill: '#1b2a21',
  chipLine: '#2d4736',
  chipIcon: '#a9dabd',
  exFill: '#26654a',
  exIcon: '#8fd6ac',
  paper: '#0f1613', // near-black green — the dark ground everything sits on
  surface: '#182019',
  surface2: '#202b24',
  segTrack: '#202b24',
  accentLeaf: '#37c97e',
  amberBg: '#322714', // dark amber wash
  amberInk: '#e2b06e',
  whatsApp: '#25d366',
  selFill: '#2b6f4c', // deep selected fill so onFill text keeps contrast (primary is too pastel here)
  onFill: '#ffffff',
  danger: '#e0685c', // lifted red for legibility on dark
  dangerBg: '#3a1b16',
  dangerLine: '#54261f',
  rnplBg: '#1b2438',
  rnplLine: '#2d3c5c',
  rnplInk: '#93b2f0',
  aqsatBg: '#20223c',
  aqsatLine: '#343862',
  scrim: 'rgba(0,0,0,0.6)',
};

export const APPEARANCE_STORAGE_KEY = 'ez-appearance';

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
// preference when no explicit choice was made. `color-scheme` keeps scrollbars/inputs native-right.
export function buildThemeCss(): string {
  const decl = (p: Record<PaletteKey, string>) =>
    (Object.keys(LIGHT) as PaletteKey[]).map((k) => `${cssVar(k)}:${p[k]};`).join('');
  return [
    `:root{${decl(LIGHT)}color-scheme:light;}`,
    `:root[data-theme="dark"]{${decl(DARK)}color-scheme:dark;}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${decl(DARK)}color-scheme:dark;}}`,
  ].join('\n');
}
