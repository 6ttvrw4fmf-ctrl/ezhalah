import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import type { Listing } from '@/data/listings';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { runAfterAnimation } from '@/lib/afterAnimation';
import { listingOpenUrl } from '@/lib/openListing';
import { listingLocationAr } from '@/lib/listingDisplay';
import { SourceBadge } from '@/components/ResultCard';

// THE IN-APP AD VIEWER, v2 (owner review 2026-10-03; tab list: lib/inAppViewer.ts).
//
// The owner's reference is the Claude desktop app: a content column plus a browser PANE WITH TABS
// beside it. Two shapes, one component:
//   • split (laptop, ≥ VIEWER_SPLIT_BREAKPOINT): a full-height mini-browser BESIDE the results —
//     «the property card gets smaller a bit … and beside me on my right is the tabs, whenever I
//     click a new tab pops up». A TAB STRIP sits on top: each allowed card click opens a new tab
//     (site logo + the listing's location), clicking an open card's tab refronts it, every tab has
//     its own ✕, and closing the last tab closes the pane (results back to full width, same scroll).
//     Background tabs keep their iframes MOUNTED (display:none) so switching back is instant.
//   • sheet (phone): NOT a full-screen takeover («we don't want it to be fully zoomed in») — a
//     ~88%-height sheet with rounded top corners and a grabber, Ezhalah dimmed but visible behind.
//     Drag down (1:1, momentum-projected release, velocity handed to the spring), tap the dim, ✕,
//     Escape, and the browser Back gesture all close it.
// The embedded page is the site's real page with the site's own headers — no proxy, nothing
// stripped. Chrome is Ezhalah: paper strip, white active tab with a tint hairline, green accents
// only — no solid green blocks. Loading: a calm cover per tab; after LOAD_TIMEOUT_MS without a load
// event, «تعذر عرض الإعلان هنا» + «فتح في نافذة جديدة» — never a bare browser error.
//
// Motion: critically-damped springs on transform/opacity only; enter and exit share one path
// (pane: from/to the right edge; sheet: from/to the bottom). Reduced motion → short cross-fade.

const IS_WEB = Platform.OS === 'web';
const LOAD_TIMEOUT_MS = 12_000;
// Marker on the history entry this viewer pushes; see the history effect below.
const HISTORY_MARK = 'ezAdViewer';
// Apple's "sheet" response (~0.3s), damping ratio ≈ 1 → settles with no overshoot.
const SPRING = { stiffness: 320, damping: 36, mass: 1, useNativeDriver: false } as const;

const tabKey = (l: Listing) => `${l.source}:${l.id}`;

