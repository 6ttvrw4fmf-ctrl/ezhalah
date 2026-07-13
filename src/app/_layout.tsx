import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from '@/store';
import { LocaleProvider, useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';
import Sidebar, { useDocked } from '@/components/Sidebar';
import InfoModal from '@/components/InfoModal';
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
  // but the chat/flow state lives in memory and is gone, so that screen would come back empty. Send
  // every refresh back to Home instead. Runs once on mount; client-side navigation afterwards is
  // untouched. '/auth' is exempt so an OAuth redirect can still land there and finish signing in.
  const homedRef = useRef(false);
  useEffect(() => {
    if (homedRef.current) return;
    homedRef.current = true;
    if (Platform.OS === 'web' && pathname && pathname !== '/' && pathname !== '/auth') {
      router.replace('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={{ flex: 1, flexDirection: isRTL ? 'row-reverse' : 'row' }}>
      {docked && <Sidebar docked onClose={() => {}} />}
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
