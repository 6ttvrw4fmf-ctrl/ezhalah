import { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { runAfterAnimation } from '@/lib/afterAnimation';
import ListingPreview from '@/components/ListingPreview';
import type { Listing } from '@/data/listings';
import { SourceBadge } from '@/components/ResultCard';
import {
  EMPTY_FRAME_NAV, adTabKey, canFrameBack, canFrameForward, frameDropped,
  frameNavigated, frameStepped, splitUrlForDisplay, type AdTab, type FrameNav,
} from '@/lib/inAppViewer';

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
// only — no solid green blocks. Loading: the page shows AS SOON AS IT PAINTS, like a browser tab, with
// a thin progress bar on top; nothing covers it while it loads, and it is never torn down for being
// slow (see TabFrame).
//
// v3 (owner 2026-10-03: «make it seem like Safari / Chrome on the right side»; his reference is the
// Claude desktop app's browser pane). The SPLIT pane now wears a browser's chrome, left-to-right in
// both languages like that reference: a tab strip ([site logo] [title] [✕], the active tab a filled
// chip, the pane's own ✕ in the corner) over a toolbar (← → ⟳, an address
// bar with the host dark and the path muted, open-in-a-new-window). The pane's ✕, Escape and the
// browser's Back HIDE the pane — tabs and their frames stay mounted, the results show a
// A card click (or the browser's Forward) brings it back. A tab's ✕ closes that tab; the last one closes the pane.
// The address bar shows the URL WE loaded: a cross-origin frame never tells us where the user went
// inside it, so it does not pretend to follow. The phone sheet is unchanged.
//
// Motion: critically-damped springs on transform/opacity only; enter and exit share one path
// (pane: from/to the right edge; sheet: from/to the bottom). Reduced motion → short cross-fade.

const IS_WEB = Platform.OS === 'web';
// A page still loading after this long gets a small, dismissible «open in a new window» pill. The page
// itself stays: it keeps loading underneath and the user can keep waiting if they prefer.
const SLOW_HINT_MS = 5_000;
// Marker on the history entry this viewer pushes; see the history effect below.
const HISTORY_MARK = 'ezAdViewer';
// Apple's "sheet" response (~0.3s), damping ratio ≈ 1 → settles with no overshoot.
const SPRING = { stiffness: 320, damping: 36, mass: 1, useNativeDriver: false } as const;

// Pin a row to physical LTR (web DOM dir — the same approach as the agent top bar's setLtr).
const setLtr = (node: any) => { if (IS_WEB && node?.setAttribute) node.setAttribute('dir', 'ltr'); };
// Hover tooltip for icon-only controls: RNW forwards no `title`, so set it on the host node.
const tip = (label: string) => (node: any) => { node?.setAttribute?.('title', label); };

export default function AdViewer({ tabs, active, split, hidden, hint, onSelect, onCloseTab, onCloseAll, onHide, onShow }: {
  tabs: AdTab<Listing>[];
  active: number;
  split: boolean;
  /** Hidden ≠ closed: the pane is out of sight, every tab and its frame stays mounted. */
  hidden: boolean;
  /** Transient note shown over the page (e.g. the oldest tab was evicted at the cap). */
  hint?: string;
  onSelect: (i: number) => void;
  onCloseTab: (i: number) => void;
  onCloseAll: () => void;
  onHide: () => void;
  onShow: () => void;
}) {
  const { t, isRTL } = useI18n();
  const reduced = useReducedMotion();
  const { height: winH } = useWindowDimensions();
  // The sheet stops short of the top so Ezhalah stays visible behind it (owner: not fully zoomed in).
  const sheetH = Math.round(winH * 0.88);
  const sheetHRef = useRef(sheetH); sheetHRef.current = sheetH;
  const current = tabs[Math.min(active, tabs.length - 1)];
  const curKey = current ? adTabKey(current) : '';
  const activeUrl = current?.url ?? '';

  // 0 = off its edge, 1 = in place. dragY adds the sheet's live finger offset on top.
  const progress = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const closingRef = useRef(false);
  const onCloseRef = useRef(onCloseAll);
  onCloseRef.current = onCloseAll;
  const onHideRef = useRef(onHide); onHideRef.current = onHide;
  const onShowRef = useRef(onShow); onShowRef.current = onShow;
  const splitRef = useRef(split); splitRef.current = split;
  const hiddenRef = useRef(hidden); hiddenRef.current = hidden;
  const motionTo = (toValue: 0 | 1) => reduced
    ? Animated.timing(progress, { toValue, duration: 160, useNativeDriver: false })
    : Animated.spring(progress, { toValue, ...SPRING });
  // BACK HIDES THE VIEWER, NOT THE CHAT (web). One extra history entry on the same URL, carrying the
  // router's current state plus our marker: Back lands on the router's own identical record (a no-op
  // for it), and a later Forward onto our entry still names a route the router recognises.
  const pushMark = () => {
    if (!IS_WEB) return;
    try {
      const st = window.history.state;
      if (!st?.[HISTORY_MARK]) window.history.pushState({ ...(st ?? {}), [HISTORY_MARK]: true }, '');
    } catch { /* history unavailable: the pane still works */ }
  };
  // Arrive on mount AND every time a hidden pane is shown again — one spring, one path, both ways.
  useEffect(() => {
    if (hidden) return;
    closingRef.current = false;
    dragY.setValue(0);
    pushMark();
    motionTo(1).start();
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  // The exit motion is decoration; leaving is the function. runAfterAnimation() hands off when the
  // spring settles — or from its own timer if rAF is stalled — never later, never twice.
  const leave = (then: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    runAfterAnimation((done) => motionTo(0).start(done), then, 450);
  };
  const dismiss = () => leave(() => onCloseRef.current());
  const hide = () => leave(() => onHideRef.current());
  // ✕ / Escape / last tab closed: close (or hide) directly and retire our history marker in place.
  // NEVER history.back() to close or hide: once the user acts inside an ad (Gathern «اختر» → /reserve), the frame's
  // navigation sits on top of our entry in the joint session history, so back() steps the AD back
  // instead of closing (measured live 2026-10-03: ✕ undid the booking step and the pane stayed open).
  const dropMark = () => {
    if (!IS_WEB) return;
    try {
      const st = window.history.state;
      if (st?.[HISTORY_MARK]) { const { [HISTORY_MARK]: _drop, ...rest } = st; window.history.replaceState(rest, ''); }
    } catch { /* history unavailable: closing still works */ }
  };
  const requestClose = () => { dropMark(); dismiss(); };
  const requestCloseRef = useRef(requestClose); requestCloseRef.current = requestClose;
  // The pane's own ✕ and Escape (split): out of sight, nothing deleted.
  const requestHide = () => { dropMark(); hide(); };
  const requestHideRef = useRef(requestHide); requestHideRef.current = requestHide;
  // Drag-to-close commits along the gesture's own path: finish the slide at the finger's velocity
  // (§5 velocity handoff), popping our history entry silently (closingRef gates the popstate dismiss).
  const dragClose = (velocity: number) => {
    if (closingRef.current) return;
    closingRef.current = true;
    dropMark();
    runAfterAnimation(
      (done) => Animated.spring(dragY, { toValue: sheetHRef.current, velocity, ...SPRING }).start(done),
      () => onCloseRef.current(), 400,
    );
  };
  const dragCloseRef = useRef(dragClose); dragCloseRef.current = dragClose;

  // The browser's own Back left our marked entry: the split pane hides (tabs kept), the phone sheet
  // closes as before. Forward back onto the marked entry shows a hidden pane again. Either way the
  // joint history moved under us, so the ← / → mirror starts over rather than guess.
  useEffect(() => {
    if (!IS_WEB) return;
    const onPop = () => {
      pendingRef.current = null;
      setNavBoth(EMPTY_FRAME_NAV);
      if (window.history.state?.[HISTORY_MARK]) { onShowRef.current(); return; }
      if (splitRef.current) hide(); else dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || hiddenRef.current) return;
      if (splitRef.current) requestHideRef.current(); else requestCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ← / → / ⟳ (split toolbar). The model and its limits live in lib/inAppViewer.ts (FrameNav).
  const [nav, setNav] = useState<FrameNav>(EMPTY_FRAME_NAV);
  const navRef = useRef(nav);
  const setNavBoth = (n: FrameNav) => { navRef.current = n; setNav(n); };
  // The tab whose NEXT frame load is our own ← / → landing, not a new navigation by the user.
  const pendingRef = useRef<string | null>(null);
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const onFrameNavigated = (key: string) => {
    if (pendingRef.current === key) { pendingRef.current = null; return; }
    setNavBoth(frameNavigated(navRef.current, key));
  };
  // The ONE place this file may call history.back(): stepping the ad's own frame, and only when the
  // mirror says that frame owns the top joint-history entry (otherwise back() would pop our marker).
  const step = (dir: -1 | 1) => {
    if (!IS_WEB || !(dir < 0 ? canFrameBack : canFrameForward)(navRef.current, curKey)) return;
    pendingRef.current = curKey;
    setNavBoth(frameStepped(navRef.current, dir));
    if (dir < 0) window.history.back(); else window.history.forward();
  };
  // ⟳ remounts the tab's frame at the URL we loaded; the old frame's history entries go with it.
  const reload = () => {
    if (!activeUrl) return;
    pendingRef.current = null;
    setNavBoth(frameDropped(navRef.current, curKey));
    setReloads((r) => ({ ...r, [curKey]: (r[curKey] ?? 0) + 1 }));
  };
  // A closed tab's frame is gone, and the browser drops its history entries with it.
  useEffect(() => {
    const open = new Set(tabs.map(adTabKey));
    const gone = [...new Set(navRef.current.stack.filter((k) => !open.has(k)))];
    if (gone.length) setNavBoth(gone.reduce(frameDropped, navRef.current));
  }, [tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Address bar: click selects the URL and copies it; the lock turns into a tick for a moment.
  const [copied, setCopied] = useState(false);
  const urlRef = useRef<any>(null);
  const copyUrl = () => {
    if (!IS_WEB || !activeUrl) return;
    try { window.getSelection()?.selectAllChildren(urlRef.current); } catch { /* selection is a nicety */ }
    navigator.clipboard?.writeText(activeUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => { /* clipboard denied: the text is still selected */ });
  };
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

  const closeTab = (i: number) => { if (tabs.length === 1) requestClose(); else onCloseTab(i); };

  // PHONE SHEET chrome — as shipped (owner: «the phone is perfect»).
  const sheetChrome = (
    <View style={s.chrome}>
      <View style={s.grabberRow} ref={grabRef}>
        <View style={s.grabber} />
      </View>
      <View style={s.tabRow}>
        <ScrollView horizontal style={{ flex: 1 }} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabStrip}>
          {tabs.map((l, i) => {
            const on = i === active;
            return (
              <Pressable key={adTabKey(l)} testID="ad-tab" onPress={() => onSelect(i)} style={[s.tab, on && s.tabOn]}>
                <TabIcon tab={l} scale={0.44} />
                <Text numberOfLines={1} style={[s.tabTx, on && s.tabTxOn]}>{l.title || t('New tab')}</Text>
                <Pressable
                  testID="ad-tab-close"
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('Close')}
                  onPress={(e: any) => { e?.stopPropagation?.(); closeTab(i); }}
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
      </View>
    </View>
  );

  // LAPTOP PANE chrome — a browser window in Ezhalah's colours. Pinned left-to-right like the
  // owner's reference (and like the URL it shows), whatever the page language.
  const shown = splitUrlForDisplay(activeUrl);
  const browserChrome = (
    <View style={s.bChrome} ref={setLtr}>
      <View style={s.bTabRow}>
        <ScrollView horizontal style={s.bTabScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={s.bTabStrip}>
          {tabs.map((tab, i) => {
            const on = i === active;
            return (
              <Pressable
                key={adTabKey(tab)}
                testID="ad-tab"
                onPress={() => onSelect(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={({ hovered }: any) => [s.bTab, on ? s.bTabOn : hovered && s.bTabHover]}
              >
                <TabIcon tab={tab} scale={0.36} />
                <Text numberOfLines={1} style={[s.bTabTx, on && s.bTabTxOn]}>{tab.title || t('New tab')}</Text>
                <Pressable
                  testID="ad-tab-close"
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={t('Close')}
                  onPress={(e: any) => { e?.stopPropagation?.(); closeTab(i); }}
                  style={({ hovered }: any) => [s.bTabX, hovered && s.bTabXHover]}
                >
                  <Ionicons name="close" size={12} color={on ? colors.ink : colors.muted} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
        <ToolBtn testID="ad-viewer-hide" icon="close" size={18} label={t('Hide tabs')} onPress={requestHide} />
      </View>
      <View style={s.bToolRow}>
        <ToolBtn testID="ad-nav-back" icon="arrow-back" label={t('Back')} disabled={!!current?.listing || !canFrameBack(nav, curKey)} onPress={() => step(-1)} />
        <ToolBtn testID="ad-nav-forward" icon="arrow-forward" label={t('Forward')} disabled={!!current?.listing || !canFrameForward(nav, curKey)} onPress={() => step(1)} />
        <ToolBtn testID="ad-nav-reload" icon="refresh" label={t('Reload')} disabled={!activeUrl} onPress={reload} />
        <Pressable
          testID="ad-address"
          ref={tip(t('Copy link'))}
          onPress={copyUrl}
          disabled={!activeUrl}
          accessibilityRole="button"
          accessibilityLabel={t('Copy link')}
          style={({ hovered }: any) => [s.bAddress, hovered && !!activeUrl && s.bAddressHover]}
        >
          <Ionicons
            name={copied ? 'checkmark' : activeUrl ? 'lock-closed' : 'search'}
            size={12}
            color={copied ? colors.primary : colors.muted}
          />
          <Text ref={urlRef} numberOfLines={1} style={s.bUrl}>
            {activeUrl ? <><Text style={s.bUrlHost}>{shown.host}</Text>{shown.rest}</> : t('New tab')}
          </Text>
        </Pressable>
        <ToolBtn testID="ad-open-new-window" icon="open-outline" size={16} label={t('Open in a new window')} disabled={!activeUrl} onPress={openNewTab} />
      </View>
    </View>
  );
  const chrome = split ? browserChrome : sheetChrome;

  const body = (
    <View style={s.body}>
      {/* Every open tab stays mounted; only the active one is displayed — switching is instant. */}
      {tabs.map((tab, i) => {
        if (tab.listing) return (
          <View key={`${adTabKey(tab)}#${reloads[adTabKey(tab)] ?? 0}`} style={[s.page, i !== active && s.pageHidden]}>
            <ListingPreview listing={tab.listing} url={tab.url} onClose={() => closeTab(i)} />
          </View>
        );
        const k = adTabKey(tab);
        return <TabFrame key={`${k}#${reloads[k] ?? 0}`} tab={tab} visible={i === active} t={t} onNavigated={() => onFrameNavigated(k)} />;
      })}
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
      <Animated.View testID="ad-viewer" style={[s.split, motion, hidden && s.pageHidden]}>
        {chrome}
        {body}
      </Animated.View>
    );
  }

  const sheetMotion = reduced
    ? { opacity: progress }
    : { transform: [{ translateY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [sheetH, 0] }), dragY) }] };
  return (
    <View testID="ad-viewer" style={[s.overlay, hidden && s.pageHidden]} pointerEvents="box-none">
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

// One tab's page: its own iframe. Mounted for the tab's whole life (hidden when inactive) so
// refronting never reloads the site.
//
// LOADING (owner 2026-10-03: «it takes so long … when I click فتح في نافذة جديدة it works perfectly …
// make sure we never have this issue»). Measured on a phone over 4G: Gathern's content was visible
// after ~0.3s but its frame `load` event (every image, font and tracker) came at ~2.9s, and the old
// opaque «loading» cover waited for `load`; on a slower phone that is many seconds of blank screen,
// and past 12s the old code even REMOVED the page and showed an error. A browser tab does neither,
// which is why «new window» felt fast. So: the frame is visible from its first paint, a thin bar on
// top shows progress until `load`, and a slow page gets a small «open in a new window» pill — the
// page is never taken away.
function TabFrame({ tab, visible, t, onNavigated }: { tab: AdTab; visible: boolean; t: (k: string) => string; onNavigated: () => void }) {
  const url = tab.url;
  const { host } = splitUrlForDisplay(url);
  const [loaded, setLoaded] = useState(false);
  // The frame's first load is the page we asked for; every later one is the user moving inside it.
  // A plain flag on purpose: a `loads.current++ > 0` counter here took the FIRST load for a
  // navigation in the React Compiler build (seen live: ← lit up on a fresh tab and after ⟳).
  const loadedOnce = useRef(false);
  const [slow, setSlow] = useState(false);
  const [slowDismissed, setSlowDismissed] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const id = setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => clearTimeout(id);
  }, [loaded]);
  // The progress bar eases toward 85% while waiting (a real browser's trick: it never claims done early).
  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loaded) return;
    bar.setValue(0.08);
    const a = Animated.timing(bar, { toValue: 0.85, duration: 6_000, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const openNewTab = () => { if (IS_WEB && url) window.open(url, '_blank', 'noopener,noreferrer'); };
  const Frame: any = 'iframe';
  return (
    <View style={[s.page, !visible && s.pageHidden]}>
      {/* Always mounted, visible from its first paint — never covered, never removed for being slow. */}
      {(
        <Frame
          src={url}
          title={host}
          onLoad={() => {
            setLoaded(true);
            if (loadedOnce.current) onNavigated(); else loadedOnce.current = true;
          }}
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
      {!loaded && (
        <Animated.View
          testID="ad-load-bar"
          pointerEvents="none"
          style={[s.loadBar, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
        />
      )}
      {!loaded && slow && !slowDismissed && (
        <View testID="ad-slow-hint" style={s.slowPill}>
          <Text style={s.slowTx}>{t('Taking a while?')}</Text>
          <Pressable onPress={openNewTab} accessibilityRole="link" style={({ hovered }: any) => [s.newTab, hovered && s.hover]}>
            <Ionicons name="open-outline" size={15} color={colors.primary} />
            <Text style={s.newTabTx}>{t('Open in a new window')}</Text>
          </Pressable>
          <Pressable onPress={() => setSlowDismissed(true)} accessibilityRole="button" accessibilityLabel={t('Close')} hitSlop={8} style={s.slowX}>
            <Ionicons name="close" size={14} color={colors.muted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

// A tab's mark: the site's logo.
// SourceBadge is the one logo resolver in the app; a tab slot is smaller than its 96×48 frame, so
// it renders scaled inside a clipped slot rather than forking a second size-threaded copy of it.
function TabIcon({ tab, scale }: { tab: AdTab; scale: number }) {
  const box = { width: Math.round(96 * scale), height: Math.round(48 * scale) };
  return (
    <View style={[s.tabLogo, box]} pointerEvents="none">
      <View style={{ transform: [{ scale }] }}><SourceBadge source={tab.source} /></View>
    </View>
  );
}

// One square toolbar button: icon only, named for assistive tech and on hover.
function ToolBtn({ icon, label, onPress, disabled, testID, size = 17 }: {
  icon: any; label: string; onPress: () => void; disabled?: boolean; testID?: string; size?: number;
}) {
  return (
    <Pressable
      testID={testID}
      ref={tip(label)}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ hovered, pressed }: any) => [s.bBtn, disabled && s.bBtnOff, !disabled && hovered && s.hover, !disabled && pressed && s.bBtnPressed]}
    >
      <Ionicons name={icon} size={size} color={colors.ink} />
    </Pressable>
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
  tabLogo: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
  loadBar: { position: 'absolute', top: 0, left: 0, height: 3, backgroundColor: colors.primary, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  slowPill: {
    position: 'absolute', left: 12, right: 12, bottom: 16, alignSelf: 'center', maxWidth: 420, marginHorizontal: 'auto' as any,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingStart: 14, paddingEnd: 6, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
  },
  slowTx: { flex: 1, fontSize: 13, color: colors.ink },
  slowX: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  hintWrap: {
    position: 'absolute', top: 8, alignSelf: 'center',
    backgroundColor: colors.tint, borderRadius: radius.pill,
    paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: colors.tintLine,
  },
  hintTx: { fontSize: 12, color: colors.chipIcon },

  // Browser chrome (split pane).
  bChrome: { backgroundColor: colors.paper, borderBottomWidth: 1, borderBottomColor: colors.line },
  bTabRow: { flexDirection: 'row', alignItems: 'center', height: 42, paddingHorizontal: 8, gap: 6 },
  bTabScroll: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  bTabStrip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bTab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 30, paddingLeft: 7, paddingRight: 4, borderRadius: 9, maxWidth: 176,
  },
  bTabOn: { backgroundColor: colors.tint, boxShadow: `inset 0 0 0 1px ${colors.tintLine}` },
  bTabHover: { backgroundColor: colors.surface2 },
  bTabTx: { fontSize: 12, color: colors.muted, maxWidth: 96, flexShrink: 1 },
  bTabTxOn: { color: colors.ink, fontWeight: '600' },
  bTabX: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  bTabXHover: { backgroundColor: colors.line },
  bToolRow: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: 8, paddingBottom: 6, gap: 2 },
  bBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bBtnOff: { opacity: 0.3 },
  bBtnPressed: { transform: [{ scale: 0.94 }] },
  bAddress: {
    flex: 1, minWidth: 0, height: 30, marginHorizontal: 4, paddingHorizontal: 12, borderRadius: radius.pill,
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  bAddressHover: { borderColor: colors.tintLine },
  bUrl: { flex: 1, fontSize: 12.5, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },
  bUrlHost: { color: colors.ink, fontWeight: '600' },

});