export default function AdViewer({ tabs, active, split, hint, onSelect, onCloseTab, onCloseAll }: {
  tabs: Listing[];
  active: number;
  split: boolean;
  /** Transient note shown over the page (e.g. the oldest tab was evicted at the cap). */
  hint?: string;
  onSelect: (i: number) => void;
  onCloseTab: (i: number) => void;
  onCloseAll: () => void;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const { height: winH } = useWindowDimensions();
  // The sheet stops short of the top so Ezhalah stays visible behind it (owner: not fully zoomed in).
  const sheetH = Math.round(winH * 0.88);
  const sheetHRef = useRef(sheetH); sheetHRef.current = sheetH;
  const current = tabs[Math.min(active, tabs.length - 1)];
  const activeUrl = current ? (listingOpenUrl(current) ?? '') : '';

  // 0 = off its edge, 1 = in place. dragY adds the sheet's live finger offset on top.
  const progress = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const onCloseRef = useRef(onCloseAll);
  onCloseRef.current = onCloseAll;
  const motionTo = (toValue: 0 | 1) => reduced
    ? Animated.timing(progress, { toValue, duration: 160, useNativeDriver: false })
    : Animated.spring(progress, { toValue, ...SPRING });
  useEffect(() => { motionTo(1).start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    // The exit motion is decoration; closing is the function. runAfterAnimation() hands off when the
    // spring settles — or from its own timer if rAF is stalled — never later, never twice.
    runAfterAnimation((done) => motionTo(0).start(done), () => onCloseRef.current(), 450);
  };
  // ✕ / Escape / last tab closed: pop our history entry (its popstate dismisses), or dismiss directly.
  const requestClose = () => {
    if (IS_WEB && window.history.state?.[HISTORY_MARK]) { window.history.back(); return; }
    dismiss();
  };
  const requestCloseRef = useRef(requestClose); requestCloseRef.current = requestClose;
  // Drag-to-close commits along the gesture's own path: finish the slide at the finger's velocity
  // (§5 velocity handoff), popping our history entry silently (closingRef gates the popstate dismiss).
  const dragClose = (velocity: number) => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (IS_WEB) { try { if (window.history.state?.[HISTORY_MARK]) window.history.back(); } catch {} }
    runAfterAnimation(
      (done) => Animated.spring(dragY, { toValue: sheetHRef.current, velocity, ...SPRING }).start(done),
      () => onCloseRef.current(), 400,
    );
  };
  const dragCloseRef = useRef(dragClose); dragCloseRef.current = dragClose;

  // BACK CLOSES THE VIEWER, NOT THE CHAT (web). One extra history entry on the same URL, carrying the
  // router's current state plus our marker: Back lands on the router's own identical record (a no-op
  // for it), and a later Forward onto our entry still names a route the router recognises.
  useEffect(() => {
    if (!IS_WEB) return;
    try { window.history.pushState({ ...(window.history.state ?? {}), [HISTORY_MARK]: true }, ''); } catch {}
    const onPop = () => dismiss();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestCloseRef.current(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sheet drag (grabber row) — the SAME Pointer Events + capture machinery the sign-in drag uses
  // (lib/cardDrag.ts; PanResponder proved unreliable on RNW here): 1:1 tracking from the grab,
  // a 120ms-recency velocity window (drag → pause → release drops in place; a live flick still
  // throws), rubber-band above the resting point, momentum-projected release (d≈0.998), and the
  // release velocity handed to the settle/close spring so there is no seam between finger and motion.
  const project = (v: number, d = 0.998) => (v / 1000) * d / (1 - d);
  const rubber = (over: number) => (over * sheetHRef.current * 0.55) / (sheetHRef.current + 0.55 * Math.abs(over));
  const grabRef = (node: any) => {
    if (!IS_WEB || !node || node.__ezSheetDrag) return;
    node.__ezSheetDrag = true;
    node.style.touchAction = 'none';
    let dragging = false;
    let startY = 0;
    let hist: { y: number; t: number }[] = [];
    const onDown = (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      hist = [{ y: e.clientY, t: performance.now() }];
      try { node.setPointerCapture(e.pointerId); } catch { /* uncaptured: still tracks over the grip */ }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      hist.push({ y: e.clientY, t: performance.now() });
      while (hist.length > 2 && performance.now() - hist[0].t > 120) hist.shift();
      dragY.setValue(dy > 0 ? dy : rubber(dy));
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const first = hist[0];
      const last = hist[hist.length - 1];
      const dy = last.y - startY;
      const vPxS = ((last.y - first.y) / Math.max(1, last.t - first.t)) * 1000;
      if (dy + project(vPxS) > sheetHRef.current * 0.33) dragCloseRef.current(Math.max(vPxS, 0));
      else Animated.spring(dragY, { toValue: 0, velocity: vPxS, ...SPRING }).start();
    };
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  };

  const openNewTab = () => { if (IS_WEB && activeUrl) window.open(activeUrl, '_blank', 'noopener,noreferrer'); };

  const chrome = (
    <View style={s.chrome}>
      {!split && (
        <View style={s.grabberRow} ref={grabRef}>
          <View style={s.grabber} />
        </View>
      )}
      <View style={s.tabRow}>
        <ScrollView horizontal style={{ flex: 1 }} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabStrip}>
          {tabs.map((l, i) => {
            const on = i === active;
            return (
              <Pressable key={tabKey(l)} testID="ad-tab" onPress={() => onSelect(i)} style={[s.tab, on && s.tabOn]}>
                {/* SourceBadge is the one logo resolver in the app; a tab slot is smaller than its
                    frame, so it renders scaled inside a clipped slot rather than forking a second
                    size-threaded copy of its 60 brand branches. */}
                <View style={s.tabLogo} pointerEvents="none">
                  <View style={{ transform: [{ scale: 0.44 }] }}><SourceBadge source={l.source} /></View>
                </View>
                <Text numberOfLines={1} style={[s.tabTx, on && s.tabTxOn]}>{listingLocationAr(l)}</Text>
                <Pressable
                  testID="ad-tab-close"
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('Close')}
                  onPress={(e: any) => { e?.stopPropagation?.(); if (tabs.length === 1) requestClose(); else onCloseTab(i); }}
                  style={s.tabX}
                >
                  <Ionicons name="close" size={13} color={on ? colors.primary : colors.muted} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
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
        {!split && (
          <Pressable
            testID="ad-viewer-close"
            onPress={requestClose}
            accessibilityRole="button"
            accessibilityLabel={t('Close')}
            style={s.close}
            // @ts-expect-error web-only DOM props on the RNW host node (44px tap floor)
            dataSet={{ ...TAP44 }}
          >
            <Ionicons name="close" size={20} color={colors.ink} />
          </Pressable>
        )}
      </View>
    </View>
  );

  const body = (
    <View style={s.body}>
      {/* Every open tab stays mounted; only the active one is displayed — switching is instant. */}
      {tabs.map((l, i) => <TabFrame key={tabKey(l)} listing={l} visible={i === active} t={t} />)}
      {hint ? (
        <View style={s.hintWrap} pointerEvents="none"><Text style={s.hintTx}>{hint}</Text></View>
      ) : null}
    </View>
  );

  if (split) {
    const motion = reduced
      ? { opacity: progress }
      : { opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }] };
    return (
      <Animated.View testID="ad-viewer" style={[s.split, motion]}>
        {chrome}
        {body}
      </Animated.View>
    );
  }

  const sheetMotion = reduced
    ? { opacity: progress }
    : { transform: [{ translateY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [sheetH, 0] }), dragY) }] };
  return (
    <View testID="ad-viewer" style={s.overlay} pointerEvents="box-none">
      <Animated.View style={[s.dim, { opacity: progress }]}>
        <Pressable testID="ad-viewer-dim" onPress={requestClose} accessibilityLabel={t('Close')} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View testID="ad-viewer-sheet" style={[s.sheet, { height: sheetH }, sheetMotion]}>
        {chrome}
        {body}
      </Animated.View>
    </View>
  );
}

// One tab's page: its own iframe, its own calm cover, its own 12s fallback. Mounted for the tab's
// whole life (hidden when inactive) so refronting never reloads the site.
function TabFrame({ listing, visible, t }: { listing: Listing; visible: boolean; t: (k: string) => string }) {
  const url = listingOpenUrl(listing) ?? '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded || failed) return;
    const id = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [loaded, failed]);
  const openNewTab = () => { if (IS_WEB && url) window.open(url, '_blank', 'noopener,noreferrer'); };
  const Frame: any = 'iframe';
  return (
    <View style={[s.page, !visible && s.pageHidden]}>
      {!failed && (
        <Frame
          src={url}
          title={host}
          onLoad={() => setLoaded(true)}
          // The ad must work like the site opened in Safari (owner 2026-10-03: «he can continue doing so
          // if he wants»): a Gathern booking reaches Apple Pay / card checkout INSIDE this frame, and
          // a cross-origin frame may only run Apple Pay / Payment Request when the embedder delegates
          // `payment`. `storage-access` lets the site ask Safari to keep its own login inside us.
          allow="fullscreen; payment; storage-access; clipboard-write"
          // Full CSS width of the pane/sheet — the frame IS the site's viewport, so a responsive
          // page's width=device-width resolves to this true width (owner: no zoomed-in rendering).
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
  );
}

const s = StyleSheet.create({
  // Full height on the PHYSICAL RIGHT of the results (owner's word — see agent.tsx); hairline on its
  // left edge and a soft symmetric shadow spill, so the pane reads a step above the list.
  split: {
    width: '44%', minWidth: 420, maxWidth: 640,
    backgroundColor: colors.surface,
    borderLeftWidth: 1, borderColor: colors.line,
    boxShadow: '0 0 32px rgba(20,40,30,0.14)',
    zIndex: 2,
  },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, justifyContent: 'flex-end' },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
    boxShadow: '0 -12px 40px rgba(8,18,12,0.25)',
  },
  chrome: { backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line },
  grabberRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 7 }, // tall enough to grab
  grabber: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.line },
  tabRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 6, gap: 4 },
  tabStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 34, paddingStart: 6, paddingEnd: 2, borderRadius: 10,
    borderWidth: 1, borderColor: 'transparent', maxWidth: 190,
  },
  tabOn: { backgroundColor: colors.surface, borderColor: colors.tintLine, boxShadow: '0 1px 4px rgba(20,40,30,0.08)' },
  tabLogo: { width: 42, height: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tabTx: { fontSize: 11.5, color: colors.muted, maxWidth: 92, flexShrink: 1 },
  tabTxOn: { color: colors.ink },
  tabX: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  newTab: {
    height: 32, paddingHorizontal: 10, borderRadius: radius.pill,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.tintLine, backgroundColor: colors.surface, flexShrink: 0,
  },
  newTabTx: { fontSize: 12.5, color: colors.primary },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hover: { backgroundColor: colors.tint },
  body: { flex: 1, backgroundColor: colors.surface },
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  pageHidden: { display: 'none' },
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, backgroundColor: colors.surface },
  coverTx: { fontSize: 13, color: colors.muted },
  failTx: { fontSize: 15, color: colors.ink, textAlign: 'center' },
  failBtn: { height: 40, paddingHorizontal: 16, backgroundColor: colors.tint },
  hintWrap: {
    position: 'absolute', top: 8, alignSelf: 'center',
    backgroundColor: colors.tint, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: colors.tintLine,
  },
  hintTx: { fontSize: 12, color: colors.chipIcon },
});
