import { useEffect, useRef, useState } from 'react';
import { Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { OPEN_DELAY_MS, armOpen, cancelOpen, openShouldFire, type ArmedOpen } from '@/lib/rowClick';
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
import { colors, darkColors, radius, space, cardShadow } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import HeroBackground from '@/components/HeroBackground';
import AccountMenu from '@/components/AccountMenu';
import { useApp, type HistoryItem } from '@/store';
import { sanitizeArabicSearch, isSearchableQuery, filterChats, arabicHintAfterInput } from '@/lib/chatSearch';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { queryLabel } from '@/data/search';
import { HOLD_MS, canReorder, dragTargetIndex, dragCrossIntent, neighboursAt, preActivate, sortByOrder, type CrossIntent } from '@/lib/sidebarReorder';
import { displayTitle } from '@/lib/chatTitle';
import { sanitizeForFilterRestore } from '@/lib/searchDefaults';
import { useI18n } from '@/i18n';
import { pickName, initialsOf } from '@/lib/nameSync';
import { noTranslateRef } from '@/noTranslate';
import { DOCK_WIDTH, DOCK_BREAKPOINT } from '@/lib/responsive';
import { useAtLeast } from '@/lib/useAtLeast';

const GOLD = '#e3a008';
const DAY = 86400000;

// Persistent (docked) sidebar on the website: at/above this viewport width on web the drawer is
// always shown as a fixed column instead of a tap-to-open overlay — no hamburger needed.
//
// The breakpoint and the SSR-safety rule now live in lib/responsive.ts. This used to read the width
// directly and compare it inline, which meant the server (no window ⇒ width 0 ⇒ undocked) and a
// desktop client (docked) rendered DIFFERENT TREES on the first render — React #418, live on
// production 2026-08-21. Re-exported here so existing importers keep working.
export { DOCK_WIDTH, DOCK_BREAKPOINT };
export function useDocked() {
  return useAtLeast(DOCK_BREAKPOINT);
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// A soft background fade on hover/press (web) so the nav links + profile row don't snap harshly.
// The active-chat row is deliberately NOT given this — it keeps its instant, clear green highlight.
const WEB_SMOOTH = Platform.OS === 'web' ? ({ transitionProperty: 'background-color', transitionDuration: '160ms' } as any) : null;
// Drawer slide: a touch slower on the way in so it glides, snappier on the way out.
const SLIDE_IN = { duration: 320, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const SLIDE_OUT = { duration: 230, easing: Easing.in(Easing.cubic) };
const SLIDE_PX = 360; // a bit wider than the panel so it fully clears the edge

// ── PRESS-HOLD-DRAG REORDER (owner 2026-08-24) ───────────────────────────────────────────────────
// Motion language: a quick 120ms lift when the hold lands (scale 1.02 + soft shadow — felt, not
// flashy), the dragged row then follows the pointer with NO transition (attached to the finger),
// siblings glide aside on a 170ms standard-decelerate curve, and the drop settles in 190ms. No
// spring, no bounce. Honors prefers-reduced-motion (drag stays functional; the glides go instant).
const EASE_CALM = 'cubic-bezier(0.2, 0, 0, 1)';
const REDUCED_MOTION = Platform.OS === 'web'
  && typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const GLIDE = REDUCED_MOTION ? 'none' : `transform 170ms ${EASE_CALM}`;
const SETTLE_MS = 190;
const AUTOSCROLL_EDGE_PX = 48;   // start auto-scrolling when the pointer is this close to an edge
const AUTOSCROLL_STEP_PX = 6;    // per 16ms tick — controlled, never a fling
const ROW_H_FALLBACK = 37;

// Note #9 — TWO sections only: Starred (always kept) and Recent (last 60 DAYS, newest first).
// Anything older than 60 days drops out of Recent but Starred items stay forever. Both buckets are
// sorted by most-recent activity. (user request: "Recent chats should be ordered by most recent
// activity first … 60-day rule.")
const RECENT_WINDOW_DAYS = 60;
function groupHistory(items: HistoryItem[]): { key: string; items: HistoryItem[] }[] {
  const now = Date.now();
  // sortByOrder ranks by `order ?? ts` — identical to the old ts sort until a chat is manually
  // dragged (press-hold reorder, owner 2026-08-24), after which the dragged slot wins until that
  // chat's next activity re-tops it (Note #9's most-recent-activity contract, unchanged).
  const starred = sortByOrder(items.filter((c) => c.starred));
  const recent = sortByOrder(items
    .filter((c) => !c.starred && now - c.ts <= RECENT_WINDOW_DAYS * DAY));
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
  const { user, history, setQuery, toggleStar, deleteHistory, renameHistory, openModal, openAuth, activeChatId, setActiveChat, newChat } = useApp();
  // APPEARANCE (owner 2026-08-28): the sidebar is a THEMED surface — it re-skins in dark mode via
  // the dark override sheet (dks) below. TC carries the resolved palette for inline icon colors.
  const { resolved, colors: TC } = useTheme();
  const dark = resolved === 'dark';
  // Sidebar-anchored account menu — replaces the centered /settings modal (owner 2026-08-28).
  const [acctOpen, setAcctOpen] = useState(false);
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

  // INLINE RENAME (owner 2026-08-21): double-click the title → it becomes an input; Enter saves,
  // blur saves, Escape cancels and restores. `editingId` is which row is in edit mode; `draft` is
  // the working text. `cancelledRef` is what makes Escape survive the blur that follows it —
  // dismissing the input fires onBlur, and without this flag that blur would immediately re-save
  // the very text Escape was meant to discard.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelledRef = useRef(false);

  // CHAT SEARCH (owner 2026-08-24): ChatGPT-style in-sidebar search. The 🔍 control under New Chat
  // morphs into an Arabic-only input — never a route change, never a modal. Latin characters are
  // stripped calmly at the boundary (src/lib/chatSearch.ts) and one quiet hint appears instead of
  // an error; the hint clears when the field empties or search closes, never per keystroke.
  // Search is READ-ONLY discovery: it filters the same history rows and opening a result rides the
  // exact same armOpenRow/openHistory path as a normal row — so it can never create, rename,
  // duplicate or lose a conversation.
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [hadLatin, setHadLatin] = useState(false);
  // ROW INTERACTION COLOR (owner 2026-08-24): normal rows are light/neutral; the DARK green is the
  // interaction color. One id covers both surfaces — mouseenter/leave on web, pressIn/Out on touch
  // — so the pressed state can never stick (out always clears) and the hover style always reverts.
  // The SELECTED chat keeps its persistent light-green highlight and deliberately does NOT take the
  // hover fill: current ≠ hovered must stay visually distinct.
  const [hotRowId, setHotRowId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const searchEnter = useSharedValue(1);
  const searchEnterA = useAnimatedStyle(() => ({
    opacity: searchEnter.value,
    transform: [{ translateY: (1 - searchEnter.value) * -4 }],
  }));
  const openSearch = () => {
    setMenu(null);
    setSearching(true);
    searchEnter.value = reducedMotion ? 1 : 0;
    searchEnter.value = withTiming(1, { duration: 180, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  };
  const closeSearch = () => { setSearching(false); setSearchText(''); setHadLatin(false); };
  const onSearchChange = (raw: string) => {
    const sanitized = sanitizeArabicSearch(raw);
    setSearchText(sanitized.text);
    // The hint's lifecycle is one rule, executed in chatSearch.ts (arabicHintAfterInput) rather
    // than spelled out here, so the barrier runs the real decision instead of grepping for its
    // shape. It clears as soon as a real Arabic query is filtering — the old "clear only when the
    // field is empty" latch left the nudge on screen for the whole session, because stripping
    // Latin already empties the field and the user's Arabic never passes through empty.
    setHadLatin((shown) => arabicHintAfterInput(shown, sanitized));
  };

  // OWNER BUG FIX: a single click OPENS, but the native dblclick below ALSO ran openHistory() on each
  // click of the double-click → it navigated (to Filter/Agent) instead of only renaming. Fix: a click
  // only ARMS a delayed open; beginRename (reached via the dblclick handler or long-press) CANCELS
  // that armed open before it can fire, so a double-click renames ONLY. A cancelled open never calls
  // openHistory → never navigates / switches view / resets the active chat/search. Two SLOW clicks
  // (no dblclick) each still open. Barrier: src/lib/rowClick.ts + scripts/verify-sidebar-rename-isolation.ts.
  const openArmRef = useRef<ArmedOpen | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (openTimerRef.current) clearTimeout(openTimerRef.current); }, []);
  const cancelArmedOpen = () => {
    openArmRef.current = cancelOpen(openArmRef.current);
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
  };
  const armOpenRow = (c: HistoryItem) => {
    if (editingId) return;                                   // never open/navigate while a title is being edited
    // A drag's release fires this too (the row follows the pointer, so the pointer is still inside
    // at pointerup). `.active` only — a plain click also passes through beginHold's pre-active state.
    if (dragRef.current?.active) return;
    if (Platform.OS !== 'web') { openHistory(c); return; }   // native: no dblclick; a tap opens immediately
    const token = Date.now();
    openArmRef.current = armOpen(token);
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      if (openShouldFire(openArmRef.current, token)) { openArmRef.current = null; openHistory(c); }
    }, OPEN_DELAY_MS);
  };

  const beginRename = (c: HistoryItem) => {
    cancelArmedOpen();   // a double-click / long-press must cancel the armed single-click open so it never navigates
    cancelledRef.current = false;
    setDraft(displayTitle(c, locale));
    setEditingId(c.id);
  };
  const commitRename = (id: string) => {
    if (cancelledRef.current) { cancelledRef.current = false; setEditingId(null); return; }
    setEditingId(null);
    renameHistory(id, draft);
  };
  const cancelRename = () => {
    cancelledRef.current = true;   // consumed by the blur that Escape itself triggers
    setEditingId(null);
    setDraft('');
  };
  // react-native-web does NOT forward `onDoubleClick` to the DOM node (its forwardedProps allow-list
  // carries onClick/onContextMenu/pointer events and nothing else), so a prop-based double-click is
  // silently dropped — it was, and the browser run caught it. Bind the real `dblclick` event on the
  // host element instead: the browser owns the double-click threshold, so two deliberate slow clicks
  // stay two opens.
  // (The double-click rename binding now lives in bindRowHost below, alongside the hold-to-drag
  // pointer binding, so the two gestures are coordinated on one host node and can never race.)

  // ═══ PRESS-HOLD-DRAG REORDER ═══════════════════════════════════════════════════════════════════
  // Web pointer events only: the shipped product is the web app (desktop + mobile browsers), and
  // pointer events unify mouse and touch there. Native gets rename via the ⋯ menu and keeps taps;
  // its drag can adopt this same pure logic (sidebarReorder.ts) when the native app ships.
  //
  // Gesture contract (owner): a quick tap OPENS (armOpenRow, unchanged) · double-click RENAMES
  // (unchanged) · a 380ms motionless hold LIFTS the row for vertical reorder. Movement past
  // HOLD_SLOP before the hold lands means scroll/click — the timer cancels and nothing lifts.
  const { reorderHistory, starHistory } = useApp();
  const [drag, setDrag] = useState<{ id: string; bucket: string; from: number; to: number; cross: CrossIntent } | null>(null);
  const dragRef = useRef<{
    id: string; bucket: string; from: number; to: number; count: number; cross: CrossIntent;
    node: any; startY: number; lastY: number; scrollStart: number; rowH: number;
    active: boolean; timer: ReturnType<typeof setTimeout> | null;
    ids: string[]; // the bucket's visible order at grab time, WITHOUT the dragged id
    scrollTick: ReturnType<typeof setInterval> | null; scrollDir: 0 | 1 | -1;
    cleanup: () => void;
  } | null>(null);
  const histScrollRef = useRef<ScrollView>(null);
  const histScrollY = useRef(0);
  const rowHRef = useRef(ROW_H_FALLBACK);
  // Chat-search landed the same day (owner 2026-08-24): reorder is disabled the moment search MODE
  // opens — strictly, not merely when a filter query is active — because a drop inside a filtered
  // list doesn't mean what the user sees. Search finds chats; the normal sidebar orders them.
  const reorderEnabled = canReorder({ editing: !!editingId, searchActive: searching });
  // Screen-reader confirmation after a drop — a polite live region, cleared shortly after.
  const [dropAnnounce, setDropAnnounce] = useState('');

  const applyDragTransform = () => {
    const d = dragRef.current;
    if (!d?.active || !d.node?.style) return;
    const raw = d.lastY - d.startY + (histScrollY.current - d.scrollStart);
    // Bounds (owner 2026-08-25, drag-to-Favorites): the row may now overshoot its bucket edge
    // TOWARD the other bucket — up-and-out of Recent stars, down-and-out of Starred unstars
    // (dragCrossIntent owns that threshold). The opposite directions stay hard-clamped: there is
    // nothing above المفضلة or below Recent to drop into. Vertical only — X is never touched.
    const crossRoom = 1.4 * d.rowH; // enough travel to read as "into the other section", not a slot
    const min = (0 - d.from) * d.rowH - (d.bucket === 'Recent' ? crossRoom : 6);
    const max = (d.count - 1 - d.from) * d.rowH + (d.bucket === 'Starred' ? crossRoom : 6);
    const dy = Math.max(min, Math.min(max, raw));
    d.node.style.transform = `translateY(${dy}px) scale(1.02)`;
    const cross = d.bucket === 'Starred' || d.bucket === 'Recent'
      ? dragCrossIntent(d.bucket, d.from, dy, d.rowH, d.count)
      : null;
    const to = cross ? d.to : dragTargetIndex(d.from, dy, d.rowH, d.count);
    if (to !== d.to || cross !== d.cross) {
      d.to = to; d.cross = cross;
      setDrag((cur) => (cur && cur.id === d.id ? { ...cur, to, cross } : cur));
    }
  };

  const stopAutoScroll = () => {
    const d = dragRef.current;
    if (d?.scrollTick) { clearInterval(d.scrollTick); d.scrollTick = null; d.scrollDir = 0; }
  };
  const maybeAutoScroll = () => {
    const d = dragRef.current;
    if (!d?.active) return;
    const scroller: any = (histScrollRef.current as any)?.getScrollableNode?.();
    if (!scroller?.getBoundingClientRect) return;
    const r = scroller.getBoundingClientRect();
    const dir: 0 | 1 | -1 = d.lastY < r.top + AUTOSCROLL_EDGE_PX ? -1
      : d.lastY > r.bottom - AUTOSCROLL_EDGE_PX ? 1 : 0;
    if (dir === d.scrollDir) return;
    stopAutoScroll();
    if (dir === 0) return;
    d.scrollDir = dir;
    d.scrollTick = setInterval(() => {
      const dd = dragRef.current;
      if (!dd?.active) { stopAutoScroll(); return; }
      histScrollRef.current?.scrollTo({ y: Math.max(0, histScrollY.current + dir * AUTOSCROLL_STEP_PX), animated: false });
      // onScroll updates histScrollY on the next frame; nudge locally so the row keeps tracking
      // even while the browser coalesces scroll events.
      histScrollY.current = Math.max(0, histScrollY.current + dir * AUTOSCROLL_STEP_PX);
      applyDragTransform();
    }, 16);
  };

  const settleDrag = (commit: boolean) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    stopAutoScroll();
    d.cleanup();
    if (!d.active) { dragRef.current = null; return; }
    const node = d.node;
    const finalDy = commit ? (d.to - d.from) * d.rowH : 0;
    if (node?.style) {
      node.style.transition = REDUCED_MOTION ? 'none' : `transform ${SETTLE_MS}ms ${EASE_CALM}, box-shadow ${SETTLE_MS}ms ${EASE_CALM}`;
      node.style.transform = `translateY(${finalDy}px) scale(1)`;
      node.style.boxShadow = 'none';
    }
    const { id, to, ids, cross } = d;
    // dragRef stays SET (active) through the settle window on purpose: RN-web dispatches the row's
    // onPress asynchronously after pointerup, so nulling here let a finished drag arm an open and
    // NAVIGATE (reproduced: the drag landed on /agent). armOpenRow's `.active` guard needs the ref
    // alive until the commit below; a new drag is blocked for the same ~190ms, which is fine.
    // Hand-off on a TIMER, never an animation callback (repo rule: rAF freezes in hidden tabs).
    setTimeout(() => {
      if (commit && cross) {
        // Crossed into the other section: this drop MEANS star/unstar (owner 2026-08-25), and the
        // row lands at the top of its new bucket — position math against the old bucket's
        // neighbours would be meaningless here.
        starHistory(id, cross === 'star');
        setDropAnnounce(cross === 'star' ? t('Added to favorites') : t('Removed from favorites'));
        setTimeout(() => setDropAnnounce(''), 1600);
      } else if (commit) {
        const { prevId, nextId } = neighboursAt(ids, to);
        reorderHistory(id, prevId, nextId);
        setDropAnnounce(t('Conversation order changed'));
        setTimeout(() => setDropAnnounce(''), 1600);
      }
      if (node?.style) {
        node.style.transition = ''; node.style.transform = ''; node.style.zIndex = '';
        node.style.boxShadow = ''; node.style.position = '';
        node.style.cursor = '';
      }
      setDrag(null);
      dragRef.current = null;
    }, REDUCED_MOTION ? 0 : SETTLE_MS + 10);
  };

  const beginHold = (c: HistoryItem, bucket: string, index: number, count: number, ids: string[], node: any, e: PointerEvent) => {
    if (!reorderEnabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (dragRef.current) return;
    const prevent = (ev: Event) => ev.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.lastY = ev.clientY;
      if (!d.active) {
        // Movement before the hold lands: preActivate() decides per pointer type — a mouse pulled
        // vertically IS the drag (activate now, no motionless hold), a mouse pulled sideways or a
        // touch moved past wobble is a scroll/click and cancels. ('wait' = still inside slop.)
        const verdict = preActivate(e.pointerType ?? '', Math.abs(ev.clientX - (e.clientX ?? 0)), Math.abs(ev.clientY - d.startY));
        if (verdict === 'cancel') { settleDrag(false); return; }
        if (verdict === 'wait') return;
        activateDrag();
        if (!dragRef.current?.active) return;
      }
      ev.preventDefault();
      applyDragTransform();
      maybeAutoScroll();
    };
    const onUp = () => settleDrag(dragRef.current?.active === true);
    const onCancel = () => settleDrag(false);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') settleDrag(false); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchmove', prevent);
      try { (document.body as any).style.userSelect = ''; } catch {}
    };
    dragRef.current = {
      id: c.id, bucket, from: index, to: index, count, node, cross: null,
      startY: e.clientY, lastY: e.clientY, scrollStart: histScrollY.current,
      rowH: rowHRef.current, active: false, timer: null, ids,
      scrollTick: null, scrollDir: 0, cleanup,
    };
    const activateDrag = () => {
      const d = dragRef.current;
      if (!d || d.active) return;
      d.active = true;
      // The hold landed: this must never also open or rename.
      cancelArmedOpen();
      setMenu(null);
      // Subtle, free haptic where the platform offers one (Android Chrome).
      try { (navigator as any).vibrate?.(10); } catch {}
      // Stop the page from scrolling under the drag (finger is stationary, so no scroll started).
      window.addEventListener('touchmove', prevent, { passive: false });
      try { (document.body as any).style.userSelect = 'none'; } catch {}
      if (d.node?.style) {
        d.node.style.transition = REDUCED_MOTION ? 'none' : `transform 120ms ${EASE_CALM}, box-shadow 120ms ${EASE_CALM}`;
        d.node.style.zIndex = '30';
        d.node.style.position = 'relative';
        d.node.style.cursor = 'grabbing';
        d.node.style.transform = 'translateY(0px) scale(1.02)';
        d.node.style.boxShadow = '0 6px 18px rgba(11,20,15,0.16)';
        // After the lift lands, drop the transition so the row is glued to the pointer.
        setTimeout(() => { const dd = dragRef.current; if (dd?.active && dd.node?.style) dd.node.style.transition = REDUCED_MOTION ? 'none' : `box-shadow 120ms ${EASE_CALM}`; }, 130);
      }
      setDrag({ id: c.id, bucket, from: index, to: index, cross: null });
    };
    dragRef.current.timer = setTimeout(activateDrag, HOLD_MS);
  };

  // One host binding per row: the double-click rename (existing) plus the hold-to-drag pointerdown.
  const bindRowHost = (c: HistoryItem, bucket: string, index: number, count: number, ids: string[]) => (node: any) => {
    if (Platform.OS !== 'web' || !node || typeof node.addEventListener !== 'function') return;
    if (node.__ezDbl) node.removeEventListener('dblclick', node.__ezDbl);
    const dbl = () => { if (!dragRef.current?.active) beginRename(c); };
    node.__ezDbl = dbl;
    node.addEventListener('dblclick', dbl);
    if (node.__ezHold) node.removeEventListener('pointerdown', node.__ezHold);
    const hold = (e: PointerEvent) => beginHold(c, bucket, index, count, ids, node, e);
    node.__ezHold = hold;
    node.addEventListener('pointerdown', hold);
    // Suppress iOS Safari's long-press text-selection/callout on the rows themselves.
    node.style.webkitUserSelect = 'none';
    node.style.userSelect = 'none';
    (node.style as any).webkitTouchCallout = 'none';
  };

  // How far a sibling row steps aside while the drag hovers over its slot.
  const siblingShift = (bucket: string, index: number): number => {
    if (!drag || drag.bucket !== bucket) return 0;
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -rowHRef.current;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return rowHRef.current;
    return 0;
  };

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
  const ncScale = useSharedValue(1);
  const newChatAnim = useAnimatedStyle(() => ({
    transform: [{ scale: ncScale.value }],
  }));

  // New Chat: docked column may be on any screen, so go home explicitly; the overlay only ever
  // opens over Home, where closing is enough.
  const onNewChat = () => {
    // Tactile feedback: a single soft dip + spring back — a calm "done" acknowledgment. The old
    // side-to-side shake is gone (owner 2026-08-14: "it shakes… I want an animation that makes me
    // feel I've done a new chat"). The fresh-page feeling itself lives in the chat area: the old
    // conversation fades out and the clean chat rises in (agent.tsx fresh effect).
    ncScale.value = withSequence(
      withTiming(0.96, { duration: 80 }),
      withSpring(1, { damping: 8, stiffness: 220 }),
    );
    // A fresh start means FRESH STATE, not just a cleared highlight. This used to be
    // setActiveChat(null) alone, which left the previous search's whole query (city, type, deal,
    // period, price, beds…) sitting in the shared store for the new chat to inherit. The store owns
    // that reset now. Saved chats in the sidebar are untouched. (owner rule 2026-08-20.)
    newChat();
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

  // Settings no longer navigates anywhere: the account controls open as a compact panel anchored
  // to the profile row (AccountMenu), inside the sidebar itself. (owner 2026-08-28 — the centered
  // /settings modal is retired; `go('/settings')` went with it.)
  const openAccountMenu = () => {
    setMenu(null);
    setAcctOpen(true);
  };

  // Support / About Us / Sign-in open as in-app popups (centered dialog) rather than full-screen
  // routes: close the drawer, then raise the overlay so it sits on top of the current page (owner
  // 2026-08-15: sign-in must never navigate away from the Filter — see AuthModal.tsx).
  const openInfo = (m: 'support' | 'about') => {
    animateOut(() => {
      if (!docked) onClose();
      setTimeout(() => openModal(m), 10);
    });
  };
  const openSignIn = () => {
    animateOut(() => {
      if (!docked) onClose();
      setTimeout(() => openAuth(), 10);
    });
  };

  // Reopening a past search just SHOWS that conversation in the Ezhalah chat — no typewriter replay,
  // no thinking/searching beats. It's a history view (replay='0'): the request bubble and results
  // render in their final state straight away. (user request — "view all the chat history, it
  // doesn't re-write".)
  const openHistory = (c: HistoryItem) => {
    closeSearch(); // leaving via a result exits search mode; the docked panel stays mounted
    // Search is FREE, always (owner rule 2026-08-15) — reopening a saved search never routes to
    // sign-in. (History rows only exist for signed-in users anyway; the retired gate was dead code.)
    // STRICT allowlist into the shared store the Filter home binds to — agent-only fields
    // (bothDeals/sources/keywords/sort/count/type/priceInput/…) must never ride into a later
    // filter search. The chat replay below still gets the FULL query via router params.
    // (audit item 2, 2026-07-27.)
    setQuery(() => sanitizeForFilterRestore(c.query));
    setActiveChat(c.id); // highlight this row as the current chat
    // EVERY chat opens through the same replay path now (owner 2026-08-25, full-conversation
    // persistence): the agent restores the entry's stored transcript — search chats AND chat-only
    // entries alike. Fallbacks live in the agent's openSaved(): a search chat with no transcript
    // renders its snapshot/replay view; a transcript-less chat-only entry opens as the greeting
    // screen (its conversation predates transcripts — nothing to replay).
    animateOut(() => {
      onClose();
      router.replace({ pathname: '/agent', params: { filter: JSON.stringify(c.query), replay: '0', hid: c.id } });
    });
  };

  // Search mode filters the SAME rows (read-only, order preserved — history is most-recent-first);
  // otherwise the normal Starred/Recent grouping. 'Results' renders headerless below.
  const searchActive = searching && isSearchableQuery(searchText);
  const searchMatches = searchActive
    ? filterChats(history, (c) => `${displayTitle(c, locale)} ${c.label ?? ''} ${queryLabel(c.query)}`, searchText)
    : null;
  const baseGroups = searchMatches
    ? (searchMatches.length ? [{ key: 'Results', items: searchMatches }] : [])
    : groupHistory(history);
  // DRAG-TO-FAVORITES DROP TARGET (owner 2026-08-25): while a Recent row is being dragged, المفضلة
  // must exist on screen to drop into — so an empty Starred bucket renders its header for the
  // duration of the drag. Outside a drag the empty section stays hidden, exactly as before.
  const groups = drag && drag.bucket === 'Recent' && !searchMatches && !baseGroups.some((g) => g.key === 'Starred')
    ? [{ key: 'Starred', items: [] as HistoryItem[] }, ...baseGroups]
    : baseGroups;
  const NavLinks = (
    <View style={s.nav}>
      <Pressable testID="sidebar-settings-link" style={({ hovered, pressed }: any) => [s.navLink, WEB_SMOOTH, (hovered || pressed) && (dark ? dks.navLinkHover : s.navLinkHover)]} onPress={() => (user ? openAccountMenu() : openSignIn())}>
        <Ionicons name="settings-outline" size={19} color={TC.ink} />
        <Text style={[s.navText, dark && dks.navText]}>{t('Settings')}</Text>
      </Pressable>
      <Pressable style={({ hovered, pressed }: any) => [s.navLink, WEB_SMOOTH, (hovered || pressed) && (dark ? dks.navLinkHover : s.navLinkHover)]} onPress={() => openInfo('support')}>
        <Ionicons name="chatbubble-ellipses-outline" size={19} color={TC.ink} />
        <Text style={[s.navText, dark && dks.navText]}>{t('Support')}</Text>
      </Pressable>
      <Pressable style={({ hovered, pressed }: any) => [s.navLink, WEB_SMOOTH, (hovered || pressed) && (dark ? dks.navLinkHover : s.navLinkHover)]} onPress={() => openInfo('about')}>
        <Ionicons name="information-circle-outline" size={19} color={TC.ink} />
        <Text style={[s.navText, dark && dks.navText]}>{t('About Us')}</Text>
      </Pressable>
    </View>
  );

  const body = (
    <>
        {user ? (
          <>
            {/* Top header: logo + name + the Search entry point (owner 2026-08-24, rev 2):
                the search field is NOT permanently visible — a clean circular 🔍 sits at the
                header level (ChatGPT-style hierarchy, Ezhalah-branded) and only tapping it
                reveals the field below. While search is open the header icon steps aside so
                there is exactly ONE search affordance on screen at a time. */}
            <View style={s.brandRow}>
              <RNImage source={require('../../assets/images/eagle-mark.png')} style={s.logo} resizeMode="contain" />
              <Text ref={noTranslateRef} style={[s.word, dark && dks.word]}>{t('EZHALAH')}</Text>
              {!searching && (
                <Pressable
                  style={({ hovered, pressed }: any) => [s.searchTopBtn, WEB_SMOOTH, (hovered || pressed) && (dark ? dks.searchTopBtnHover : s.searchTopBtnHover)]}
                  onPress={openSearch}
                  hitSlop={4}
                  accessibilityLabel={t('Search chats')}
                  testID="sidebar-search-btn"
                >
                  <Ionicons name="search" size={18} color={dark ? '#a9c9b4' : colors.dark} />
                </Pressable>
              )}
            </View>
            <Animated.View style={newChatAnim}>
              {/* Owner 2026-08-14: the old white-on-white outline button disappeared into the
                  sidebar. Solid brand green + white text so it reads as THE primary action, with a
                  darker hover/press fill (ChatGPT-style affordance). RN-web Pressable exposes
                  `hovered` in the style function; native ignores it and keeps the press state. */}
              {/* Owner 2026-08-24 (supersedes 2026-08-14 solid green): LIGHT green default with
                  dark-green text — the sidebar should feel light; dark green is the INTERACTION
                  color. Hover/keyboard-focus/press turn the fill dark and the text white, on the
                  same restrained 160ms web transition. Children-as-function so the icon + label
                  flip with the fill (a style-only callback can't reach them). */}
              <Pressable
                style={(state) => [
                  s.newChat,
                  dark && dks.newChat,
                  WEB_SMOOTH,
                  // `hovered` is react-native-web only; RN's PressableStateCallbackType omits it.
                  ((((state as { hovered?: boolean }).hovered ?? false) || state.pressed || (state as { focused?: boolean }).focused) ?? false) && s.newChatHover,
                ]}
                onPress={onNewChat}
              >
                {(state) => {
                  const on = (((state as { hovered?: boolean }).hovered ?? false) || state.pressed || ((state as { focused?: boolean }).focused ?? false));
                  return (
                    <>
                      {/* Dark appearance lightens only the RESTING glyph; the light-mode contract
                          (rest = dark green, interaction = white) is untouched and still pinned by
                          verify-sidebar-light-green-interaction.ts. */}
                      <Ionicons name="add" size={18} color={dark && !on ? '#cfe0d5' : on ? colors.surface : colors.dark} />
                      <Text style={[s.newChatText, dark && dks.newChatText, on && s.newChatTextOn]}>{t('New Chat')}</Text>
                    </>
                  );
                }}
              </Pressable>
            </Animated.View>

            {/* Search mode (owner 2026-08-24, rev 2): the field appears ONLY after the top 🔍
                is tapped — the normal sidebar never shows an input. Same Arabic-only engine,
                same results area (the list below filters live). */}
            {searching ? (
              <Animated.View style={[s.searchRow, dark && dks.searchRow, searchEnterA]}>
                <Pressable style={[s.searchClose, dark && dks.searchClose]} hitSlop={8} onPress={closeSearch}
                  accessibilityLabel={t('Close search')} testID="sidebar-search-close">
                  <Ionicons name="close" size={16} color="#9aa6a0" />
                </Pressable>
                <TextInput
                  style={[s.searchInput, dark && dks.searchInput]}
                  value={searchText}
                  onChangeText={onSearchChange}
                  placeholder={t('Search your chats…')}
                  placeholderTextColor="#9aa6a0"
                  autoFocus={Platform.OS === 'web'}
                  returnKeyType="search"
                  maxLength={80}
                  accessibilityLabel={t('Search chats')}
                  testID="sidebar-search-input"
                  onKeyPress={(e: any) => { if (e?.nativeEvent?.key === 'Escape') closeSearch(); }}
                />
                <Ionicons name="search" size={15} color="#9aa6a0" />
              </Animated.View>
            ) : null}
            {searching && hadLatin ? (
              <Text style={[s.searchHint, dark && dks.searchHint]}>{t('Type in Arabic to search your chats')}</Text>
            ) : null}

            {/* History */}
            <ScrollView
              ref={histScrollRef}
              style={s.hist}
              contentContainerStyle={{ paddingBottom: 8 }}
              onScrollBeginDrag={() => setMenu(null)}
              // Drag math needs the live offset: a row's translation is pointer travel PLUS how far
              // the list scrolled under it (auto-scroll near the edges moves the list, not the finger).
              onScroll={(e) => { histScrollY.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
            >
              {groups.length === 0 ? (
                <Text style={[s.empty, dark && dks.empty]}>{searchActive ? t('No chat with that name') : t('Your searches will appear here.')}</Text>
              ) : (
                groups.map((g) => (
                  <View key={g.key} style={s.group}>
                    {g.key !== 'Results' && (
                      <View style={[s.groupHead,
                        // Live affordance while the dragged row is past the edge: the section it
                        // would land in glows softly, so the star/unstar meaning is visible BEFORE
                        // the drop commits.
                        ((drag?.cross === 'star' && g.key === 'Starred') || (drag?.cross === 'unstar' && g.key === 'Recent')) && s.groupHeadTarget]}>
                        {g.key === 'Starred' && <Ionicons name="star" size={11} color={GOLD} />}
                        <Text style={[s.groupTitle, dark && dks.groupTitle]}>{t(g.key)}</Text>
                      </View>
                    )}
                    {/* Note #8 — chat row layout is IDENTICAL in both languages: icon → title → star → ⋯
                        on the right. `direction: ltr` locks the row so Arabic doesn't auto-flip it.
                        Title still flows with its own text direction inside the bubble. (user request.) */}
                    {g.items.map((c, idx) => { const hot = hotRowId === c.id && activeChatId !== c.id && editingId !== c.id; return (
                      <View
                        key={c.id}
                        // The OUTER row hosts both gestures (dblclick rename + hold-to-drag) and is
                        // what lifts/moves, so the ⋯ button travels with its row. First row measures
                        // the shared row height the slot math uses. (Merged 2026-08-24 with the
                        // hot-row hover from main — hover paint and drag wiring share this host.)
                        ref={bindRowHost(c, g.key, idx, g.items.length, g.items.filter((x) => x.id !== c.id).map((x) => x.id)) as any}
                        onLayout={idx === 0 ? (e) => { const h = e.nativeEvent.layout.height; if (h > 20) rowHRef.current = h; } : undefined}
                        style={[s.histRow, WEB_SMOOTH, hot && s.histRowHot, activeChatId === c.id && (dark ? dks.histRowActive : s.histRowActive), menu?.id === c.id && (dark ? dks.histRowOpen : s.histRowOpen), drag?.id === c.id && s.histRowDragging, { direction: 'ltr' } as any,
                          // Siblings glide aside (translateY only — X never moves, RTL layout untouched)
                          // while a drag from this bucket hovers over their slot. The dragged row's own
                          // transform is applied directly to its DOM node so it tracks the pointer with
                          // zero React churn.
                          drag && drag.bucket === g.key && drag.id !== c.id
                            ? ({ transform: [{ translateY: siblingShift(g.key, idx) }],
                                 ...(Platform.OS === 'web' ? { transition: GLIDE } as any : null) })
                            : null,
                        ]}
                        {...(Platform.OS === 'web' ? { onMouseEnter: () => setHotRowId(c.id), onMouseLeave: () => setHotRowId((h) => (h === c.id ? null : h)) } as any : null)}
                      >
                        {editingId === c.id ? (
                          <View style={s.histItem}>
                            <Ionicons name="chatbubble-outline" size={15} color="#8a978f" />
                            <TextInput
                              style={[s.histLabel, dark && dks.histLabel, s.histInput, dark && dks.histInput]}
                              value={draft}
                              onChangeText={setDraft}
                              autoFocus
                              selectTextOnFocus
                              returnKeyType="done"
                              maxLength={120}
                              onSubmitEditing={() => commitRename(c.id)}
                              onBlur={() => commitRename(c.id)}
                              // Escape cancels. RN-web forwards the DOM key event here; native has no
                              // Escape key, where Enter/blur still save.
                              onKeyPress={(e: any) => { if (e?.nativeEvent?.key === 'Escape') cancelRename(); }}
                            />
                          </View>
                        ) : (
                          <Pressable
                            style={s.histItem}
                            onPress={() => armOpenRow(c)}
                            // Touch has no hover: pressIn paints the dark feedback, pressOut ALWAYS
                            // clears it, so the pressed state can never remain stuck after release.
                            onPressIn={() => { if (Platform.OS !== 'web') setHotRowId(c.id); }}
                            onPressOut={() => { if (Platform.OS !== 'web') setHotRowId((h) => (h === c.id ? null : h)); }}
                            // Hold now belongs to REORDER (owner 2026-08-24): the web pointer binding
                            // on the row host runs the 380ms hold → lift → drag. Touch rename moved
                            // to the ⋯ menu; web keeps the double-click. No onLongPress here — a hold
                            // must never rename, and a double-click must never drag.
                            accessibilityHint={t('Hold to reorder the conversation')}
                          >
                            <Ionicons name="chatbubble-outline" size={15} color={hot ? colors.surface : '#8a978f'} />
                            <Text style={[s.histLabel, dark && dks.histLabel, (hot || drag?.id === c.id) && s.histLabelHot]} numberOfLines={1}>{displayTitle(c, locale) || queryLabel(c.query)}</Text>
                            {c.starred && <Ionicons name="star" size={13} color={GOLD} />}
                          </Pressable>
                        )}
                        <Pressable style={s.dots} hitSlop={6} onPress={(e) => openMenu(c.id, e)}>
                          <Ionicons name="ellipsis-horizontal" size={16} color={hot ? '#cfe0d5' : '#9aa6a0'} />
                        </Pressable>
                      </View>
                    ); })}
                  </View>
                ))
              )}
            </ScrollView>

            <View style={[s.divider, dark && dks.divider]} />
            {NavLinks}
            {/* Note #7 — profile row layout is IDENTICAL in both languages: avatar → name + email on
                the right. `direction: ltr` locks it so Arabic doesn't auto-flip the avatar to the
                opposite side. The name text itself still flows in its own language. (user request.) */}
            <Pressable
              testID="account-menu-trigger"
              accessibilityLabel={t('Account menu')}
              style={({ hovered, pressed }: any) => [s.userRow, dark && dks.userRow, WEB_SMOOTH, (hovered || pressed || acctOpen) && (dark ? dks.userRowHover : s.userRowHover), { direction: 'ltr' } as any]}
              onPress={() => (acctOpen ? setAcctOpen(false) : openAccountMenu())}
            >
              <View style={s.userAv}><Text style={s.userAvText}>{initialsOf(pickName(user, locale))}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[s.userName, dark && dks.userName]} numberOfLines={1}>{pickName(user, locale)}</Text>
                {!!user.sub && <Text style={[s.userSub, dark && dks.userSub]} numberOfLines={1}>{user.sub}</Text>}
              </View>
              <Ionicons name="ellipsis-horizontal" size={15} color={dark ? darkColors.muted : '#9aa6a0'} />
            </Pressable>
          </>
        ) : (
          // Guest sidebar — wrapped in a ScrollView so it SCROLLS when the content is taller than a
          // short phone screen (it had a fixed flex layout that clipped on mobile). flexGrow:1 keeps
          // the sign-up CTA pinned to the bottom on tall screens. (user request 2026-06-22.)
          <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
            <View style={s.brandRow}>
              <RNImage source={require('../../assets/images/eagle-mark.png')} style={s.logo} resizeMode="contain" />
              <Text ref={noTranslateRef} style={[s.word, dark && dks.word]}>{t('EZHALAH')}</Text>
            </View>

            <Pressable style={[s.cta, { marginTop: 22 }]} onPress={openSignIn}>
              <Ionicons name="person-outline" size={18} color="#fff" />
              <View>
                <Text style={s.ctaTitle}>{t('Sign up / Log in')}</Text>
                <Text style={s.ctaSub}>{t('Get more. Sign up free.')}</Text>
              </View>
            </Pressable>

            <View style={{ flex: 1, minHeight: 30 }} />
            <View style={[s.divider, dark && dks.divider]} />
            {NavLinks}
            <Pressable style={s.cta} onPress={openSignIn}>
              <Ionicons name="person-outline" size={18} color="#fff" />
              <View>
                <Text style={s.ctaTitle}>{t('Sign up / Log in')}</Text>
                <Text style={s.ctaSub}>{t('Get more. Sign up free.')}</Text>
              </View>
            </Pressable>
          </ScrollView>
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
          dark && dks.rowMenu,
          isRTL ? { left: 14 } : { right: 14 },
          menu.openUp ? { bottom: Math.max(8, menu.panelH - menu.top + 4) } : { top: menu.top + 4 },
        ]}
      >
        <Pressable style={({ hovered }: any) => [s.rowMenuItem, WEB_SMOOTH, hovered && (dark ? dks.rowMenuItemHover : s.rowMenuItemHover)]} onPress={() => { const item = history.find((c) => c.id === menu.id); setMenu(null); if (item) beginRename(item); }}>
          <Ionicons name="pencil-outline" size={15} color={TC.ink} />
          <Text style={[s.rowMenuText, dark && dks.rowMenuText]} numberOfLines={1}>{t('Rename')}</Text>
        </Pressable>
        <Pressable style={({ hovered }: any) => [s.rowMenuItem, WEB_SMOOTH, hovered && (dark ? dks.rowMenuItemHover : s.rowMenuItemHover)]} onPress={() => { toggleStar(menu.id); setMenu(null); }}>
          <Ionicons name={menuItem.starred ? 'star' : 'star-outline'} size={15} color={menuItem.starred ? GOLD : TC.ink} />
          <Text style={[s.rowMenuText, dark && dks.rowMenuText]} numberOfLines={1}>{menuItem.starred ? t('Unstar') : t('Star')}</Text>
        </Pressable>
        <Pressable style={({ hovered }: any) => [s.rowMenuItem, WEB_SMOOTH, hovered && (dark ? dks.rowMenuItemHover : s.rowMenuItemHover)]} onPress={() => { deleteHistory(menu.id); setMenu(null); }}>
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
      // While the account menu is open the column lifts above the content stack, so the menu's
      // full-viewport click-catcher actually sits over the page (every RNW View is z-index:0 —
      // a sibling stacking context later in the DOM otherwise paints over it). Closed → back to
      // z-auto ordering so the root overlays (Support/About/Auth) keep painting above the sidebar.
      <View ref={panelRef} style={[s.dockPanel, dark && dks.dockPanel, acctOpen && ({ zIndex: 30 } as any), { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 14 }, LTR_PIN]}>
        {/* Dark appearance drops the light pencil-sketch backdrop: the deep green paper IS the
            dark surface (the sketch and its fade-to-light-paper gradient assume light ground). */}
        {!dark && <HeroBackground imageOpacity={0.5} fadeStart={0.85} fadeEnd={1} />}
        {body}
        {dropAnnounce ? (
          <Text accessibilityLiveRegion="polite" style={s.srOnly}>{dropAnnounce}</Text>
        ) : null}
        {menuOverlay}
        <AccountMenu visible={acctOpen} onClose={() => setAcctOpen(false)} onHelp={() => openInfo('support')} />
      </View>
    );
  }

  // Mobile / native: tap-to-open overlay drawer that slides in over the dimmed page.
  return (
    <View style={s.overlay}>
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View ref={panelRef as any} style={[s.panel, dark && dks.panel, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 14 }, panelStyle, LTR_PIN]}>
        {!dark && <HeroBackground imageOpacity={0.5} fadeStart={0.85} fadeEnd={1} />}
        {body}
        {menuOverlay}
        {dropAnnounce ? (
          <Text accessibilityLiveRegion="polite" style={s.srOnly}>{dropAnnounce}</Text>
        ) : null}
        <AccountMenu visible={acctOpen} onClose={() => setAcctOpen(false)} onHelp={() => openInfo('support')} />
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
  // Header search entry (owner 2026-08-24 rev 2): a quiet ~42px circular target at header level —
  // neutral by default, a soft green wash on hover/press. Never a big outlined button.
  searchTopBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  searchTopBtnHover: { backgroundColor: colors.tint },
  logo: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 15, fontWeight: '800', letterSpacing: 2, color: colors.ink },

  // Owner 2026-08-24: LIGHT green default (dark-green text) → DARK green with white text only on
  // hover/focus/press. The dark green is the interaction color, never the resting color.
  newChat: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.tint, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginTop: 12, borderWidth: 1, borderColor: colors.tintLine },
  newChatHover: { backgroundColor: colors.dark, borderColor: colors.dark },
  newChatText: { fontSize: 14, fontWeight: '600', color: colors.dark },
  newChatTextOn: { color: colors.surface },
  // Chat search (owner 2026-08-24). The button mirrors the nav-link language (quiet, discoverable);
  // the input row keeps the exact same footprint so the sidebar never jumps when it morphs.
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10, marginTop: 8, borderWidth: 1, borderColor: colors.primary, backgroundColor: '#ffffff' },
  searchClose: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f4f2' },
  // Arabic-first: the field itself presents RTL even though the panel is dir=ltr locked.
  searchInput: { flex: 1, minWidth: 0, fontSize: Platform.OS === 'web' ? 16 : 13.5, paddingVertical: 4, color: colors.ink, textAlign: 'right', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as any,
  searchHint: { fontSize: 11.5, color: '#9aa6a0', paddingHorizontal: 8, paddingTop: 5, textAlign: 'right' },

  hist: { flex: 1, marginTop: 14, marginBottom: 8 },
  empty: { fontSize: 13, color: colors.muted, paddingVertical: 12, paddingHorizontal: 6 },
  group: { marginBottom: 14 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, paddingBottom: 6 },
  // Drag-to-Favorites target glow (drop-would-star/unstar here) — calm, matches the gold star.
  groupHeadTarget: { backgroundColor: 'rgba(227, 160, 8, 0.14)', borderRadius: 6 },
  groupTitle: { fontSize: 11, fontWeight: '700', color: '#9aa6a0', textTransform: 'uppercase', letterSpacing: 0.5 },
  histRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 10 },
  // Interaction color for rows (owner 2026-08-24): dark-green fill with white label on hover/press.
  // DISTINCT from histRowActive below — the current chat keeps its persistent light-green highlight
  // and never takes this fill, so hovered vs selected can't be confused.
  histRowHot: { backgroundColor: colors.dark },
  // The row being DRAGGED: same dark-card/white-label pair as hover — deterministic regardless of
  // hover flicker, and opaque so rows it glides over never show through. (A forced-white card here
  // once made the hovered-white title invisible for the whole drag.)
  histRowDragging: { backgroundColor: colors.dark },
  histLabelHot: { color: colors.surface },
  histRowOpen: { backgroundColor: '#f3f5f3' },
  // The chat the user is currently in — a light green wash so it's obvious which conversation is open.
  histRowActive: { backgroundColor: '#dcefe1' },
  histItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 8 },
  histLabel: { flex: 1, fontSize: 13.5, fontWeight: '500', color: colors.ink },
  // Editing keeps the row's metrics as close as it can so the list barely moves on rename.
  // fontSize >= 16 on web keeps mobile Safari from zooming on focus and stranding the user zoomed in
  // (scripts/verify-input-font-no-ios-zoom.ts). This is the one place where the bigger web font costs a
  // little: measured, the row goes 37px -> 40px while renaming (it already grew 35 -> 37 for the border).
  // A 3px wobble on the row you are actively editing beats an unrecoverable page zoom.
  histInput: { fontSize: Platform.OS === 'web' ? 16 : 13.5, paddingVertical: 0, borderRadius: 6, backgroundColor: '#ffffff',
    borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 6, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null) },
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

  // Visually hidden, still announced: the post-drop «تم تغيير ترتيب المحادثة» confirmation.
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 13 },
  ctaTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  ctaSub: { fontSize: 10.5, color: 'rgba(255,255,255,0.75)', marginTop: 1 },
});

