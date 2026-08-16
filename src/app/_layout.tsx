import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from '@/store';
import { LocaleProvider, useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';
import { shouldSendRefreshHome } from '@/lib/webRefreshRoute';
import { markAppSessionStarted } from '@/lib/appSession';
import Sidebar, { useDocked } from '@/components/Sidebar';
import InfoModal from '@/components/InfoModal';
import AuthModal from '@/components/AuthModal';
import GoogleOneTap from '@/components/GoogleOneTap';
import IntroVideo from '@/components/IntroVideo';

// RC-A (hardening 2026-07-13): last-resort net. Nothing in the app caught unhandled promise
// rejections or uncaught errors, so an async turn that escaped its handler failed silently. Log every
// one once, so a silent wedge becomes a visible, debuggable signal (and a future Batch-0 telemetry
// sink can forward it). Web-only registration (the primary surface); harmless no-op elsewhere.
if (Platform.OS === 'web' && typeof globalThis !== 'undefined' && !(globalThis as any).__ezhalahGlobalHandlers) {
  (globalThis as any).__ezhalahGlobalHandlers = true;
  globalThis.addEventListener?.('unhandledrejection', (ev: any) => {
    // eslint-disable-next-line no-console
    console.error('[ezhalah] unhandled promise rejection:', ev?.reason);
  });
  globalThis.addEventListener?.('error', (ev: any) => {
    // eslint-disable-next-line no-console
    console.error('[ezhalah] uncaught error:', ev?.error || ev?.message);
  });
}

// On a wide web viewport the sidebar is a permanent column pinned to the LEFT edge of every screen
// (same side in Arabic and English — per product decision), with the Stack filling the rest. Because
// the document is RTL in Arabic, a plain `flexDirection: 'row'` would auto-mirror the sidebar to the
// right; `row-reverse` under RTL cancels that mirroring so the sidebar (the first child) stays on the
// physical left in both locales. On mobile/native it collapses away into a tap-to-open drawer.
function Shell() {
  const docked = useDocked();
  const { isRTL } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  // On the web, a hard refresh reloads whatever deep route the user was on (e.g. /agent, /settings) —
  // and for screens whose flow state lives in memory only, that screen would come back empty, so the
  // refresh is sent back to Home instead. Runs once on mount; client-side navigation afterwards is
  // untouched. '/auth' is exempt so an OAuth redirect can still land there and finish signing in.
  // EXCEPTION (QA 2026-08-14): `/agent?filter=<JSON SearchQuery>` (and `?seed=…`) carries the whole
  // search in the URL and re-runs itself on open, so it does NOT come back empty — sending it Home
  // was silently dropping every selection on refresh (المدينة, الأحياء, «سنوي»/«شهري», السعر,
  // المساحة, غرف النوم, فئة/نوع) and breaking bookmarked/shared result links. The decision lives in
  // shouldSendRefreshHome() so scripts/verify-refresh-restores-filter-search.ts can execute it.
  const homedRef = useRef(false);
  useEffect(() => {
    if (homedRef.current) return;
    homedRef.current = true;
    // Open the app session AFTER this load's screen effects have run (see lib/appSession.ts): from
    // here on, params reaching a screen are in-app navigation and may run a search. During the load
    // itself they are page-load params and must not. This is what stops a refresh from re-issuing
    // the AI call and the property RPC. (owner 2026-08-16.)
    const t = setTimeout(markAppSessionStarted, 0);
    if (Platform.OS !== 'web') return () => clearTimeout(t);
    const search = typeof window !== 'undefined' ? window.location.search : '';
    if (shouldSendRefreshHome(pathname, search)) router.replace('/');
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ flex: 1, flexDirection: isRTL ? 'row-reverse' : 'row' }}>
      {/* /auth is a focused full-screen moment — no docked sidebar there. */}
      {docked && pathname !== '/auth' && <Sidebar docked onClose={() => {}} />}
      {/* One-click Google sign-in prompt (web, signed-out only) — renders its own corner UI. */}
      <GoogleOneTap />
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.paper },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'fade' }} />
          <Stack.Screen name="agent" options={{ animation: 'none' }} />
          <Stack.Screen name="interview" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="settings" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="about" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="support" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          {/* Auth opens with a soft fade (not the abrupt slide-up-with-X) — the screen's own content
              entrance (rise + scale + fade, incl. the close X) then carries the motion. (user request.) */}
          <Stack.Screen name="auth" options={{ presentation: 'modal', animation: 'fade' }} />
          <Stack.Screen name="browser" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </View>
      {/* Support / About Us popups — rendered at the root so they overlay every screen. */}
      <InfoModal />
      {/* Sign-in popup — rendered at the root, same reason: a true overlay on top of whatever screen
          is active (owner 2026-08-15), never a route the user navigates to. */}
      <AuthModal />
      {/* First-run cinematic intro — overlays everything; shows once for new logged-out visitors. */}
      <IntroVideo />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LocaleProvider>
        <AppProvider>
          <StatusBar style="dark" />
          <Shell />
        </AppProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
