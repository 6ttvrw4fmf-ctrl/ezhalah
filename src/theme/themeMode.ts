// The PURE half of the appearance system (owner 2026-08-28) — no React, no JSX, so the barrier
// (scripts/verify-account-menu-contract.ts) can EXECUTE the real decision instead of grepping for
// its shape (repo rule — see lib/webRefreshRoute.ts). The React provider lives in theme.tsx.

// Relative + extensioned so a plain `node --experimental-strip-types` run (the barrier) can load
// this module directly — same pattern as lib/searchDefaults.ts → data/propertyTypes.ts.
import { darkColors, lightColors } from './palette.ts';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_KEY = 'appearance';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'] as const;

export const isThemeMode = (v: unknown): v is ThemeMode =>
  v === 'system' || v === 'light' || v === 'dark';

// The one decision: what the user's choice + the OS state resolve to.
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

export function themeColors(resolved: ResolvedTheme): typeof darkColors {
  // LITERALS both ways — converted surfaces and parser sites need real values, never var() refs.
  return resolved === 'dark' ? darkColors : (lightColors as unknown as typeof darkColors);
}