// DARK APPEARANCE overrides (owner 2026-08-28) — appended after the base style when the resolved
// theme is dark. Style-only: no layout value ever changes here, so light/dark can never disagree
// about geometry. The interaction colors (hover/drag fills in brand dark-green, gold star, red
// delete) are shared with light mode and deliberately absent.
const dks = StyleSheet.create({
  panel: { backgroundColor: darkColors.paper },
  dockPanel: { backgroundColor: darkColors.paper, borderRightColor: darkColors.line },
  word: { color: darkColors.ink },
  searchTopBtnHover: { backgroundColor: darkColors.tint },
  newChat: { backgroundColor: darkColors.tint, borderColor: darkColors.tintLine },
  newChatText: { color: '#cfe0d5' },
  searchRow: { backgroundColor: darkColors.surface, borderColor: darkColors.primary },
  searchClose: { backgroundColor: '#1d2620' },
  searchInput: { color: darkColors.ink },
  searchHint: { color: darkColors.muted },
  empty: { color: darkColors.muted },
  groupTitle: { color: darkColors.muted },
  histRowActive: { backgroundColor: '#1f3a2c' },
  histRowOpen: { backgroundColor: '#1d2620' },
  histLabel: { color: darkColors.ink },
  histInput: { backgroundColor: darkColors.surface, borderColor: darkColors.primary },
  rowMenu: { backgroundColor: darkColors.surface, borderColor: darkColors.fieldLine },
  rowMenuItemHover: { backgroundColor: '#1d2a22' },
  rowMenuText: { color: darkColors.ink },
  divider: { backgroundColor: darkColors.fieldLine },
  navLinkHover: { backgroundColor: '#1d2620' },
  navText: { color: darkColors.ink },
  userRow: { borderTopColor: '#1d2620' },
  userRowHover: { backgroundColor: '#1d2620' },
  userName: { color: darkColors.ink },
  userSub: { color: darkColors.muted },
});
