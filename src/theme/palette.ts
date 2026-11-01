// The two theme palettes — ZERO-DEPENDENCY literals (no react-native import), importable by
// +html.tsx (Node static render), the plain-Node barriers, themeMode.ts AND tokens.ts alike.
// This is the single place a color VALUE lives.
//
// Two consumers, one source (owner feature 2026-08-28, extended to FULL-app dark same day):
//   • themeMode.ts / useThemeColors(): a converted surface reads the LITERAL palette per render.
//   • tokens.ts: on web the static `colors` every screen already imports becomes a live
//     `var(--ez-*)` over these values (+html.tsx injects both palettes + a pre-hydration boot),
//     so ALL module-scope StyleSheets re-skin instantly — the whole app, not opt-in surfaces.
// Owner 2026-10-24: sky/dusk backdrop, neutral surfaces and plum controls; source logos keep their colors.

export const lightColors = {
  skyTop: '#C7E6F7',
  skyBottom: '#E8F3FA',
  primary: '#493953',
  dark: '#322B3B',
  hoverRow: '#322B3B',
  tint: '#F1EEF4',
  tintFill: '#F1EEF4',
  userBubble: '#E9E1EF',
  userBubbleText: '#33293F',
  tintLine: '#DDD5E4',
  ink: '#24232B',
  body: '#3F3C48',
  muted: '#62616D',
  mutedBlue: '#5F6875',
  line: '#E0DEE6',
  fieldLine: '#DEDCE4',
  pickLine: '#D8D4DF',
  chipFill: '#F1EEF4',
  chipLine: '#DDD5E4',
  chipIcon: '#493953',
  exFill: '#493953',
  exIcon: '#D4C5E2',
  paper: '#F7FAFC',
  surface: '#ffffff', // cards / sheets BACKGROUND (text-on-fill is onFill, never this)
  surface2: '#F1F0F4',
  segTrack: '#F1F0F4',
  accentLeaf: '#756084',
  amberBg: '#fdf6ec',
  amberInk: '#92591a',
  // The ad page's hazard note («قد يكون الإعلان حُذف أو بيع», owner 2026-10-10): a warmer amber than the
  // banner family above, with its own hairline — one note, read before the button.
  hazardBg: '#fff7e3',
  hazardLine: '#f1d38a',
  hazardInk: '#6b4a00',
  whatsApp: '#25d366',
  onFill: '#ffffff', // text/icons ON solid control fills — white in BOTH themes
  selFill: '#493953',
  // ENCOURAGED-ACTION gold (owner 2026-09-20, SHINY revision): the results-row "narrow it down"
  // CTA. A flat fill read as dull, so this is a diagonal metallic gradient (light highlight → deep
  // base, GoldShineButton in CardReveal.tsx) plus a periodic light sweep across it. Same values in
  // both themes — like whatsApp/onFill above, gold reads clearly against both a light and a neutral
  // charcoal-dark ground, so it needs no per-theme lift. goldOnFill is dark text ON the gold fill
  // specifically — NEVER `ink`/`onFill`, both of which flip per theme and per other fills
  // respectively; gold needs dark text regardless of which app theme is active, checked against
  // both gradient stops (dark text stays high-contrast across the whole light→deep range).
  goldLight: '#ffd966', // gradient highlight (top-left) — bright, warm
  goldDeep: '#c8860d', // gradient base (bottom-right) — rich amber-gold
  goldLightHover: '#f0c94a', // both stops deepen slightly on hover/press
  goldDeepHover: '#a86f08',
  goldOnFill: '#2a1d06',
  // SILVER (owner 2026-10-17): the card ring + «اضغط هنا» strip of a listing that does NOT open inside
  // Ezhalah; gold is reserved for the sites that do. Same metallic read as the gold pair.
  silverLight: '#f4f6f8',
  silverDeep: '#9aa6b2',
  silverOnFill: '#1f2a33',
  danger: '#c0392b', // destructive text/icons
  dangerBg: '#fbe8e6', // destructive tinted fill
  dangerLine: '#f3cfca', // destructive tinted border
  rnplBg: '#e8efff', // RNPL banner fill — blue family, distinct from brand green
  rnplLine: '#cdd9f5',
  rnplInk: '#3868c8',
  aqsatBg: '#ecedfb', // instalments (أقساط) banner fill — indigo family
  aqsatLine: '#c9ccf2',
  scrim: 'rgba(26,25,35,0.45)', // modal/overlay backdrop
} as const;

export type PaletteKey = keyof typeof lightColors;

