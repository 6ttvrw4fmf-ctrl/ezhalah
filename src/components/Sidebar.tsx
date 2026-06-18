import { useEffect, useRef, useState } from 'react';
import { Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import HeroBackground from '@/components/HeroBackground';
import { useApp, type HistoryItem } from '@/store';
import { queryLabel } from '@/data/search';
import { useI18n } from '@/i18n';
import { pickName, initialsOf } from '@/lib/nameSync';
import { noTranslateRef } from '@/noTranslate';

const GOLD = '#e3a008';
const DAY = 86400000;

// Persistent (docked) sidebar on the website: at/above this viewport width on web the drawer is
// always shown as a fixed column instead of a tap-to-open overlay — no hamburger needed.
export const DOCK_WIDTH = 300;
export const DOCK_BREAKPOINT = 900;
export function useDocked() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DOCK_BREAKPOINT;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// A soft background fade on hover/press (web) so the nav links + profile row don't snap harshly.
// The active-chat row is deliberately NOT given this — it keeps its instant, clear green highlight.
const WEB_SMOOTH = Platform.OS === 'web' ? ({ transitionProperty: 'background-color', transitionDuration: '160ms' } as any) : null;
// Drawer slide: a touch slower on the way in so it glides, snappier on the way out.
const SLIDE_IN = { duration: 320, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const SLIDE_OUT = { duration: 230, easing: Easing.in(Easing.cubic) };
const SLIDE_PX = 360; // a bit wider than the panel so it fully clears the edge

// Note #9 — TWO sections only: Starred (always kept) and Recent (last 60 DAYS, newest first).
// Anything older than 60 days drops out of Recent but Starred items stay forever. Both buckets are
// sorted by most-recent activity. (user request: "Recent chats should be ordered by most recent
// activity first … 60-day rule.")
const RECENT_WINDOW_DAYS = 60;
function groupHistory(items: HistoryItem[]): { key: string; items: HistoryItem[] }[] {
  const now = Date.now();
  const starred = items.filter((c) => c.starred).sort((a, b) => b.ts - a.ts);
  const recent = items
    .filter((c) => !c.starred && now - c.ts <= RECENT_WINDOW_DAYS * DAY)
    .sort((a, b) => b.ts - a.ts);
  return [
    { key: 'Starred', items: starred },
    { key: 'Recent', items: recent },
  ].filter((b) => b.items.length > 0);
}

// In-screen drawer overlay. Rendered ON TOP of the current screen (not a separate route) so the
// page content stays visible/dimmed behind it instead of going blank. The host mounts it when
// open and removes it after onClose fires (we animate out first, then call onClose).
export default function Sidebar({ onClose, docked = false }: { onClose: () => void; docked?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL, locale } = useI18n();
  const { user, history, setQuery, gated, toggleStar, deleteHistory, openModal, activeChatId, setActiveChat } = useApp();
  // Row action menu (Star / Delete). Rendered as a panel-level overlay OUTSIDE the scrolling list so
  // it can never be clipped, and opened UP or DOWN from the click position so the full menu is always
  // on-screen near the top, middle, or bottom of the sidebar. (user request.)
  const panelRef = useRef<View>(null);
  // On web, also set the DOM dir attribute to "ltr" on the panel itself — belt-and-braces with the
  // `direction: 'ltr'` style so the sidebar's whole structure (icons, ⋯ menus, profile row, nav
  // list) never mirrors when the global UI flips to Arabic. (user request, repeated.)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const n: any = panelRef.current;
    if (n?.setAttribute) n.setAttribute('dir', 'ltr');
  });
  const [menu, setMenu] = useState<{ id: string; top: number; openUp: boolean; panelH: number } | null>(null);
  const menuItem = menu ? history.find((c) => c.id === menu.id) ?? null : null;

  const openMenu = (id: string, e: any) => {
    if (menu?.id === id) { setMenu(null); return; }
    const pageY: number | undefined = e?.nativeEvent?.pageY;
    const node: any = panelRef.current;
    if (node?.measureInWindow && typeof pageY === 'number') {
      node.measureInWindow((_x: number, py: number, _w: number, ph: number) => {
        // Open upward when the tap is in the lower part of the panel, so the menu grows toward the
        // empty space and stays fully visible regardless of how far down the row is.
        setMenu({ id, top: pageY - py, openUp: pageY - py > ph * 0.6, panelH: ph });
      });
    } else {
      setMenu({ id, top: 0, openUp: false, panelH: 0 }); // fallback: open below
    }
  };

  // Slide the panel in on mount; the host renders us instantly so this reanimated transition is
  // the only motion — smooth on web and native alike.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, SLIDE_IN);
  }, [progress]);

  // The drawer ALWAYS docks to and slides in from the LEFT edge — even in Arabic — so the menu opens
  // on the same side as the hamburger button (English-style position). Only the panel's POSITION is
  // fixed left; the text inside still localizes/RTLs normally. (user request.)
  const offset = -SLIDE_PX;
  // Clean drawer motion like ChatGPT / Claude on mobile: the opaque panel simply slides in from the
  // left edge on a smooth ease-out — no scale, no zoom, no fade — while the backdrop dims in behind it.
  // (user request: make it smooth like ChatGPT/Claude.)
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [offset, 0]) }],
  }));
  // Backdrop eases to a soft dim slightly behind the panel's travel so the page recedes smoothly.
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 1]) }));

  // Animate the drawer back out, then run the follow-up once it has cleared the edge. When docked
  // (persistent web column) there's nothing to animate away — just run the follow-up immediately.
  const animateOut = (after: () => void) => {
    if (docked) { after(); return; }
    progress.value = withTiming(0, SLIDE_OUT, (finished) => {
      if (finished) runOnJS(after)();
    });
  };

  const close = () => animateOut(onClose);

  // Quick tactile feedback on the New Chat button — a short shake + scale "pop" so the user
  // unambiguously feels the click landed before the navigation kicks in. (user request.)
  const ncShake = useSharedValue(0);
  const ncScale = useSharedValue(1);
  const newChatAnim = useAnimatedStyle(() => ({
    transform: [{ translateX: ncShake.value }, { scale: ncScale.value }],
  }));

  // New Chat: docked column may be on any screen, so go home explicitly; the overlay only ever
  // opens over Home, where closing is enough.
  const onNewChat = () => {
    // Tactile feedback: tiny shake + pulse so the user feels the tap. Cheap, runs on the UI thread.
    ncShake.value = withSequence(
      withTiming(-6, { duration: 50 }),
      withTiming(6,  { duration: 60 }),
      withTiming(-4, { duration: 60 }),
      withTiming(0,  { duration: 70 }),
    );
    ncScale.value = withSequence(
      withTiming(0.96, { duration: 80 }),
      withSpring(1, { damping: 8, stiffness: 220 }),
    );
    // No chat is "current" on a fresh start — clear the highlighted row.
    setActiveChat(null);
    // New Chat now takes the user back to the DEFAULT FILTER HOME (the search form), not the AI
    // agent screen. The `fresh` param makes the home reset its state if we're already on it. The
    // browser does a soft refresh-feel via the home page's own entrance animation on mount.
    // (user request: New Chat → default filter page; transition feel like a refresh.)
    const params = { fresh: String(Date.now()) };
    // Hold the navigation by one shake-cycle (~240ms) so the user actually SEES the animation play
    // before the screen swaps. (user request: make it feel like a real click.)
    if (docked) { setTimeout(() => router.replace({ pathname: '/', params }), 240); return; }
    setTimeout(() => animateOut(() => { onClose(); setTimeout(() => router.replace({ pathname: '/', params }), 10); }), 240);
  };

  const go = (path: '/auth' | '/settings' | '/agent' | '/') => {
    animateOut(() => {
      onClose();
      // Home is the current screen — for New Chat just close; otherwise push the target.
      if (path !== '/') setTimeout(() => router.push(path), 10);
    });
  };

  // Support / About Us open as in-app popups (centered dialog) rather than full-screen routes:
  // close the drawer, then raise the modal so it overlays the current page.
  const openInfo = (m: 'support' | 'about') => {
    animateOut(() => {
      if (!docked) onClose();
      setTimeout(() => openModal(m), 10);
    });
  };

  // Reopening a past search just SHOWS that conversation in the Ezhalah chat — no typewriter replay,
  // no thinking/searching beats. It's a history view (replay='0'): the request bubble and results
  // render in their final state straight away. (user request — "view all the chat history, it
  // doesn't re-write".)
  const openHistory = (c: HistoryItem) => {
    if (gated) {
      animateOut(() => { onClose(); router.replace('/auth'); });
      return;
    }
    setQuery(() => c.query);
    setActiveChat(c.id); // highlight this row as the current chat
    // Search-based chats replay their filter; chat-only entries (empty query) just open the agent
    // fresh — chat messages aren't stored, so there's nothing to replay. (user request.)
    const isSearchChat = !!(c.query?.deal || c.query?.location || c.query?.category || c.query?.type || c.query?.detail || c.query?.priceBand || c.query?.priceInput);
    animateOut(() => {
      onClose();
      if (isSearchChat) router.replace({ pathname: '/agent', params: { filter: JSON.stringify(c.query), replay: '0' } });
      else router.replace({ pathname: '/agent', params: { fresh: String(Date.now()) } });
    });
  };

  const groups = groupHistory(history);
  const NavLinks = (
    <View style={s.nav}>
      <Pressable style={({ hovered, pressed }: any) => [s.navLink, WEB_SMOOTH, (hovered || pressed) && s.navLinkHover]} onPress={() => go(user ? '/settings' : '/auth')}>
        <Ionicons name="settings-outline" size={19} color={colors.ink} />
        <Text style={s.navText}>{t('Settings')}</Text>
      </Pressable>
      <Pressable style={({ hovered, pressed }: any) => [s.navLink, WEB_SMOOTH, (hovered || pressed) && s.navLinkHover]} onPress={() => openInfo('support')}>
        <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.ink} />
        <Text style={s.navText}>{t('Support')}</Text>
      </Pressable>
      <Pressable style={({ hovered, pressed }: any) => [s.navLink, WEB_SMOOTH, (hovered || pressed) && s.navLinkHover]} onPress={() => openInfo('about')}>
        <Ionicons name="information-circle-outline" size={19} color={colors.ink} />
        <Text style={s.navText}>{t('About Us')}</Text>
      </Pressable>
    </View>
  );

  const body = (
    <>
        {user ? (
          <>
            {/* Top: logo + New Chat */}
            <View style={s.brandRow}>
              <RNImage source={require('../../assets/images/eagle-mark.png')} style={s.logo} resizeMode="contain" />
              <Text ref={noTranslateRef} style={s.word}>{t('EZHALAH')}</Text>
            </View>
            <Animated.View style={newChatAnim}>
              <Pressable style={s.newChat} onPress={onNewChat}>
                <Ionicons name="add" size={18} color={colors.ink} />
                <Text style={s.newChatText}>{t('New Chat')}</Text>
              </Pressable>
            </Animated.View>

            {/* History */}
            <ScrollView style={s.hist} contentContainerStyle={{ paddingBottom: 8 }} onScrollBeginDrag={() => setMenu(null)}>
              {groups.length === 0 ? (
                <Text style={s.empty}>{t('Your searches will appear here.')}</Text>
              ) : (
                groups.map((g) => (
                  <View key={g.key} style={s.group}>
                    <View style={s.groupHead}>
                      {g.key === 'Starred' && <Ionicons name="star" size={11} color={GOLD} />}
                      <Text style={s.groupTitle}>{t(g.key)}</Text>
                    </View>
                    {/* Note #8 — chat row layout is IDENTICAL in both languages: icon → title → star → ⋯
                        on the right. `direction: ltr` locks the row so Arabic doesn't auto-flip it.
                        Title still flows with its own text direction inside the bubble. (user request.) */}
                    {g.items.map((c) => (
                      <View key={c.id} style={[s.histRow, activeChatId === c.id && s.histRowActive, menu?.id === c.id && s.histRowOpen, { direction: 'ltr' } as any]}>
                        <Pressable style={s.histItem} onPress={() => openHistory(c)}>
                          <Ionicons name="chatbubble-outline" size={15} color="#8a978f" />
                          <Text style={s.histLabel} numberOfLines={1}>{c.label || queryLabel(c.query)}</Text>
                          {c.starred && <Ionicons name="star" size={13} color={GOLD} />}
                        </Pressable>
                        <Pressable style={s.dots} hitSlop={6} onPress={(e) => openMenu(c.id, e)}>
                          <Ionicons name="ellipsis-horizontal" size={16} color="#9aa6a0" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ))
              )}
            </ScrollView>

            <View style={s.divider} />
            {NavLinks}
            {/* Note #7 — profile row layout is IDENTICAL in both languages: avatar → name + email on
                the right. `direction: ltr` locks it so Arabic doesn't auto-flip the avatar to the
                opposite side. The name text itself still flows in its own language. (user request.) */}
            <Pressable style={({ hovered, pressed }: any) => [s.userRow, WEB_SMOOTH, (hovered || pressed) && s.userRowHover, { direction: 'ltr' } as any]} onPress={() => go('/settings')}>
              <View style={s.userAv}><Text style={s.userAvText}>{initialsOf(pickName(user, locale))}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.userName} numberOfLines={1}>{pickName(user, locale)}</Text>
                {!!user.sub && <Text style={s.userSub} numberOfLines={1}>{user.sub}</Text>}
              </View>
            </Pressable>
          </>
        ) : (
          <>
            <View style={s.brandRow}>
              <RNImage source={require('../../assets/images/eagle-mark.png')} style={s.logo} resizeMode="contain" />
              <Text ref={noTranslateRef} style={s.word}>{t('EZHALAH')}</Text>
            </View>

            <Pressable style={[s.cta, { marginTop: 22 }]} onPress={() => go('/auth')}>
              <Ionicons name="person-outline" size={18} color="#fff" />
              <View>
                <Text style={s.ctaTitle}>{t('Sign up / Log in')}</Text>
                <Text style={s.ctaSub}>{t('Get more. Sign up free.')}</Text>
              </View>
            </Pressable>

            <View style={{ flex: 1, minHeight: 30 }} />
            <View style={s.divider} />
            {NavLinks}
            <Pressable style={s.cta} onPress={() => go('/auth')}>
              <Ionicons name="person-outline" size={18} color="#fff" />
              <View>
                <Text style={s.ctaTitle}>{t('Sign up / Log in')}</Text>
                <Text style={s.ctaSub}>{t('Get more. Sign up free.')}</Text>
              </View>
            </Pressable>
          </>
        )}
    </>
  );

  // The Star/Delete menu for the open row — a panel-level overlay (never clipped by the list), opening
  // up or down from the tap so the full text is always visible at the top, middle, or bottom.
  const menuOverlay = menu && menuItem ? (
    <>
      <Pressable style={s.menuScrim} onPress={() => setMenu(null)} />
      <View
        style={[
          s.rowMenu,
          isRTL ? { left: 14 } : { right: 14 },
          menu.openUp ? { bottom: Math.max(8, menu.panelH - menu.top + 4) } : { top: menu.top + 4 },
        ]}
      >
        <Pressable style={({ hovered }: any) => [s.rowMenuItem, WEB_SMOOTH, hovered && s.rowMenuItemHover]} onPress={() => { toggleStar(menu.id); setMenu(null); }}>
          <Ionicons name={menuItem.starred ? 'star' : 'star-outline'} size={15} color={menuItem.starred ? GOLD : colors.ink} />
          <Text style={s.rowMenuText} numberOfLines={1}>{menuItem.starred ? t('Unstar') : t('Star')}</Text>
        </Pressable>
        <Pressable style={({ hovered }: any) => [s.rowMenuItem, WEB_SMOOTH, hovered && s.rowMenuItemHover]} onPress={() => { deleteHistory(menu.id); setMenu(null); }}>
          <Ionicons name="trash-outline" size={15} color="#c0392b" />
          <Text style={[s.rowMenuText, { color: '#c0392b' }]} numberOfLines={1}>{t('Delete')}</Text>
        </Pressable>
      </View>
    </>
  ) : null;

  // Website: render as a fixed, always-visible column (no backdrop, no slide) at the leading edge.
  // Pin the WHOLE sidebar structure to LTR — icons, stars, ⋯ menus, sections, profile row all stay
  // in the same physical positions regardless of language. Arabic text inside still reads right-to-
  // left via its own writingDirection. Only the text content changes per language, never the row
  // structure. (user request: don't mirror the sidebar in Arabic.)
  const LTR_PIN = { direction: 'ltr' as const };

  if (docked) {
    return (
      <View ref={panelRef} style={[s.dockPanel, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 14 }, LTR_PIN]}>
        <HeroBackground imageOpacity={0.5} fadeStart={0.85} fadeEnd={1} />
        {body}
        {menuOverlay}
      </View>
    );
  }

  // Mobile / native: tap-to-open overlay drawer that slides in over the dimmed page.
  return (
    <View style={s.overlay}>
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View ref={panelRef as any} style={[s.panel, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 14 }, panelStyle, LTR_PIN]}>
        <HeroBackground imageOpacity={0.5} fadeStart={0.85} fadeEnd={1} />
        {body}
        {menuOverlay}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  // `row` lets the panel rest against the leading edge (left in EN, right in AR) — auto-mirrored
  // by RTL on both web and native, so the drawer opens from the same side as the menu button.
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, flexDirection: 'row' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.42)' },
  // Base is `paper` (not stark white) so the sketch backdrop reads as part of the same illustration
  // behind the rest of the app — the panel blends into the image instead of sitting on a flat slab.
  // Absolutely pinned to the LEFT edge (not via flex) so the drawer opens on the left in every
  // language — RTL never mirrors it to the right. (user request.)
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '82%', maxWidth: 310, backgroundColor: colors.paper, paddingHorizontal: 14, ...cardShadow },
  // Docked (website) column: fixed width, a faint trailing hairline (RTL-mirrored on web), no
  // shadow/backdrop. Paper base so it blends with the sketch background of the adjoining screen.
  dockPanel: { width: DOCK_WIDTH, height: '100%', backgroundColor: colors.paper, paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: colors.line },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 4 },
  logo: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 15, fontWeight: '800', letterSpacing: 2, color: colors.ink },

  newChat: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginTop: 12 },
  newChatText: { fontSize: 14, fontWeight: '600', color: colors.ink },

  hist: { flex: 1, marginTop: 14, marginBottom: 8 },
  empty: { fontSize: 13, color: colors.muted, paddingVertical: 12, paddingHorizontal: 6 },
  group: { marginBottom: 14 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingBottom: 6 },
  groupTitle: { fontSize: 11, fontWeight: '700', color: '#9aa6a0', textTransform: 'uppercase', letterSpacing: 0.5 },
  histRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10 },
  histRowOpen: { backgroundColor: '#f3f5f3' },
  // The chat the user is currently in — a light green wash so it's obvious which conversation is open.
  histRowActive: { backgroundColor: '#dcefe1' },
  histItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8 },
  histLabel: { flex: 1, fontSize: 13.5, fontWeight: '500', color: colors.ink },
  dots: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  // Soft dim over the sidebar while the menu is open so the history text behind it recedes and the
  // floating card reads cleanly (it no longer blends into the list). Tap it to dismiss.
  // Invisible click-catcher — still closes the menu when the user taps outside it, but no longer
  // dims/blurs the sidebar (the dark tint felt like the whole panel was being highlighted). (user request.)
  menuScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40,
    backgroundColor: 'transparent',
  },
  // A clearly elevated solid-white card — opaque background + strong shadow so nothing shows through.
  rowMenu: {
    position: 'absolute', zIndex: 50, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ebe8',
    borderRadius: 13, padding: 6, minWidth: 168,
    shadowColor: '#0b140f', shadowOpacity: 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 16,
  },
  rowMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 9 },
  rowMenuItemHover: { backgroundColor: '#f3f5f3' },
  rowMenuText: { fontSize: 13.5, fontWeight: '600', color: colors.ink },

  divider: { height: 1, backgroundColor: colors.fieldLine, marginHorizontal: 2, marginBottom: 16 },
  nav: { gap: 4, marginBottom: 18 },
  navLink: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, paddingHorizontal: 6, borderRadius: 11 },
  navLinkHover: { backgroundColor: '#eef1ef' },
  navText: { fontSize: 14.5, fontWeight: '500', color: colors.ink },

  lang: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.segTrack, borderRadius: radius.pill, padding: 4, gap: 4, marginBottom: 18 },
  langBtn: { paddingVertical: 8, paddingHorizontal: 22, borderRadius: radius.pill },
  langBtnOn: { backgroundColor: colors.primary },
  langText: { fontSize: 13.5, fontWeight: '600', color: colors.muted },
  langTextOn: { color: '#fff' },

  // Vertically center the name/email block against the avatar; tighter gap = closer to the avatar.
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingTop: 12, paddingBottom: 8, paddingHorizontal: 8, borderRadius: 11, borderTopWidth: 1, borderTopColor: '#eef1ef' },
  userRowHover: { backgroundColor: '#eef1ef' },
  userAv: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  userAvText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  // Name + email both ALIGN LEFT (same left edge) and use writingDirection 'auto' so the Arabic name
  // still reads right-to-left INTERNALLY but its block starts flush against the avatar. Keeps the
  // pair visually tied as one column. (user request — Arabic profile alignment fix.)
  userName: { fontSize: 13.5, fontWeight: '700', color: colors.ink, textAlign: 'left', writingDirection: 'auto' as any },
  userSub: { fontSize: 11.5, color: colors.muted, textAlign: 'left', marginTop: 2 },

  cta: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 13 },
  ctaTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  ctaSub: { fontSize: 10.5, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
});
