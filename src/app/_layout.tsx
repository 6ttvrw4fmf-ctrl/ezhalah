import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from '@/store';
import { initObservability, reportError } from '@/lib/observability';
import { LocaleProvider, useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';
import { ThemeProvider, useTheme } from '@/theme/theme';
import { shouldSendRefreshHome } from '@/lib/webRefreshRoute';
import { markAppSessionStarted } from '@/lib/appSession';
import { useBottomPromptInset } from '@/lib/bottomPromptInset';
import Head from 'expo-router/head';
import { OG_IMAGE, SHARE_BLURB_AR, SHARE_LINK, SHARE_TITLE_AR } from '@/lib/share';
import Sidebar, { useDocked } from '@/components/Sidebar';
import InfoModal from '@/components/InfoModal';
import AuthModal from '@/components/AuthModal';
import SignInCard from '@/components/SignInCard';
import GoogleOneTap from '@/components/GoogleOneTap';
import IntroVideo from '@/components/IntroVideo';

// RC-A (hardening 2026-07-13): last-resort net. Nothing in the app caught unhandled promise
// rejections or uncaught errors, so an async turn that escaped its handler failed silently. Log every
// one once, so a silent wedge becomes a visible, debuggable signal (and a future Batch-0 telemetry
// sink can forward it). Web-only registration (the primary surface); harmless no-op elsewhere.
// Observability: initialize BEFORE the global handlers register so the very first thrown error
// during module evaluation still goes to Sentry. Safe-by-default — a build with no DSN is a
// no-op, so this line is harmless in every dev/preview/PR environment (owner 2026-08-26).
initObservability();
if (Platform.OS === 'web' && typeof globalThis !== 'undefined' && !(globalThis as any).__ezhalahGlobalHandlers) {
  (globalThis as any).__ezhalahGlobalHandlers = true;
  globalThis.addEventListener?.('unhandledrejection', (ev: any) => {
    // eslint-disable-next-line no-console
    console.error('[ezhalah] unhandled promise rejection:', ev?.reason);
    reportError(ev?.reason ?? new Error('unhandledrejection'), { source: 'unhandledrejection' });
  });
  globalThis.addEventListener?.('error', (ev: any) => {
    // eslint-disable-next-line no-console
    console.error('[ezhalah] uncaught error:', ev?.error || ev?.message);
    reportError(ev?.error ?? new Error(String(ev?.message ?? 'uncaught')), { source: 'window.error' });
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
  // Space occupied by a bottom-docked third-party prompt (Google One Tap's legacy bottom sheet on a
  // phone). 0 whenever nothing is docked there — see src/lib/bottomPromptInset.ts for the measured
  // bug this prevents: the sheet is `position:fixed; z-index:9999; pointer-events:auto` across the
  // bottom 144px, and without this the app laid «بحث» and the Agent composer out underneath it,
  // where every real tap landed on Google's iframe instead of the control.
  const bottomPromptInset = useBottomPromptInset();
  // APPEARANCE (owner 2026-08-28): the status bar follows the resolved theme. Screen content is
  // converted per-surface (Sidebar + account menu in this pass); the Stack's contentStyle stays the
  // light paper until each screen's inks are converted — flipping it first would break readability.
  const { resolved } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  // The AUTO-SHOWING centered popup (owner 2026-08-28) was RETIRED by the owner's 2026-08-29
  // revision: the unprompted invitation is now the small draggable SignInCard mounted below, and
  // the centered AuthModal opens ONLY on explicit sign-in controls via openAuth().
  // On the web, a hard refresh reloads whatever deep route the user was on (e.g. /agent, /settings) —
  // and for screens whose flow state lives in memory only, that screen would come back empty, so the
  // refresh is sent back to Home instead. Runs once on mount; client-side navigation afterwards is
  // untouched. '/auth' is exempt so an OAuth redirect can still land there and finish signing in.
  // `/agent` used to be exempted here (it re-ran `?filter=` on open, so it did not come back empty).
  // Both halves of that changed on 2026-08-16 by owner decision: a reload may no longer re-run any
  // search (appSession gate), and — since that left an empty AI chat — a reload now lands on the
  // Filter home like every other deep route. The decision lives in shouldSendRefreshHome() so
  // scripts/verify-refresh-restores-filter-search.ts can execute it rather than grep for it.
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
    <View style={{ flex: 1, flexDirection: isRTL ? 'row-reverse' : 'row', paddingBottom: bottomPromptInset }}>
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      {/* /auth is a focused full-screen moment — no docked sidebar there. The /agent light-pin
          special-case (owner 2026-08-29) was reversed 2026-08-30: dark mode is global and sticky,
          so the docked sidebar now respects the app-wide theme on every route, /agent included. */}
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
          {/* The /settings route is GONE (owner 2026-08-28): account controls open as a compact
              panel anchored to the sidebar's profile row — see components/AccountMenu.tsx. */}
          {/* /about and /support are DOORS, not screens (owner 2026-09-03): each one raises the
              canonical InfoModal and replaces the URL with '/'. No sheet animation — animating a
              redirect would slide an empty modal up and straight back down. */}
          <Stack.Screen name="about" options={{ animation: 'none' }} />
          <Stack.Screen name="support" options={{ animation: 'none' }} />
          {/* Auth opens with a soft fade (not the abrupt slide-up-with-X) — the screen's own content
              entrance (rise + scale + fade, incl. the close X) then carries the motion. (user request.) */}
          <Stack.Screen name="auth" options={{ presentation: 'modal', animation: 'fade' }} />
          <Stack.Screen name="browser" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </View>
      {/* The small draggable sign-in card (owner 2026-08-29) — the UNPROMPTED invitation for
          signed-out desktop-web visitors on Filter/Agent, in the retired dock's side slot.
          Mounted AFTER the Stack deliberately so index-based input targeting (tests, autofill
          heuristics) keeps finding the screens' own inputs first. Visual layering is zIndex, not
          DOM order. */}
      <SignInCard />
      {/* Support / About Us popups — rendered at the root so they overlay every screen. */}
      <InfoModal />
      {/* Sign-in popup — rendered at the root, same reason: a true overlay on top of whatever screen
          is active (owner 2026-08-15), never a route the user navigates to. Since the 2026-08-29
          revision it opens ONLY via explicit sign-in controls (openAuth) — it never auto-raises. */}
      <AuthModal />
      {/* First-run cinematic intro — overlays everything; shows once for new logged-out visitors. */}
      <IntroVideo />
    </View>
  );
}

// SHARE METADATA — what a person receives, not what our own share sheet draws.
//
// The in-app ShareSheet has always rendered a handsome preview card with the eagle, the name and the
// tagline. That card is painted BY US and never leaves the app. WhatsApp, iMessage, X, Telegram and
// LinkedIn build their own card by fetching the page and reading these tags — and until now the page
// had NONE, so a shared Ezhalah link arrived as a bare grey URL. The app was showing the sender a
// preview the recipient could never get.
//
// WHY THIS LIVES IN <Head> AND NOT IN +html.tsx: expo-router renders the document title through
// react-helmet, and helmet's <title data-rh="true"> is emitted FIRST in <head>. A browser honours the
// first title it meets, so a <title> added further down +html.tsx is dead markup — which is exactly
// why every tab read "ezhalah-app.vercel.app" while an empty <title></title> sat above it. Routing
// the title through the same helmet instance is what actually fills it.
//
// og:image must be ABSOLUTE (a crawler has no origin to resolve a relative path against), and it is
// a crop of the eagle artwork already in the repo — see lib/share.ts.
function ShareMeta() {
  return (
    <Head>
      <title>{SHARE_TITLE_AR}</title>
      <meta name="description" content={SHARE_BLURB_AR} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SHARE_TITLE_AR} />
      <meta property="og:locale" content="ar_SA" />
      <meta property="og:title" content={SHARE_TITLE_AR} />
      <meta property="og:description" content={SHARE_BLURB_AR} />
      <meta property="og:url" content={SHARE_LINK} />
      <meta property="og:image" content={OG_IMAGE} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={SHARE_TITLE_AR} />
      {/* summary_large_image, not summary: the small variant crops the eagle to a square thumbnail. */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={SHARE_TITLE_AR} />
      <meta name="twitter:description" content={SHARE_BLURB_AR} />
      <meta name="twitter:image" content={OG_IMAGE} />
    </Head>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
        <LocaleProvider>
        <AppProvider>
          <ShareMeta />
          <Shell />
        </AppProvider>
        </LocaleProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