// Dusk appearance: muted blue sky, charcoal-plum panels and warm ivory copy.
export const darkColors: Record<PaletteKey, string> = {
  skyTop: '#354E6A',
  skyBottom: '#40566E',
  primary: '#D5C5E2',
  dark: '#493953',
  // Muted plum hover fill keeps white text/icons legible on the charcoal panel.
  hoverRow: '#594660',
  tint: '#302B39',
  tintFill: '#302B39',
  userBubble: '#393242',
  userBubbleText: '#F5F2ED',
  tintLine: '#51465D',
  ink: '#F5F2ED',
  body: '#DDD8E2',
  muted: '#D5CEDA',
  mutedBlue: '#C1C9D5',
  line: '#45404F',
  fieldLine: '#514B5D',
  pickLine: '#5D5669',
  chipFill: '#342F3D',
  chipLine: '#51465D',
  chipIcon: '#D5C5E2',
  exFill: '#493953',
  exIcon: '#DDCFE8',
  paper: '#20222C',
  surface: '#25232D',
  surface2: '#332E3C',
  segTrack: '#332E3C',
  accentLeaf: '#C4B2D4',
  amberBg: '#2b2416',
  amberInk: '#e3b56f',
  hazardBg: '#2b2416',
  hazardLine: '#5a4414',
  hazardInk: '#f0cf7a',
  whatsApp: '#25d366',
  onFill: '#ffffff',
  selFill: '#675477',
  goldLight: '#ffd966',
  goldDeep: '#c8860d',
  goldLightHover: '#f0c94a',
  goldDeepHover: '#a86f08',
  goldOnFill: '#2a1d06',
  silverLight: '#e6eaef',
  silverDeep: '#7f8a96',
  silverOnFill: '#161d24',
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
    TAP44_DOWN_CSS,
    COMPOSER_PLACEHOLDER_CSS,
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

/** A SECOND, DIRECTIONAL marker (🦅 Falcon 2026-10-16): the floor grows DOWN from the control's top edge
 *  instead of out from its centre. For a short control parked just under another one, a centred 44px
 *  box reaches UP into its neighbour's own visual area. Measured on production at 375px: the agent
 *  composer's «شاهين 2.2» line (24px tall, 3px under the 34px mic) grew 10px up and took the mic's
 *  bottom edge — a press on the mic opened the model menu (journey-sweep tap-targets-meet-44, red
 *  daily). Stacking the row above it only moved the theft onto the model line's top edge (the mic's
 *  own floor grows 5px down); growing the model line downward fixes both: all five probe points then
 *  resolve to their own control, and the extra area lands on the disclaimer text, not a control.
 *  Used WITH TAP44 (it only re-anchors the same overlay); a separate rule so TAP_TARGET_CSS stays one. */
export const TAP44_DOWN = { tap44Down: '1' } as const;
export const TAP44_DOWN_CSS = '[data-tap44-down]::after{top:0;transform:translate(-50%,0);}';

/** The opt-in marker, spread into a control's `dataSet`. It lives beside the rule that implements
 *  it so the attribute and the CSS can never drift apart, and so a barrier can import both.
 *  Opt-in rather than a blanket `[role="button"]` rule: which controls grow stays a reviewed
 *  decision, not a side effect. Usage — RNW renders `dataSet` keys as `data-*` on the host node:
 *      dataSet={{ ...TAP44 }}                      // or
 *      dataSet={{ ...TAP44, testid: 'voice-mic' }} // alongside an existing testid  */
export const TAP44 = { tap44: '1' } as const;

/** The AI-chat composer's empty-box hint stays on ONE line and ends in an ellipsis (owner 2026-10-05).
 *  With the typed text sharing a line with the mic and Send, the old long hint «اكتب العقار اللي تبحث عنه في
 *  السعودية...» wrapped to two lines on a phone (since 2026-10-17 the hint is the short «اكتب عقارك وإزهله...»), which made the box taller and lifted typed text above
 *  the buttons. `text-overflow` trails at the END of the line in the field's own direction, so in Arabic
 *  the dots sit on the left, after the words. Opt-in by marker, like TAP44. */
export const COMPOSER_INPUT = { composerInput: '1' } as const;
export const COMPOSER_PLACEHOLDER_CSS =
  '[data-composer-input]::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}';

// THE GOLD BUZZER (owner 2026-10-10) — the one control allowed to leave the green: the pill that carries
// the source's logo inside the in-app ad page's «اضغط هنا للتواصل» bar. A deliberate brand exception for
// this single control; same values in both themes (gold reads on light and on charcoal alike).
export const BUZZER_GOLD = {
  light: '#fff3b0', // radial centre
  mid: '#f6d365',
  deep: '#e0a526',
  dark: '#b07a10', // radial edge
  ring: '#f9e08a', // inner light ring
  rim: 'rgba(122,82,8,0.55)', // dark-gold outer ring
  shade: 'rgba(176,122,16,0.55)', // drop shadow
  glow: 'rgba(246,211,101,0.45)', // warm glow, resting
  glowPeak: 'rgba(255,214,90,0.95)', // warm glow, pulse peak (brighter — owner 2026-10-10 «make it shiny»)
} as const;
