// Thin adapters over the theme system (src/theme/theme.tsx) for the FEW sites that must parse a
// color and cannot digest the var() tokens: reanimated interpolateColor, RN Animated color
// interpolation, and expo-linear-gradient. Everything else keeps importing `colors` from tokens
// (live CSS variables — zero re-render on theme change) and must never need these hooks.

import { useTheme } from '@/theme/theme';
import { themeColors } from '@/theme/themeMode';
import type { PaletteKey } from '@/theme/palette';

export type ResolvedTheme = 'light' | 'dark';

export function useResolvedTheme(): ResolvedTheme {
  return useTheme().resolved;
}

// The LITERAL palette for the resolved theme.
export function useThemePalette(): Record<PaletteKey, string> {
  return themeColors(useTheme().resolved);
}
