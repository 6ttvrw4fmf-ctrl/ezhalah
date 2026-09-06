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
    TAP_TARGET_CSS,
  ].join('\n');
}

/** The 44 CSS-px floor this rule enforces. iOS HIG 44pt / Material 48dp; the repo already states
 *  it at scripts/verify-af-footer-buttons.ts:72 for the AF footer. */
export const TAP_TARGET_MIN = 44;

/**
 * hitSlop IS A NO-OP ON WEB, AND THIS IS THE LAYOUT-NEUTRAL REPLACEMENT (ops_incident #17).
 *
 * react-native-web 0.21.2 does not implement `hitSlop` on `Pressable` — only the legacy `Touchable`
 * reads it (node_modules/react-native-web/dist/exports/…). All 39 `hitSlop` declarations in src/ sit
 * on `Pressable`, so every one of them contributes exactly zero pixels and the rendered tap area is
 * the raw style box. Measured on production at 375 px, nine controls on the two busiest screens were
 * under the floor: the sidebar hamburger and all five composer buttons at 34×34, the sign-in pill at
 * 193×32, and both ModeSwitch tabs at 106×36.
 *
 * WHY A CENTERED ABSOLUTE ::after AND NOT PADDING. The owner's constraint is that nothing may look
 * larger and no spacing may shift. A pseudo-element with `position:absolute` is OUT OF FLOW: it
 * cannot change the host's box, its flex sizing, its `gap`, or any sibling's position — the layout
 * is provably identical, which is what scripts/verify-tap-targets.ts asserts box-by-box. Padding (or
 * padding plus a negative margin) touches the box model, is painted with the host's background, and
 * interacts with flex `gap` and `align-items`. It is the usual advice and it is the wrong tool here.
 *
 * WHY min-width/min-height AND NOT width/height. `min-*` grows ONLY an axis that is actually under
 * the floor and never shrinks one that is over it. That is what makes the rule safe next to a
 * neighbour: measured on production, the two ModeSwitch tabs are 106 px wide and TOUCHING
 * (gapX = 0), so any horizontal growth there would have stolen the neighbour's edge clicks — but
 * they are 106 px wide, so `min-width:44px` is inert on them and only their short 36 px axis grows,
 * into 26–44 px of free vertical space. The rule expands nothing it does not have to.
 *
 * The overlay is transparent and paints nothing. It hit-tests as its host (a pseudo-element's hits
 * resolve to the originating element), so a press near the icon reaches the same Pressable the icon
 * would have.
 */
/**
 * `z-index:-1` IS LEARNED, NOT DECORATIVE. A pseudo-element paints AFTER its host's content, so
 * without it the overlay sits on top of the control's own icon and label. Nothing breaks for a
 * finger — the overlay belongs to the same control, so the press still lands on it — but it does
 * break anything that targets a CHILD: Playwright refuses the click with «intercepted by
 * <div role="tab" data-tap44="1">», which took out every existing journey that reaches these tabs
 * by their text (and would take out any future control with independently clickable children).
 * Behind the content, the outset region still hit-tests to the host, and the children stay
 * directly clickable. Caught by e2e/journeys/run.mjs's own tap-targets-meet-44 journey before this
 * ever shipped, which is the argument for the real-browser half in one line.
 */
export const TAP_TARGET_CSS =
  `[data-tap44]::after{content:"";position:absolute;top:50%;left:50%;`
  + `transform:translate(-50%,-50%);width:100%;height:100%;`
  + `min-width:${TAP_TARGET_MIN}px;min-height:${TAP_TARGET_MIN}px;z-index:-1;}`;

/** The opt-in marker, spread into a control's `dataSet`. It lives beside the rule that implements
 *  it so the attribute and the CSS can never drift apart, and so a barrier can import both.
 *  Opt-in rather than a blanket `[role="button"]` rule: which controls grow stays a reviewed
 *  decision, not a side effect. Usage — RNW renders `dataSet` keys as `data-*` on the host node:
 *      dataSet={{ ...TAP44 }}                      // or
 *      dataSet={{ ...TAP44, testid: 'voice-mic' }} // alongside an existing testid  */
export const TAP44 = { tap44: '1' } as const;
