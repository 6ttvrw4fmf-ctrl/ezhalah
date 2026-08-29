// APPEARANCE / المظهر — the app's theme system (owner 2026-08-28, sidebar-anchored settings menu).
//
// One provider owns the appearance preference: 'system' | 'light' | 'dark'.
//   • 'system' follows the OS live — matchMedia('prefers-color-scheme') on web (the shipped
//     product), the RN Appearance API on native — and tracks changes without a reload.
//   • The choice persists across sessions — but it is an AUTHENTICATED-user asset (owner
//     2026-08-28/29, superseding both the original device-preference rule and the deletion-only
//     reset PR#1214 carried): signed out the app is always LIGHT, and a COMPLETED sign-out or
//     server-confirmed account deletion clears the stored keys entirely (resetThemeForSignOut
//     below). Merely OPENING a confirmation popup — or cancelling it — never touches the theme.
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
import { Appearance, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { darkColors } from '@/theme/tokens';
import { THEME_KEY, isThemeMode, resolveAppTheme, resolveTheme, themeColors, type ResolvedTheme, type ThemeMode } from '@/theme/themeMode';

// The pure decisions (resolveTheme, themeColors, mode validation) live in themeMode.ts so the
// barrier can execute them under node strip-types (no JSX there). Re-exported for convenience.
export { THEME_KEY, THEME_MODES, isThemeMode, resolveAppTheme, resolveTheme, themeColors } from '@/theme/themeMode';
export type { ResolvedTheme, ThemeMode } from '@/theme/themeMode';

type ThemeValue = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  resolved: ResolvedTheme;
  colors: typeof darkColors;
};

const Ctx = createContext<ThemeValue | null>(null);

// ── AUTH-GATED APPEARANCE (owner 2026-08-28) ────────────────────────────────────────────────────
// The store (single owner of auth state) drives this module-level signal:
//   • setThemeAuthState(signedIn) once auth is KNOWN (getSession settled / user state changed) —
//     until then the provider leaves the pre-hydration boot attribute alone, so a signed-in dark
//     user never sees a light stomp between hydration and session adoption.
//   • resetThemeForSignOut() on a COMPLETED transition to signed-out (successful sign-out,
//     server-confirmed deletion, or an externally revoked session): clears the stored keys and
//     returns the app to Light. NEVER wired to a dialog opening — إلغاء keeps Dark.
type ThemeAuth = { signedIn: boolean; known: boolean };
let themeAuth: ThemeAuth = { signedIn: false, known: false };
const authListeners = new Set<(a: ThemeAuth, reset: boolean) => void>();

export function setThemeAuthState(signedIn: boolean) {
  themeAuth = { signedIn, known: true };
  authListeners.forEach((l) => l(themeAuth, false));
}

export function resetThemeForSignOut() {
  themeAuth = { signedIn: false, known: true };
  // The stored preference must not leak into the logged-out experience or the next account.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { window.localStorage?.removeItem(THEME_KEY); } catch {}
  }
  AsyncStorage.removeItem(THEME_KEY).catch(() => {});
  authListeners.forEach((l) => l(themeAuth, true));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Server-parity initial values; hydrated in the effects below (never during render).
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(false);
  // Server-parity: first render is signed-out-unknown (light); the store raises the signal
  // post-mount (the same effect-after-mount pattern as mode/systemDark above).
  const [auth, setAuth] = useState<ThemeAuth>({ signedIn: false, known: false });

  useEffect(() => {
    setAuth(themeAuth);
    const l = (a: ThemeAuth, reset: boolean) => { setAuth(a); if (reset) setModeState('system'); };
    authListeners.add(l);
    return () => { authListeners.delete(l); };
  }, []);

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
    // Until auth is known, the pre-hydration boot attribute (+html.tsx, same rule) stays in charge.
    if (!auth.known) return;
    const d = document.documentElement;
    // Guests are ALWAYS Light (owner 2026-08-28) — pinned, so the prefers-color-scheme media query
    // cannot darken a logged-out app.
    if (!auth.signedIn) { d.setAttribute('data-theme', 'light'); return; }
    if (mode === 'system') d.removeAttribute('data-theme');
    else d.setAttribute('data-theme', mode);
  }, [mode, auth]);

  const resolved = resolveAppTheme(auth.signedIn, mode, systemDark);
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

// A subtree pinned to the LIGHT design regardless of the user's appearance (owner 2026-08-29: the
// Agent/chat screen is white/light by design — dark mode continues elsewhere). Two halves, one
// wrapper: the data-ez-light attribute re-resolves every var() token to light (palette.ts), and the
// overridden context makes the resolved-theme consumers inside (useTheme/useThemeColors and the
// parser-site hooks in lib/appearance.ts — hero asset, gradients, interpolations, the sidebar's
// dark overrides) agree with what the CSS is painting. mode/setMode pass through untouched, so the
// appearance CONTROLS inside the subtree still read and change the real app-wide preference.
export function ForceLightTheme({ children, container }: { children: ReactNode; container?: 'fill' | 'bare' }) {
  const parent = useTheme();
  const value = useMemo<ThemeValue>(
    () => ({ ...parent, resolved: 'light', colors: themeColors('light') }),
    [parent],
  );
  // 'fill' (default) stretches — for wrapping a whole screen. 'bare' imposes no layout of its own —
  // for wrapping a fixed-width child like the docked sidebar inside the root row.
  return (
    <Ctx.Provider value={value}>
      <View style={container === 'bare' ? null : { flex: 1 }} {...(Platform.OS === 'web' ? { dataSet: { ezLight: '1' } } : null)}>
        {children}
      </View>
    </Ctx.Provider>
  );
}
