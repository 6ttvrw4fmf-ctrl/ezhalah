// Appearance preference — النظام / فاتح / داكن (owner feature 2026-08-28).
//
// The mechanism is deliberately OUTSIDE React: choosing a theme writes localStorage and flips the
// <html> data-theme attribute, and every color in the app is a CSS variable keyed on that attribute
// (src/theme/palette.ts + +html.tsx), so the whole UI re-skins instantly with zero re-render and
// zero hydration risk. 'system' = NO attribute — the prefers-color-scheme media query decides, and
// keeps deciding live if the OS switches. The boot script in +html.tsx mirrors getAppearance()
// exactly so the very first paint is already themed (no flash).
//
// A tiny subscription exists for the few components that must READ the resolved theme in JS —
// color-parsing sites that cannot digest var(): gradients (HeroBackground/InfoModal) and animated
// color interpolations. Everything else should keep using tokens and never import this hook.

import { useEffect, useState } from 'react';
// Relative (not '@/') so plain-Node barriers can execute this module (same rule as searchDefaults).
import { APPEARANCE_STORAGE_KEY, DARK, LIGHT } from '../theme/palette.ts';

export type Appearance = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const listeners = new Set<() => void>();

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setAppearance(a: Appearance): void {
  try {
    if (a === 'system') localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    else localStorage.setItem(APPEARANCE_STORAGE_KEY, a);
  } catch {}
  try {
    const d = document.documentElement;
    if (a === 'system') d.removeAttribute('data-theme');
    else d.setAttribute('data-theme', a);
  } catch {}
  listeners.forEach((fn) => fn());
}

const systemDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

export function getResolvedTheme(): ResolvedTheme {
  const a = getAppearance();
  if (a === 'light' || a === 'dark') return a;
  return systemDark() ? 'dark' : 'light';
}

// Resolved light/dark for the FEW var()-hostile sites. SSR-safe: first render always says 'light'
// (matching the server tree), then corrects after mount — callers use it for gradient/interpolation
// LITERALS whose class names don't differ between themes, so no hydration mismatch.
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>('light');
  useEffect(() => {
    const update = () => setTheme(getResolvedTheme());
    update();
    listeners.add(update);
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', update);
    } catch {}
    return () => {
      listeners.delete(update);
      try { mq?.removeEventListener('change', update); } catch {}
    };
  }, []);
  return theme;
}

// The LITERAL palette for the resolved theme — ONLY for sites that must parse a color and cannot
// digest var(): reanimated interpolateColor, RN Animated color interpolation, expo-linear-gradient.
// Everything else keeps importing `colors` from tokens (live CSS vars, no re-render).
export function useThemePalette(): typeof LIGHT {
  return useResolvedTheme() === 'dark' ? (DARK as typeof LIGHT) : LIGHT;
}
