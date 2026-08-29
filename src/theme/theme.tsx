// APPEARANCE / المظهر — the app's theme system (owner 2026-08-28, sidebar-anchored settings menu).
//
// One provider owns the appearance preference: 'system' | 'light' | 'dark'.
//   • 'system' follows the OS live — matchMedia('prefers-color-scheme') on web (the shipped
//     product), the RN Appearance API on native — and tracks changes without a reload.
//   • The choice persists across sessions for EVERYONE (device preference, not account data):
//     synchronous localStorage on web — the same sync-first pattern the store uses for history —
//     plus AsyncStorage for native. Deliberately NOT wiped by sign-out/delete-account: the theme
//     belongs to the device, like 'hasSeenIntro'.
//   • SSR/hydration safety (React #418, the 2026-08-21 P0 class): the FIRST client render must
//     match the server, so both `mode` and `systemDark` start at their server values ('system',
//     false) and the real stored/OS values are applied in effects after mount — exactly the
//     lib/useAtLeast.ts pattern.
//
// The RESOLUTION is a pure function (resolveTheme) so the barrier executes the real decision
// instead of grepping for its shape (repo rule — see lib/webRefreshRoute.ts).
//
// Coverage is per-surface and opt-in: themed surfaces call useThemeColors() and re-render on
// change; unconverted screens keep the static light `colors` import and remain readable.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { darkColors } from '@/theme/tokens';
import { THEME_KEY, isThemeMode, resolveTheme, themeColors, type ResolvedTheme, type ThemeMode } from '@/theme/themeMode';

// The pure decisions (resolveTheme, themeColors, mode validation) live in themeMode.ts so the
// barrier can execute them under node strip-types (no JSX there). Re-exported for convenience.
export { THEME_KEY, THEME_MODES, isThemeMode, resolveTheme, themeColors } from '@/theme/themeMode';
export type { ResolvedTheme, ThemeMode } from '@/theme/themeMode';

type ThemeValue = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  resolved: ResolvedTheme;
  colors: typeof darkColors;
};

const Ctx = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Server-parity initial values; hydrated in the effects below (never during render).
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(false);

  // Load the saved preference once, after mount. Sync localStorage first on web (same value the
  // AsyncStorage mirror holds) so the flip happens on the earliest post-hydration frame.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const v = window.localStorage?.getItem(THEME_KEY);
        if (isThemeMode(v)) { setModeState(v); return; }
      } catch {}
    }
    AsyncStorage.getItem(THEME_KEY)
      .then((v) => { if (isThemeMode(v)) setModeState(v); })
      .catch(() => {});
  }, []);

  // Track the OS scheme LIVE — 'system' must follow a mid-session OS change without a reload.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setSystemDark(mq.matches);
      const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
      // Older Safari lacks addEventListener on MediaQueryList; addListener is the legacy spelling.
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      }
      (mq as any).addListener?.(onChange);
      return () => (mq as any).removeListener?.(onChange);
    }
    setSystemDark(Appearance.getColorScheme() === 'dark');
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystemDark(colorScheme === 'dark'));
    return () => sub.remove();
  }, []);

  // Persist synchronously on web (a refresh right after choosing must keep the choice — the same
  // race the store's sync-first writes exist for), mirrored to AsyncStorage for native.
  const setMode = useCallback((m: ThemeMode) => {
    if (!isThemeMode(m)) return;
    setModeState(m);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try { window.localStorage?.setItem(THEME_KEY, m); } catch {}
    }
    AsyncStorage.setItem(THEME_KEY, m).catch(() => {});
  }, []);

  // FULL-APP dark (2026-08-28, same-day extension of PR#1206): the mode also drives the <html>
  // data-theme attribute. Every static token is a var(--ez-*) keyed on that attribute (+html.tsx),
  // so this one write re-skins ALL 26 module-scope StyleSheets — not just the converted surfaces.
  // 'system' REMOVES the attribute: the prefers-color-scheme media query then decides in pure CSS,
  // including live OS changes. The pre-hydration boot script in +html.tsx applies the same rule
  // before first paint, so there is never a flash of the wrong theme.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const d = document.documentElement;
    if (mode === 'system') d.removeAttribute('data-theme');
    else d.setAttribute('data-theme', mode);
  }, [mode]);

  const resolved = resolveTheme(mode, systemDark);
  const value = useMemo<ThemeValue>(
    () => ({ mode, setMode, resolved, colors: themeColors(resolved) }),
    [mode, setMode, resolved],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}

export function useThemeColors(): typeof darkColors {
  return useTheme().colors;
}
