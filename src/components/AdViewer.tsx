import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import type { Listing } from '@/data/listings';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { runAfterAnimation } from '@/lib/afterAnimation';
import { listingOpenUrl } from '@/lib/openListing';
import { SourceBadge } from '@/components/ResultCard';

// THE IN-APP AD VIEWER (owner 2026-10-03, practice version for two sites — see lib/inAppViewer.ts).
//
// «When someone clicks the property card, he doesn't leave our site.» The source site's REAL ad page
// renders in a plain <iframe>, with the site's own headers — no proxy, nothing stripped. Two shapes,
// one component:
//   • split (laptop, ≥ VIEWER_SPLIT_BREAKPOINT): a full-height panel BESIDE the results. The results
//     column simply gets narrower; it never unmounts, so ✕ returns it at the same scroll position.
//     The panel sits at the inline-end — left in Arabic, right in English — so the results keep their
//     reading-start edge and the ad reads as the next step in the reading direction.
//   • sheet (phone): a full-screen sheet that slides up over the results. Same header, same ✕.
// The slim header carries the site's logo + host, «فتح في نافذة جديدة» (the old new-tab path, always
// one tap away) and ✕. The browser Back button/gesture also closes it (one history entry).
//
// Motion: one critically-damped spring on transform + opacity only (no per-frame layout work) —
// the surface arrives from its edge and leaves the same way. Reduced motion → a short cross-fade.
// Loading: a calm cover until the frame's load event; after LOAD_TIMEOUT_MS without one we say so
// («تعذر عرض الإعلان هنا») and offer the new window — never a bare browser error page.

const IS_WEB = Platform.OS === 'web';
const LOAD_TIMEOUT_MS = 12_000;
// Marker on the history entry this viewer pushes; see the history effect below.
const HISTORY_MARK = 'ezAdViewer';
// Apple's "sheet" response (~0.3s), damping ratio ≈ 1 → settles with no overshoot.
const SPRING = { stiffness: 320, damping: 36, mass: 1, useNativeDriver: false } as const;

export default function AdViewer({ listing, split, onClose }: { listing: Listing; split: boolean; onClose: () => void }) {
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const rtl = isRTL;
  const url = listingOpenUrl(listing) ?? '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}

  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Swapping to another card (clicking a second allowed listing) keeps the surface and only reloads
  // the frame — spatially it is the same panel showing a different page.
  useEffect(() => { setLoaded(false); setFailed(false); }, [url]);
  useEffect(() => {
    if (loaded || failed) return;
    const id = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [loaded, failed, url]);

  // 0 = off its edge, 1 = in place.
  const progress = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const motionTo = (toValue: 0 | 1) => reduced
    ? Animated.timing(progress, { toValue, duration: 160, useNativeDriver: false })
    : Animated.spring(progress, { toValue, ...SPRING });
  useEffect(() => { motionTo(1).start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    // The exit motion is decoration; closing is the function. runAfterAnimation() hands off when the
    // spring settles — or from its own timer if rAF is stalled (backgrounded tab) — never later, never
    // twice. See lib/afterAnimation.ts and verify-nav-not-gated-on-animation.ts.
    runAfterAnimation((done) => motionTo(0).start(done), () => onCloseRef.current(), 450);
  };
  // ✕ / Escape: pop our own history entry (its popstate dismisses), or dismiss directly if it is gone.
  const requestClose = () => {
    if (IS_WEB && window.history.state?.[HISTORY_MARK]) { window.history.back(); return; }
    dismiss();
  };
  const openNewTab = () => { if (IS_WEB && url) window.open(url, '_blank', 'noopener,noreferrer'); };

  // BACK CLOSES THE VIEWER, NOT THE CHAT (web). One extra history entry on the same URL, carrying the
  // router's current state plus our marker: Back lands on the router's own identical record (a
  // no-op for it), and if the user later returns Forward onto our entry the router still recognises
  // the route. If this unmounts for another reason (navigation), the router's push/replace simply
  // builds on top of or over the entry — nothing to undo.
  useEffect(() => {
    if (!IS_WEB) return;
    try { window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_MARK]: true }, ''); } catch {}
    const onPop = () => dismiss();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const motion = reduced
    ? { opacity: progress }
    : split
      ? { opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [rtl ? -48 : 48, 0] }) }] }
      : { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: ['100%', '0%'] }) }] };

  const Frame: any = 'iframe';
  return (
    <Animated.View testID="ad-viewer" style={[split ? s.split : s.sheet, motion]}>
      <View style={[s.head, !split && { paddingTop: insets.top }]}>
        <View style={s.site}>
          <SourceBadge source={listing.source} />
          <Text style={s.host} numberOfLines={1}>{host}</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={openNewTab}
          accessibilityRole="link"
          style={({ hovered }: any) => [s.newTab, hovered && s.hover]}
          // @ts-expect-error web-only DOM props on the RNW host node (44px tap floor)
          dataSet={{ ...TAP44 }}
        >
          <Ionicons name="open-outline" size={15} color={colors.primary} />
          <Text style={s.newTabTx}>{t('Open in a new window')}</Text>
        </Pressable>
        <Pressable
          testID="ad-viewer-close"
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          style={({ hovered }: any) => [s.close, hovered && s.hover]}
          // @ts-expect-error web-only DOM props on the RNW host node (44px tap floor)
          dataSet={{ ...TAP44 }}
        >
          <Ionicons name="close" size={20} color={colors.ink} />
        </Pressable>
      </View>
      <View style={s.body}>
        {!failed && (
          <Frame
            key={url}
            src={url}
            title={host}
            onLoad={() => setLoaded(true)}
            allow="fullscreen"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: '#fff' }}
          />
        )}
        {!loaded && !failed && (
          <View style={[s.cover, { pointerEvents: 'none' }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={s.coverTx}>{t('Loading listing…')}</Text>
          </View>
        )}
        {failed && (
          <View style={s.cover}>
            <Text style={s.failTx}>{t('This ad can’t be shown here')}</Text>
            <Pressable onPress={openNewTab} accessibilityRole="link" style={({ hovered }: any) => [s.newTab, s.failBtn, hovered && s.hover]}>
              <Ionicons name="open-outline" size={16} color={colors.primary} />
              <Text style={s.newTabTx}>{t('Open in a new window')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Full height beside the results; a hairline on the results side and a soft spill of shadow onto
  // them, so the panel reads as a sheet floating a step above the list.
  split: {
    width: '44%', minWidth: 420, maxWidth: 640,
    backgroundColor: colors.surface,
    borderStartWidth: 1, borderColor: colors.line,
    boxShadow: '0 0 32px rgba(20,40,30,0.14)',
    zIndex: 2,
  },
  sheet: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, zIndex: 50 },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 52, paddingHorizontal: 8,
    backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  site: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  host: { fontSize: 13, color: colors.ink, flexShrink: 1 },
  newTab: {
    height: 34, paddingHorizontal: 12, borderRadius: radius.pill,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.tintLine, backgroundColor: colors.surface,
  },
  newTabTx: { fontSize: 13, color: colors.primary },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hover: { backgroundColor: colors.tint },
  body: { flex: 1, backgroundColor: colors.surface },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, backgroundColor: colors.surface },
  coverTx: { fontSize: 13, color: colors.muted },
  failTx: { fontSize: 15, color: colors.ink, textAlign: 'center' },
  failBtn: { height: 40, paddingHorizontal: 16, backgroundColor: colors.tint },
});
