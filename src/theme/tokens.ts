// Design tokens — single source of truth. Ported from the handoff (README "Design Tokens"
// + prototype css block). Never hard-code hex/sizes in components.
//
// THEMING (owner feature 2026-08-28): color VALUES live in src/theme/palette.ts (LIGHT + DARK).
// On web, every entry here is a live `var(--ez-*)` reference — +html.tsx defines both palettes as
// CSS custom properties and a pre-hydration boot script applies the persisted appearance, so all
// module-scope StyleSheets (26 files) re-skin instantly on theme change with ZERO re-render and no
// SSR/hydration divergence (Platform.OS === 'web' is also true during static render, so server and
// client bake identical var() strings). Native keeps LIGHT literals: no shipped native app yet, and
// native theming needs style factories — do not fake it. src/lib/appearance.ts owns the preference.
//
// Two rules the sweep relies on:
//   • colors.surface is a BACKGROUND. Text/icons on solid green fills use colors.onFill (white in
//     both themes) — in dark they diverge, and surface-as-foreground goes dark-on-dark.
//   • Anything that PARSES a color (Animated interpolation, reanimated interpolateColor,
//     expo-linear-gradient) cannot digest var() — those sites use literals via useResolvedTheme().

import { Platform } from 'react-native';
import { LIGHT, cssVar, type PaletteKey } from './palette';

export const colors: Record<PaletteKey, string> = Platform.OS === 'web'
  ? (Object.fromEntries(
      (Object.keys(LIGHT) as PaletteKey[]).map((k) => [k, `var(${cssVar(k)}, ${LIGHT[k]})`]),
    ) as Record<PaletteKey, string>)
  : LIGHT;

// Per-platform brand colors. Keys match Platform.name. (PRD §8.1)
export const platformColors: Record<string, string> = {
  Aqar: '#1f7a3d',
  Wasalt: '#0f7b6c',
  Aldarim: '#8a5a2b',
};

export const platformColor = (name: string) => platformColors[name] ?? colors.primary;

export const radius = {
  chip: 12,
  card: 16,
  field: 13,
  sheet: 22,
  pill: 999,
} as const;

export const space = {
  base: 8,
  screenTop: 56,
  screenSide: 18,
  card: 16,
} as const;

// Poppins; falls back to system until the font is loaded (see _layout). README: body 13–15,
// titles 18–26, pill/labels 11.
export const font = {
  family: {
    regular: 'Poppins_400Regular',
    medium: 'Poppins_500Medium',
    semibold: 'Poppins_600SemiBold',
    bold: 'Poppins_700Bold',
  },
} as const;

// Soft green-tinted card shadow: 0 18px 40px -30px rgba(20,40,30,.3)
export const cardShadow = {
  shadowColor: 'rgba(20,40,30,1)',
  shadowOpacity: 0.18,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 4,
} as const;
