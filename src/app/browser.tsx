import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import type { Listing } from '@/data/listings';
import { useApp } from '@/store';
import { useI18n } from '@/i18n';
import { openListing } from '@/lib/openListing';

const IS_WEB = Platform.OS === 'web';

// In-app listing viewer. The user stays INSIDE Ezhalah and sees Aqar's REAL page:
//   • WEB: an iframe pointing at our /api/proxy (which fetches Aqar server-side and strips the
//     x-frame-options header so it CAN be embedded). A top-left button opens the real Aqar tab if
//     they'd rather view it directly; top-right closes back to the results.
//   • NATIVE: an in-app browser overlay (Chrome Custom Tab / Safari VC via expo-web-browser), which
//     shows the real page without leaving the app; we then pop this route.
// (user request: open inside the platform, with a top-left button to go out to Aqar/Google.)
export default function Browser() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { trackOpen, findListing } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [resolving, setResolving] = useState(true);
  // The proxied Aqar page fetches ~170KB of CSS/JS through our proxy, so it styles itself a beat
  // after the HTML appears. We cover the iframe with a spinner until it fully loads (iframe onLoad,
  // or a safety timeout) so the user never sees the raw unstyled flash. (user-reported.)
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // If the proxied page doesn't load within ~12s, treat it as a failure and show a graceful in-app
  // fallback (Reload / Open on AQAR) instead of Chrome's bare "couldn't load" page. Proxying a live
  // site is intermittently flaky, so we never leave the user stuck. (user-reported.)
  useEffect(() => {
    if (frameLoaded || frameError) return;
    const tmr = setTimeout(() => { if (!frameLoaded) setFrameError(true); }, 12000);
    return () => clearTimeout(tmr);
  }, [frameLoaded, frameError, reloadKey]);

  useEffect(() => {
    let alive = true;
    setResolving(true);
    findListing(Number(id)).then((l) => {
      if (!alive) return;
      setListing(l);
      setResolving(false);
      if (l) trackOpen(l);
      // NATIVE: hand off to the in-app browser overlay and close this route.
      if (l && !IS_WEB) { void openListing(l); router.back(); }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Localize the partner URL to the app language (Aqar has an /en variant).
  const localize = (url?: string | null): string | undefined => {
    if (!url) return undefined;
    if (locale !== 'en') return url;
    const m = url.match(/^(https?:\/\/sa\.aqar\.fm)(\/.*)$/);
    if (!m) return url;
    if (m[2].startsWith('/en/') || m[2] === '/en') return url;
    return `${m[1]}/en${m[2]}`;
  };
  const realUrl = localize(listing?.source_url);
  const proxyUrl = realUrl ? `/api/proxy?url=${encodeURIComponent(realUrl)}` : undefined;

  if (resolving || (!IS_WEB && listing)) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  if (!listing || !proxyUrl) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <Text>{t('Listing not found.')}</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.primary, marginTop: 8 }}>{t('Done')}</Text></Pressable>
      </View>
    );
  }

  // WEB: proxied iframe modal over the dimmed app.
  return (
    <>
      {(() => {
        const Style: any = 'style';
        return (
          <Style>{`
            @keyframes ezhalah-backdrop-in { from { opacity: 0 } to { opacity: 1 } }
            @keyframes ezhalah-card-in { from { opacity: 0; transform: scale(0.96) translateY(10px) } to { opacity: 1; transform: scale(1) translateY(0) } }
          `}</Style>
        );
      })()}
      {(() => {
        const Overlay: any = 'div';
        const Card: any = 'div';
        const Frame: any = 'iframe';
        return (
          // Full-screen flex overlay → guarantees the card is CENTERED regardless of viewport/RTL.
          // Clicking the dim area (outside the card) closes; clicking inside the card does not.
          <Overlay
            onClick={() => router.back()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,12,0.55)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2.5vh 2vw', boxSizing: 'border-box', animation: 'ezhalah-backdrop-in 220ms ease-out both' }}
          >
            <Card
              onClick={(e: any) => e.stopPropagation()}
              style={{ position: 'relative', width: 'min(1100px, 96vw)', height: '95vh', background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 50px rgba(8,18,12,0.35)', display: 'flex', flexDirection: 'column', animation: 'ezhalah-card-in 320ms cubic-bezier(0.2,0.8,0.2,1) both' }}
            >
              {/* Top-left: open the REAL Aqar page in a new tab (leaves the platform on purpose). */}
              <Pressable
                onPress={() => { if (typeof window !== 'undefined') window.open(realUrl, '_blank', 'noopener,noreferrer'); }}
                style={({ hovered }: any) => ({ position: 'absolute' as any, top: 12, left: 12, zIndex: 10, height: 34, paddingHorizontal: 13, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: hovered ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' })}
              >
                <Ionicons name="open-outline" size={15} color={colors.primary} />
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.ink }}>{t('Open on AQAR')}</Text>
              </Pressable>
              {/* Top-right: close, back to results. */}
              <Pressable
                onPress={() => router.back()}
                style={({ hovered }: any) => ({ position: 'absolute' as any, top: 12, right: 12, zIndex: 10, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' })}
              >
                <Ionicons name="close" size={18} color={colors.ink} />
              </Pressable>
              {/* The real Aqar page, proxied so it can be framed. sandbox WITHOUT allow-top-navigation
                  blocks any framebusting script from yanking the user out of Ezhalah. */}
              <Frame
                key={reloadKey}
                src={proxyUrl}
                onLoad={() => setFrameLoaded(true)}
                onError={() => setFrameError(true)}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#fff' }}
              />
              {/* Spinner overlay until the proxied page is fully loaded + styled — hides the raw flash. */}
              {!frameLoaded && !frameError ? (
                <View style={s.frameLoading} pointerEvents="none">
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={s.frameLoadingText}>{t('Loading listing…')}</Text>
                </View>
              ) : null}
              {/* Graceful failure (proxy hiccup) — our own retry + Open-on-AQAR, never Chrome's error. */}
              {frameError ? (
                <View style={s.frameLoading}>
                  <Ionicons name="cloud-offline-outline" size={40} color={colors.muted} />
                  <Text style={[s.frameLoadingText, { fontSize: 15 }]}>{t("Couldn't load the preview here.")}</Text>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                    <Pressable
                      onPress={() => { setFrameError(false); setFrameLoaded(false); setReloadKey((k) => k + 1); }}
                      style={s.retryBtn}
                    >
                      <Ionicons name="refresh" size={15} color="#fff" />
                      <Text style={s.retryBtnText}>{t('Reload')}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { if (typeof window !== 'undefined') window.open(realUrl, '_blank', 'noopener,noreferrer'); }}
                      style={s.retryBtnOutline}
                    >
                      <Ionicons name="open-outline" size={15} color={colors.primary} />
                      <Text style={s.retryBtnOutlineText}>{t('Open on AQAR')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </Card>
          </Overlay>
        );
      })()}
    </>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  frameLoading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', gap: 12 },
  frameLoadingText: { fontSize: 13.5, color: colors.muted, fontWeight: '600' },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 16 },
  retryBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  retryBtnOutline: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tint, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 16 },
  retryBtnOutlineText: { color: colors.primary, fontSize: 13.5, fontWeight: '700' },
});
