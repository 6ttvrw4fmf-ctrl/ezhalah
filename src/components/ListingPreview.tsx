import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, font, lightColors, radius } from '@/theme/tokens';
import { BUZZER_GOLD, TAP44 } from '@/theme/palette';
import { useI18n, LOCATION_UNRESOLVED_AR, TYPE_UNRESOLVED_AR, ATTRIBUTE_UNRESOLVED_AR } from '@/i18n';
import { listingPrice, sourceName } from '@/lib/listingDisplay';
import { arabicOrPlaceholder, arabicOrPlaceholderForFreeText, attrDisplayLabel, hideArabicProseInEnglish, translateTrailingPeriodWord } from '@/lib/arabicText';
import { translitPlace } from '@/lib/translitPlace';
import { DIRECTION_LABEL } from '@/lib/afEvidence';
import { useAtLeast } from '@/lib/useAtLeast';
import { PICKER_SHEET_BREAKPOINT } from '@/lib/responsive';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { SourceBadge, FEATURE_META, arAttrValue } from '@/components/ResultCard';
import { fetchAdPage, fetchAskingPrices, mapEmbedUrl, type AskingPrices, type GeoPoint } from '@/data/adPageData';
import type { Listing } from '@/data/listings';

// THE IN-APP AD PAGE for the sites that cannot be framed (lib/inAppViewer.ts IN_APP_PREVIEW_HOSTS):
// Ezhalah's own copy of the ad, exactly as the site published it, inside the viewer's tab.
//
// ONE SCREEN FIRST (owner 2026-10-10: «it feels like so much scrolling»). At 390×844 the first screen —
// top bar · hero · price + key line · location card · the sticky «open it» bar — fits with no scroll.
// The hero takes a fixed share of the page (≈29% of its height, clamped); the MAP CARD is the flexible
// block: every other first-screen block is measured (onLayout) and the map fills whatever height is
// left, never under MAP_MIN, so there is no empty gap above the button on any height. When something
// is added to the first screen (the hazard note), the map is what gives way — nothing else moves. Explicit
// heights on a definite column, never `flex: 1` inside an indefinite one (iOS Safari resolves that to
// 0px — see scripts/verify-ios-column-flex-collapse.ts). The rows UNDER the map card (details ·
// description · the source line) are a continuation the page may scroll to.
//
// SOURCE IS TRUTH. Nothing here is computed: the price is the shared listingPrice() string; a field the
// source left silent is simply absent (never «0», never «لا»); the map is drawn only from the pin the
// source published (data/adPageData.ts) and is labelled «as published by {site}»; the description is
// the source's own text, its own «•» bullets laid out as a list. No licence row, no ad number, no
// disclaimer paragraph — one quiet «هذا الإعلان من {site}» line closes the page.
const IS_WEB = Platform.OS === 'web';
const HERO_MIN = 170;
const HERO_MAX = 260;
const HERO_SHARE = 0.29;
const MAP_MIN = 150;
// Marker on the history entry the expanded map pushes (same approach as AdViewer's HISTORY_MARK): the
// browser's Back closes the map and lands on the viewer's own marked entry, which it treats as «show».
const SHEET_MARK = 'ezAdMap';
// The asking-price box: a figure's place on the p10→p90 bar (0–100%).
const pct = (v: number, r: { p10: number; p90: number }) => Math.round(Math.max(0, Math.min(100, r.p90 > r.p10 ? ((v - r.p10) / (r.p90 - r.p10)) * 100 : 50)));
// THE TAP MOMENT (owner 2026-10-10): the open happens OPEN_DELAY_MS after the tap — inside the browser's
// user-activation window, so Safari lets the new tab through — while confetti marks the hand-off. Keep
// it under ~1s or the tab is blocked.
const OPEN_DELAY_MS = 950;
// Numerals only — the app's Poppins token; Arabic text keeps the system face (no letter-spacing, ever).
const NUM_FONT = IS_WEB ? `${font.family.semibold}, Poppins, ui-sans-serif, system-ui, sans-serif` : undefined;
const NUM_RUN = /(\d[\d,.]*)/;

/** The price string split into numeric and non-numeric runs: the text is byte-identical, only the font differs. */
export function priceRuns(s: string): { text: string; num: boolean }[] {
  return s.split(NUM_RUN).filter(Boolean).map((text) => ({ text, num: NUM_RUN.test(text) }));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// A chevron drawn as SVG on web (an ‹ › glyph would be mirrored by bidi); the icon font on native.
function Chevron({ dir }: { dir: 'left' | 'right' }) {
  const Svg: any = 'svg', Path: any = 'path';
  return (
    <View style={s.arrowDisc}>
      {IS_WEB
        ? <Svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true"><Path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} fill="none" stroke={lightColors.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /></Svg>
        : <Ionicons name={dir === 'left' ? 'chevron-back' : 'chevron-forward'} size={20} color={lightColors.ink} />}
    </View>
  );
}
// Pin the row to physical LTR (web DOM dir), like AdViewer's browser chrome.
const setLtr = (node: any) => { if (IS_WEB && node?.setAttribute) node.setAttribute('dir', 'ltr'); };

export default function ListingPreview({ listing: l, url, onClose }: {
  listing: Listing; url: string;
  /** The viewer's own close for this tab (the ✕ in the page's top bar). */
  onClose?: () => void;
}) {
  const { t, locale, isRTL } = useI18n();
  const name = t(sourceName(l.source));
  const photos = (l.photos?.length ? l.photos : [l.photo]).filter(Boolean);
  const [main, setMain] = useState(0);
  // window.open(url, '_blank', 'noopener') ALWAYS returns null, so a blocked tab could not be told from an
  // opened one; open plainly, then sever the opener by hand. null here = genuinely blocked.
  const open = (): boolean => {
    if (Platform.OS !== 'web' || !url) return false;
    const w = window.open(url, '_blank');
    if (w) w.opener = null;
    return !!w;
  };
  const wide = useAtLeast(PICKER_SHEET_BREAKPOINT);
  const reduced = useReducedMotion();

  // ── the tap moment: the buzzer pushes, a gold ring bursts, confetti everywhere, then the open fires
  //    at OPEN_DELAY_MS. No card, no text, nothing in the middle — a lot of confetti, then the redirect. ──
  const [pressing, setPressing] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [partyOn, setPartyOn] = useState(false);
  const canvasRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const busy = useRef(false);
  // A tab the browser blocked once: the next tap opens at once, inside the tap itself, with no delay.
  const blockedOnce = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  // Confetti, a lot of it (owner: «a lot, and take a little bit of time»): 340 pieces rain from above the
  // top, two bottom-corner cannons fire 130 each up and inward, 110 burst out of the buzzer. Gold + the
  // brand greens + white + a little red and blue; a quarter are round; ~3.2s, fading through the last 25%.
  // Canvas, no library. It keeps running after the tab opens, so it finishes when the user comes back.
  const party = (ox: number, oy: number) => {
    const cv = canvasRef.current; const cx = cv?.getContext?.('2d');
    if (!cx) { setPartyOn(false); return; }
    const w = box.w, h = box.h, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const palette = [BUZZER_GOLD.mid, BUZZER_GOLD.deep, BUZZER_GOLD.light, lightColors.primary, lightColors.accentLeaf, lightColors.onFill, lightColors.danger, lightColors.rnplInk];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const piece = (x: number, y: number, vx: number, vy: number, g: number) => ({
      x, y, vx, vy, g, w: rnd(5, 12), hh: rnd(8, 17), r: Math.random() * 6, vr: rnd(-0.25, 0.25), round: Math.random() < 0.25, c: palette[(Math.random() * palette.length) | 0],
    });
    const shot = (x: number, y: number, deg: number, spread: number, v0: number, v1: number, g: number) => {
      const a = (deg * Math.PI) / 180 + (Math.random() - 0.5) * spread, v = rnd(v0, v1);
      return piece(x, y, Math.cos(a) * v, Math.sin(a) * v, g);
    };
    const bits = [
      ...Array.from({ length: 340 }, () => piece(Math.random() * w, rnd(-1.1 * h, -20), rnd(-1.1, 1.1), rnd(1.5, 5), 0.07)),
      ...Array.from({ length: 130 }, () => shot(0, h, -60, 0.7, 14, 22, 0.3)),
      ...Array.from({ length: 130 }, () => shot(w, h, -120, 0.7, 14, 22, 0.3)),
      ...Array.from({ length: 110 }, () => shot(ox, oy, -90, 2.4, 8, 18, 0.32)),
    ];
    const t0 = performance.now(); const DUR = 3200;
    const tick = (t: number) => {
      const k = (t - t0) / DUR;
      cx.clearRect(0, 0, w, h);
      if (k >= 1) { setPartyOn(false); return; }
      const alpha = k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25);
      for (const b of bits) {
        b.vy += b.g; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        cx.save(); cx.translate(b.x, b.y); cx.rotate(b.r); cx.fillStyle = b.c; cx.globalAlpha = alpha;
        if (b.round) { cx.beginPath(); cx.arc(0, 0, b.w / 2, 0, Math.PI * 2); cx.fill(); } else cx.fillRect(-b.w / 2, -b.hh / 2, b.w, b.hh);
        cx.restore();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // ONE handler for the bar, its floating twin and the host badge (the barrier checks they share it).
  const goOpen = (e?: any) => {
    if (busy.current) return;
    if (reduced || blockedOnce.current || !IS_WEB) { if (!open()) blockedOnce.current = true; return; }
    busy.current = true;
    setBurst(Date.now());
    later(() => setBurst(0), 600);
    setPartyOn(true);
    let origin: { x: number; y: number } | null = null;
    try {
      const root = rootRef.current?.getBoundingClientRect?.();
      const from = (e?.currentTarget?.querySelector?.('[data-gold]') ?? e?.currentTarget)?.getBoundingClientRect?.();
      if (root && from) origin = { x: from.left + from.width / 2 - root.left, y: from.top + from.height / 2 - root.top };
    } catch { /* no origin: the rain still falls */ }
    later(() => party(origin?.x ?? box.w / 2, origin?.y ?? box.h), 0);
    const fire = () => {
      // Blocked: never navigate Ezhalah's own tab away — the next tap opens at once instead.
      if (!open()) blockedOnce.current = true;
      busy.current = false;
    };
    later(fire, OPEN_DELAY_MS);
  };

  // ── the first-screen budget: root − top bar − hero − head − address row − CTA row → the map ────
  const [box, setBox] = useState({ w: 0, h: 0, bar: 0, thumbs: 0, head: 0, addr: 0, cta: 0 });
  const measure = (k: 'bar' | 'thumbs' | 'head' | 'addr' | 'cta') => (e: any) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setBox((b) => (b[k] === h ? b : { ...b, [k]: h }));
  };
  const onRoot = (e: any) => {
    const { width, height } = e.nativeEvent.layout;
    const w = Math.round(width), h = Math.round(height);
    setBox((b) => (b.w === w && b.h === h ? b : { ...b, w, h }));
  };
  const heroH = box.h ? clamp(Math.round(box.h * HERO_SHARE), HERO_MIN, HERO_MAX) : HERO_MIN;
  // The map card's margin + borders; the CTA row is the first screen's last IN-FLOW row, so the map
  // fills exactly down to it — no blank band on any height.
  const mapH = box.h && box.head && box.addr
    ? Math.max(MAP_MIN, box.h - box.bar - heroH - box.thumbs - box.head - box.addr - box.cta - 12)
    : MAP_MIN;

  // ── the source's pin + the asking prices around this ad (web only; native keeps the card data alone) ──
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [range, setRange] = useState<{ stats: AskingPrices; price: number | null } | null>(null);
  useEffect(() => {
    if (!IS_WEB) return;
    let alive = true;
    void fetchAdPage(l).then(({ geo: pin, row }) => {
      if (!alive) return;
      setGeo(pin);
      void fetchAskingPrices(row).then((stats) => {
        const own = Number(row?.price_total);
        if (alive && stats) setRange({ stats, price: Number.isFinite(own) ? own : null });
      });
    });
    return () => { alive = false; };
  }, [l]);

  // ── the expanded map: a full-pane sheet over this page; ✕ / Escape / Back close it in place ─────
  const [mapOpen, setMapOpen] = useState(false);
  const mapOpenRef = useRef(mapOpen); mapOpenRef.current = mapOpen;
  const openMap = () => {
    setMapOpen(true);
    if (!IS_WEB) return;
    try {
      const st = window.history.state;
      if (!st?.[SHEET_MARK]) window.history.pushState({ ...(st ?? {}), [SHEET_MARK]: true }, '');
    } catch { /* history unavailable: the sheet still opens */ }
  };
  // Retire our entry in place — never history.back() (AdViewer's rule: a frame may own the top entry).
  const closeMap = () => {
    setMapOpen(false);
    if (!IS_WEB) return;
    try {
      const st = window.history.state;
      if (st?.[SHEET_MARK]) { const { [SHEET_MARK]: _drop, ...rest } = st; window.history.replaceState(rest, ''); }
    } catch { /* history unavailable: closing still works */ }
  };
  useEffect(() => {
    if (!IS_WEB) return;
    const onPop = () => { if (mapOpenRef.current && !window.history.state?.[SHEET_MARK]) setMapOpen(false); };
    // Capture phase: this runs before AdViewer's own Escape (which would hide the whole pane).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !mapOpenRef.current) return;
      e.stopImmediatePropagation();
      closeMap();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the CTA: in flow as the first screen's last row; a floating twin fades in only while the in-flow
  //    one is out of view (IntersectionObserver on web; the scroll offset on native) ───────────────
  const [floating, setFloating] = useState(false);
  const ctaPos = useRef({ y: 0, h: 0 });
  const viewH = useRef(0);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const inflowRef = (node: any) => {
    ioRef.current?.disconnect();
    ioRef.current = null;
    if (!IS_WEB || !node || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setFloating(!e.isIntersecting), { threshold: 0.2 });
    io.observe(node);
    ioRef.current = io;
  };
  useEffect(() => () => ioRef.current?.disconnect(), []);
  const onBodyScroll = (e: any) => {
    if (IS_WEB) return;
    const top = e.nativeEvent.contentOffset.y;
    const { y, h } = ctaPos.current;
    const vh = viewH.current || e.nativeEvent.layoutMeasurement.height;
    setFloating(!(y < top + vh && y + h > top));
  };

  // ── the hero: swipe (scroll-snap paging) · tap the counter or the laptop arrows to step ─────────
  const heroRef = useRef<ScrollView>(null);
  const slideW = box.w || 0;
  const goTo = (i: number) => {
    if (photos.length < 2) return;
    const n = ((i % photos.length) + photos.length) % photos.length;
    setMain(n);
    if (!slideW) return;
    // In an RTL scroller the browser counts scrollLeft downward from 0; read the real direction.
    const node: any = (heroRef.current as any)?.getScrollableNode?.();
    const rtl = IS_WEB && node ? getComputedStyle(node).direction === 'rtl' : isRTL;
    heroRef.current?.scrollTo({ x: n * slideW * (rtl ? -1 : 1), animated: true });
  };
  const onHeroScroll = (e: any) => {
    if (!slideW) return;
    const i = Math.round(Math.abs(e.nativeEvent.contentOffset.x) / slideW);
    if (i !== main && i >= 0 && i < photos.length) setMain(i);
  };

  // ── facts, ONLY from what the source published ──────────────────────────────────────────────────
  const facts: [string, string][] = [];
  const stats: string[] = [];
  if (l.beds > 0) stats.push(t('{n} rooms', { n: l.beds }));
  if ((l.bathrooms ?? 0) > 0) stats.push(t('{n} bathrooms', { n: l.bathrooms as number }));
  if (l.area > 0) stats.push(`${l.area} ${t('m²')}`);
  const sourceText = (v: string) => arabicOrPlaceholderForFreeText(translateTrailingPeriodWord(t(v), locale), locale, ATTRIBUTE_UNRESOLVED_AR);
  // Raw platform fields can be numbers despite the Listing string type (like ResultCard's attributes).
  const age = String(l.property_age ?? '').trim();
  if (age) facts.push([t('Age'), age === '0' ? t('New construction') : sourceText(age)]);
  const facing = String(l.direction ?? '').trim();
  if (facing) facts.push([t('Facing'), sourceText(DIRECTION_LABEL[facing] ?? facing)]);
  const period = String(l.rentPeriod ?? '').trim();
  if (period) facts.push([t('Rent period'), sourceText(({ annual: 'Yearly', monthly: 'Monthly' } as Record<string, string>)[period] ?? period)]);
  if ((l.halls ?? 0) > 0) facts.push([t('Halls'), String(l.halls)]);
  if ((l.master_bedrooms ?? 0) > 0) facts.push([t('Master Bedrooms'), String(l.master_bedrooms)]);
  if ((l.reception_rooms_majlis ?? 0) > 0) facts.push([t('Majlis'), String(l.reception_rooms_majlis)]);
  const residence = String(l.residence_type ?? '').trim();
  if (residence) facts.push([t('Residence type'), sourceText(residence)]);
  const project = String(l.project_name ?? '').trim();
  if (project) facts.push([t('Project'), sourceText(project)]);
  if (typeof l.rating === 'number' && Number.isFinite(l.rating)) {
    const n = l.reviews_count;
    facts.push([t('Rating'), `${l.rating}${typeof n === 'number' && n > 0 ? ` (${t('{n} reviews', { n })})` : ''}`]);
  }
  const place = (raw: string) => locale === 'en' && raw ? translitPlace(raw) : raw;
  const city = place(arabicOrPlaceholder(t(l.city), locale, LOCATION_UNRESOLVED_AR));
  const district = place(arabicOrPlaceholder(t(l.district), locale, LOCATION_UNRESOLVED_AR));
  const sep = locale === 'ar' ? '، ' : ', ';
  const location = (district || city || LOCATION_UNRESOLVED_AR) + (l.district ? `${sep}${city || LOCATION_UNRESOLVED_AR}` : '');
  const street = hideArabicProseInEnglish(String(l.street_name ?? '').trim() || null, locale) ?? '';
  const address = [street, location].filter(Boolean).join(sep);
  const typeLabel = arabicOrPlaceholder(/[ء-ي]/.test(l.type || '') ? l.type : t(l.cleanType ?? l.type), locale, TYPE_UNRESOLVED_AR);
  // The source's own additional-information panel, through the card's own value/label display rules.
  const shown = new Set(facts.map(([k]) => k));
  const extra: [string, string][] = [];
  for (const r of l.additional_info ?? []) {
    if (!r || !r.label || !r.value) continue;
    const k = attrDisplayLabel(t(r.label), r.key, locale, ATTRIBUTE_UNRESOLVED_AR);
    const v = arAttrValue(r.label, String(r.value), locale);
    if (k && v && !shown.has(k)) { shown.add(k); extra.push([k, v]); }
  }
  const chips = FEATURE_META.filter((f) => l.features?.[f.key]).map((f) => t(f.label));
  if (l.driver_room) chips.push(t('Driver room'));
  const rows = [...facts, ...extra];
  const tx = { textAlign: (isRTL ? 'right' : 'left') as 'right' | 'left', writingDirection: (isRTL ? 'rtl' : 'ltr') as 'rtl' | 'ltr' };
  // «1.95 مليون» (two decimals at most, trailing zeros dropped) or «850,000».
  const fmtSar = (v: number) => v >= 1e6
    ? t('{n} million', { n: String(Math.round(v / 1e4) / 100) })
    : Math.round(v).toLocaleString('en-US');
  const Frame: any = 'iframe';
  const Canvas: any = 'canvas';
  const mapTitle = t('Property location on Google Maps');
  // 375px phones: the one-line key details give up a point of size rather than a pixel of width.
  const keyFont = box.w && box.w < 390 ? { fontSize: 13.5 } : null;
  // THE BUTTON TO THE REAL AD, rendered twice from one place: in flow (the first screen's last row) and
  // as the floating twin. Start side: the copy; then the 👈 tapping toward the GOLD BUZZER on the end
  // side — a gold pill carrying the site's logo in its own colours. The whole bar is the tap target.
  // Motion (all off under reduced motion): a white shine sweeps the gold pill only (~3s), its glow
  // pulses (2.4s), the hand taps (1.1s). The spoken name stays «افتح الإعلان في {site} للتواصل».
  // The bar itself never highlights or scales; a press anywhere on it pushes only the buzzer.
  const hazard = (
    <View role="note" style={s.hazard}>
      <Text style={s.hazardTx}><Text aria-hidden>⚠️</Text>{' '}{t("This ad may have been removed or sold. We review ads continuously, but we can't guarantee they're still available.")}</Text>
    </View>
  );
  const cta = (testID: string, live = true) => (
    <Pressable
      testID={testID}
      onPress={goOpen}
      onPressIn={() => setPressing(testID)}
      onPressOut={() => setPressing(null)}
      focusable={live}
      accessibilityRole="link"
      accessibilityLabel={t('Open the ad on {name} to contact', { name })}
      accessibilityElementsHidden={!live}
      importantForAccessibility={live ? 'auto' : 'no-hide-descendants'}
      style={s.cta}
    >
      <View style={s.ctaLines}>
        <Text numberOfLines={1} style={[s.ctaTx, tx]}>{t('Tap here to contact')}</Text>
        <Text numberOfLines={1} style={[s.ctaSub, tx]}>{t("and to confirm it's still on {siteName}", { siteName: name })}</Text>
      </View>
      <Text style={s.ctaHand}>👈</Text>
      <View
        style={[s.gold, !reduced && s.goldPulse, pressing === testID && s.goldDown]}
        pointerEvents="none"
        // @ts-expect-error web-only DOM prop on the RNW host node (the confetti origin)
        dataSet={{ gold: '1' }}
      >
        <View style={[{ transform: [{ scale: 88 / 96 }] }, s.goldLogo]}><SourceBadge source={l.source} /></View>
        {!reduced && <View style={s.goldShine} pointerEvents="none" />}
        {burst > 0 && <View key={burst} style={s.goldRing} pointerEvents="none" />}
      </View>
    </Pressable>
  );

  return (
    <View testID="listing-preview" style={s.root} onLayout={onRoot} ref={rootRef}>
      {/* (1) slim top bar: the source pill + this tab's ✕ */}
      <View style={s.bar} onLayout={measure('bar')}>
        <View style={s.srcPill}>
          <View style={s.srcLogo} pointerEvents="none"><View style={{ transform: [{ scale: 0.4 }] }}><SourceBadge source={l.source} /></View></View>
          <Text numberOfLines={1} style={[s.srcTx, tx]}><Text style={s.srcName}>{name}</Text>{` · ${location}`}</Text>
        </View>
        {onClose ? (
          <Pressable
            testID="listing-preview-close"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t('Close')}
            style={({ hovered }: any) => [s.iconBtn, hovered && s.hover]}
            // @ts-expect-error web-only DOM props on the RNW host node (44px tap floor)
            dataSet={{ ...TAP44 }}
          >
            <Ionicons name="close" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} scrollEventThrottle={48} onScroll={onBodyScroll} onLayout={(e: any) => { viewH.current = e.nativeEvent.layout.height; }}>
        {/* (2) hero: edge to edge, swipeable, the flexible block */}
        {photos.length > 0 && <View testID="listing-preview-gallery" style={[s.hero, { height: heroH }]}>
          <ScrollView
            ref={heroRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onHeroScroll}
            style={s.fill}
          >
            {photos.map((p, i) => (
              <View key={p + i} style={{ width: slideW || '100%', height: heroH }}>
                {i === main
                  ? <Image source={{ uri: p }} style={s.fill} contentFit="cover" priority="high" loading="eager" accessibilityLabel={t('Photo {n} of {total}', { n: i + 1, total: photos.length })} />
                  : Math.abs(i - main) <= 1
                    ? <Image source={{ uri: p }} style={s.fill} contentFit="cover" priority="low" loading="lazy" accessibilityLabel={t('Photo {n} of {total}', { n: i + 1, total: photos.length })} />
                    : null}
              </View>
            ))}
          </ScrollView>
          {photos.length > 1 && (
            <Pressable testID="listing-preview-counter" onPress={() => goTo(main + 1)} accessibilityRole="button" accessibilityLabel={t('Next photo')} style={[s.counter, isRTL ? { right: 10 } : { left: 10 }]}>
              <Text style={s.counterTx}>{main + 1} / {photos.length}</Text>
            </Pressable>
          )}
          {photos.length > 1 && (
            // Pinned LTR: the LEFT button steps to the next photo in Arabic (the reading direction), the RIGHT
            // one back; English mirrors. SVG chevrons, never ‹ › glyphs — bidi would mirror those.
            <View style={s.arrows} ref={setLtr} pointerEvents="box-none">
              <Pressable testID="listing-preview-arrow-left" onPress={() => goTo(main + (isRTL ? 1 : -1))} accessibilityRole="button" accessibilityLabel={t(isRTL ? 'Next photo' : 'Previous photo')} style={({ hovered }: any) => [s.arrow, hovered && s.arrowHover]}>
                <Chevron dir="left" />
              </Pressable>
              <Pressable testID="listing-preview-arrow-right" onPress={() => goTo(main + (isRTL ? -1 : 1))} accessibilityRole="button" accessibilityLabel={t(isRTL ? 'Previous photo' : 'Next photo')} style={({ hovered }: any) => [s.arrow, hovered && s.arrowHover]}>
                <Chevron dir="right" />
              </Pressable>
            </View>
          )}
        </View>}
        {wide && photos.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbs} onLayout={measure('thumbs')}>
            {photos.map((p, i) => (
              <Pressable key={p + i} testID="listing-preview-thumb" accessibilityRole="button" accessibilityLabel={t('Photo {n} of {total}', { n: i + 1, total: photos.length })} accessibilityState={{ selected: i === main }} onPress={() => goTo(i)} style={[s.thumb, i === main && s.thumbOn]}>
                <Image source={{ uri: p }} style={s.fill} contentFit="cover" priority="low" loading="lazy" />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* (3) price — numerals in the app's Poppins token, the currency small — ONE key line, and the
            host badge on the end side: the site's logo big, «مستضاف على {site}», a tap to the real ad */}
        <View style={s.head} onLayout={measure('head')}>
          <View style={s.headMain}>
            <Text testID="listing-preview-price" numberOfLines={1} style={[s.price, tx]}>
              {priceRuns(listingPrice(l, locale)).map((r, i) => <Text key={i} style={r.num ? s.priceNum : s.priceUnit}>{r.text}</Text>)}
            </Text>
            <View style={s.keyLine}>
              <Text numberOfLines={1} style={[s.keyTx, s.keyType, keyFont]}>{typeLabel}</Text>
              <View style={s.deal}><Text numberOfLines={1} style={s.dealTx}>{t(l.deal === 'Rent' ? 'for Rent' : 'for Sale')}</Text></View>
              {stats.map((v) => (
                <View key={v} style={s.keyStat}>
                  <View style={s.keyDot} />
                  <Text numberOfLines={1} style={[s.keyTx, keyFont]}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
          <Pressable
            testID="listing-preview-host"
            onPress={goOpen}
            accessibilityRole="link"
            accessibilityLabel={t('Open the ad on {name} to contact', { name })}
            style={({ hovered, pressed }: any) => [s.host, (hovered || pressed) && s.hostHover]}
          >
            <View style={s.hostLogo} pointerEvents="none"><View style={{ transform: [{ scale: 0.75 }] }}><SourceBadge source={l.source} /></View></View>
            <Text numberOfLines={2} style={s.hostTx}>{t('Hosted on {name}', { name })}</Text>
          </Pressable>
        </View>

        {/* (4) location: the address as published; the source's own pin, when it published one */}
        <View style={s.loc}>
          <View style={s.addrRow} onLayout={measure('addr')}>
            <Ionicons name="location-outline" size={15} color={colors.muted} />
            <Text numberOfLines={1} style={[s.addr, tx]}>{address}</Text>
          </View>
          {geo && IS_WEB ? (
            <View style={[s.mapBox, { height: mapH }]}>
              <Frame
                src={mapEmbedUrl(geo, locale, 14)}
                title={mapTitle}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none' }}
              />
              <Pressable testID="listing-preview-map" onPress={openMap} accessibilityRole="button" accessibilityLabel={t('Expand the map')} style={s.mapTap}>
                <View style={s.mapChip}>
                  <Ionicons name="expand-outline" size={15} color={lightColors.ink} />
                  <Text style={s.mapChipTx}>{t('Tap here to see the location')}</Text>
                </View>
                <View style={[s.mapPill, isRTL ? { right: 10 } : { left: 10 }]}>
                  <Text style={s.mapPillTx}>{t('Location as published by {name}', { name })}</Text>
                </View>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* (5) the first screen's last row: ONE button to the real ad */}
        <View style={s.ctaRow} ref={inflowRef} onLayout={(e: any) => { ctaPos.current = { y: e.nativeEvent.layout.y, h: e.nativeEvent.layout.height }; measure('cta')(e); }}>
          {hazard}
          {cta('listing-preview-contact')}
        </View>

        {/* the continuation starts here: the asking prices around this ad — numbers only, each house once;
            nothing when < 10 houses. Below the first screen on purpose: the hero and the map are at their floors. */}
        <View testID="listing-preview-range">
          {range ? (
            <View style={s.range}>
              <Text style={[s.h, tx]}>{t('Asking prices: {type} {deal} in {district}', { type: typeLabel, deal: t('for Sale'), district: district || city })}</Text>
              <View style={s.rangeBarWrap}>
                <View style={s.rangeTrack}>
                  <View style={[s.rangeMedian, { [isRTL ? 'right' : 'left']: `${pct(range.stats.median, range.stats)}%` }]} />
                  {range.price != null && <View style={[s.rangeDot, { [isRTL ? 'right' : 'left']: `${pct(range.price, range.stats)}%` }]} />}
                </View>
                <View style={s.rangeEnds}>
                  <Text style={s.rangeEnd}>{fmtSar(range.stats.p10)}</Text>
                  <Text style={s.rangeEnd}>{fmtSar(range.stats.p90)}</Text>
                </View>
              </View>
              <Text style={[s.rangeMid, tx]}>
                <Text style={s.rangeK}>{t('median')} </Text><Text style={s.rangeV}>{fmtSar(range.stats.median)}</Text>
                {range.stats.medianPpm != null ? <><Text style={s.rangeK}>{`  ·  ${t('per m²')} `}</Text><Text style={s.rangeV}>{Math.round(range.stats.medianPpm).toLocaleString('en-US')}</Text></> : null}
                {range.price != null ? <Text style={s.rangeK}>{`  ·  ● ${t('this ad')}`}</Text> : null}
              </Text>
              <Text style={[s.rangeNote, tx]}>{t('From {n} {type} listed {deal} in {district}, each house counted once. Just numbers — the decision is yours.', { n: range.stats.houses.toLocaleString('en-US'), type: typeLabel, deal: t('for Sale'), district: district || city })}</Text>
            </View>
          ) : null}
        </View>


        {/* (6) details: a compact two-column grid of what the source published, then its feature chips */}
        {(rows.length > 0 || chips.length > 0) && (
          <View testID="listing-preview-details" style={s.section}>
            <Text style={[s.h, tx]}>{t('Details')}</Text>
            {rows.length > 0 && (
              <View style={s.grid}>
                {rows.map(([k, v], i) => (
                  <View key={k} style={[s.cell, i >= rows.length - (rows.length % 2 || 2) && s.cellLast]}>
                    <Text numberOfLines={1} style={[s.cellK, tx]}>{k}</Text>
                    <Text numberOfLines={2} style={[s.cellV, tx]}>{v}</Text>
                  </View>
                ))}
              </View>
            )}
            {chips.length > 0 && (
              <View style={s.chips}>
                {chips.map((c) => (
                  <View key={c} style={s.chip}>
                    <Ionicons name="checkmark" size={13} color={colors.primary} />
                    <Text style={s.chipTx}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

      </ScrollView>

      {/* the floating twin of the CTA: visible only while the in-flow row is out of view; inert otherwise */}
      <View
        style={[s.ctaFloat, { opacity: floating ? 1 : 0 }, IS_WEB && ({ transitionProperty: 'opacity', transitionDuration: '160ms' } as any)]}
        pointerEvents={floating ? 'box-none' : 'none'}
        aria-hidden={!floating}
      >
        {hazard}
        {cta('listing-preview-contact-floating', floating)}
      </View>

      {/* the tap moment: a full-page, untouchable overlay of confetti — nothing else */}
      {IS_WEB && !reduced && partyOn ? (
        <View testID="listing-preview-party" style={s.party} pointerEvents="none" aria-hidden>
          <Canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </View>
      ) : null}

      {/* the expanded map: the same embed, interactive, over this page — the page keeps its scroll */}
      {mapOpen && geo && IS_WEB ? (
        <View testID="listing-preview-map-sheet" style={s.mapSheet}>
          <Frame src={mapEmbedUrl(geo, locale, 15)} title={mapTitle} referrerPolicy="no-referrer-when-downgrade" allow="fullscreen" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
          <Pressable
            testID="listing-preview-map-close"
            onPress={closeMap}
            accessibilityRole="button"
            accessibilityLabel={t('Close')}
            style={({ hovered }: any) => [s.mapClose, isRTL ? { left: 12 } : { right: 12 }, hovered && s.hover]}
            // @ts-expect-error web-only DOM props on the RNW host node (44px tap floor)
            dataSet={{ ...TAP44 }}
          >
            <Ionicons name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  hover: { backgroundColor: colors.tint },
  // top bar
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 0 },
  srcPill: {
    flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10,
  },
  srcLogo: { width: 38, height: 19, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  srcTx: { flexShrink: 1, fontSize: 13, color: colors.muted },
  srcName: { color: colors.ink, fontWeight: '600' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  // scroll body
  scroll: { position: 'absolute', top: 56, left: 0, right: 0, bottom: 0 },
  content: { paddingBottom: 96 },
  // hero
  hero: { width: '100%', backgroundColor: colors.chipFill, overflow: 'hidden' },
  counter: {
    position: 'absolute', bottom: 10, left: 10, minHeight: 28, justifyContent: 'center',
    backgroundColor: colors.scrim, borderRadius: radius.pill, paddingHorizontal: 11,
  },
  counterTx: { color: colors.onFill, fontSize: 12.5, fontFamily: NUM_FONT, fontVariant: ['tabular-nums'] },
  arrows: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  // A 44px hit box around a white 36px disc — the visible circle the owner asked for, the tap floor kept.
  arrow: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  arrowHover: { opacity: 0.85 },
  arrowDisc: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' },
  thumbs: { gap: 8, paddingHorizontal: 14, paddingTop: 10 },
  thumb: { width: 72, height: 54, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: colors.primary },
  // price + key line + host badge
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10 },
  headMain: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 4 },
  price: { fontSize: 28, lineHeight: 36, color: colors.dark },
  priceNum: { fontFamily: NUM_FONT, fontWeight: '600', fontVariant: ['tabular-nums'] },
  priceUnit: { fontSize: 15, color: colors.muted, fontWeight: '500' },
  // ONE line, never wrapped: the type label is the part that gives way.
  keyLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 7, minWidth: 0 },
  keyTx: { fontSize: 15, fontWeight: '600', color: colors.ink },
  keyType: { flexShrink: 1 },
  keyStat: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 0 },
  host: { alignItems: 'center', gap: 4, width: 88, flexShrink: 0 },
  hostHover: { opacity: 0.85 },
  // The transparent logo itself, no frame (owner: a framed one «looks like a photo»).
  hostLogo: { width: 72, height: 36, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  hostTx: { fontSize: 11.5, lineHeight: 14, fontWeight: '600', color: colors.muted, textAlign: 'center' },
  keyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.line },
  deal: { backgroundColor: colors.tint, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  dealTx: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  // location
  loc: { marginHorizontal: 16, marginTop: 10, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, overflow: 'hidden' },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  addr: { flexShrink: 1, fontSize: 14, color: colors.ink },
  mapBox: { backgroundColor: colors.chipFill, borderTopWidth: 1, borderTopColor: colors.line },
  mapTap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mapPill: {
    position: 'absolute', bottom: 10, maxWidth: '80%',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  mapPillTx: { fontSize: 11.5, fontWeight: '600', color: colors.muted },
  // Centred on the satellite image, so it is white on purpose in both themes (a photo, not a surface).
  mapChip: {
    position: 'absolute', top: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7,
    boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
  },
  mapChipTx: { fontSize: 13, fontWeight: '700', color: lightColors.ink },
  mapSheet: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.surface },
  mapClose: {
    position: 'absolute', top: 12, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, boxShadow: '0 2px 10px rgba(20,40,30,0.18)',
  },
  // the asking-price box
  range: { marginTop: 14, marginHorizontal: 16, gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, padding: 12 },
  rangeBarWrap: { gap: 4 },
  rangeTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine },
  rangeMedian: { position: 'absolute', top: -3, width: 2, height: 12, marginLeft: -1, backgroundColor: colors.muted, borderRadius: 1 },
  rangeDot: { position: 'absolute', top: -5, width: 16, height: 16, marginLeft: -8, borderRadius: 8, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface },
  rangeEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeEnd: { fontSize: 12, color: colors.muted, fontFamily: NUM_FONT },
  rangeMid: { fontSize: 13.5, color: colors.ink },
  rangeK: { color: colors.muted },
  rangeV: { fontWeight: '700', color: colors.ink, fontFamily: NUM_FONT },
  rangeNote: { fontSize: 12, lineHeight: 18, color: colors.muted },
  // sections
  section: { marginTop: 14, paddingHorizontal: 16, gap: 8 },
  h: { fontSize: 13, fontWeight: '600', color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, overflow: 'hidden' },
  cell: { width: '50%', paddingHorizontal: 12, paddingVertical: 8, gap: 1, borderBottomWidth: 1, borderBottomColor: colors.line },
  cellLast: { borderBottomWidth: 0 },
  cellK: { fontSize: 12, color: colors.muted },
  cellV: { fontSize: 14, fontWeight: '600', color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.tint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  chipTx: { fontSize: 12.5, color: colors.chipIcon },
  // the CTA row (in flow) and its floating twin
  ctaRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 8 },
  // The hazard note (owner: «EXTREMELY important»): read before the button, in both bars.
  hazard: { backgroundColor: colors.hazardBg, borderWidth: 1, borderColor: colors.hazardLine, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10 },
  hazardTx: { fontSize: 12.5, lineHeight: 18, color: colors.hazardInk },
  ctaFloat: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, gap: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  // A 68px bar that invites the tap: a three-stop green gradient (CSS, so the theme's var() tokens
  // resolve inside it; the lightest stop is a tint OF the primary token), an inset top highlight and a
  // deeper shadow. The copy on the start side, the pointing hand, the gold buzzer on the end side.
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 68, paddingStart: 16, paddingEnd: 8, borderRadius: 20,
    backgroundColor: colors.primary,
    ...(IS_WEB ? { backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${colors.primary} 82%, white), ${colors.primary} 48%, ${colors.dark})` } as any : {}),
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 10px 26px rgba(29,74,55,0.34)',
  },
  ctaLines: { flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 3 },
  ctaTx: { color: colors.onFill, fontSize: 17, lineHeight: 22, fontWeight: '800' },
  ctaSub: { color: colors.onFill, opacity: 0.88, fontSize: 12.5, lineHeight: 16 },
  // The pointing hand, ~6px from the buzzer; it stays still (owner 2026-10-10).
  ctaHand: { fontSize: 26, lineHeight: 30, marginEnd: 6, flexShrink: 0, ...(IS_WEB ? { filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.25))' } as any : {}) },
  // THE GOLD BUZZER: a radial gold, an inner light ring, a dark-gold rim, a warm glow — the site's logo in
  // its own colours on top. The brand's one gold exception (src/theme/palette.ts BUZZER_GOLD).
  gold: {
    width: 112, height: 54, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
    backgroundColor: BUZZER_GOLD.mid,
    ...(IS_WEB ? { backgroundImage: `radial-gradient(ellipse at 35% 30%, ${BUZZER_GOLD.light} 0%, ${BUZZER_GOLD.mid} 38%, ${BUZZER_GOLD.deep} 72%, ${BUZZER_GOLD.dark} 100%)` } as any : {}),
    boxShadow: `inset 0 0 0 2px ${BUZZER_GOLD.ring}, 0 0 0 3px ${BUZZER_GOLD.rim}, 0 6px 16px ${BUZZER_GOLD.shade}, 0 0 14px ${BUZZER_GOLD.glow}`,
  },
  goldPulse: IS_WEB ? ({
    animationKeyframes: [{
      '0%': { boxShadow: `inset 0 0 0 2px ${BUZZER_GOLD.ring}, 0 0 0 3px ${BUZZER_GOLD.rim}, 0 6px 16px ${BUZZER_GOLD.shade}, 0 0 14px ${BUZZER_GOLD.glow}` },
      '50%': { boxShadow: `inset 0 0 0 2px ${BUZZER_GOLD.ring}, 0 0 0 3px ${BUZZER_GOLD.rim}, 0 6px 16px ${BUZZER_GOLD.shade}, 0 0 28px ${BUZZER_GOLD.glowPeak}` },
      '100%': { boxShadow: `inset 0 0 0 2px ${BUZZER_GOLD.ring}, 0 0 0 3px ${BUZZER_GOLD.rim}, 0 6px 16px ${BUZZER_GOLD.shade}, 0 0 14px ${BUZZER_GOLD.glow}` },
    }],
    animationDuration: '2.4s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out',
  } as any) : {},
  // Pressed anywhere on the bar: only the buzzer goes down.
  goldDown: {
    transform: [{ translateY: 3 }, { scale: 0.93 }],
    boxShadow: `inset 0 3px 8px rgba(122,82,8,0.45), inset 0 0 0 2px ${BUZZER_GOLD.ring}, 0 0 0 3px ${BUZZER_GOLD.rim}, 0 2px 6px ${BUZZER_GOLD.shade}`,
  },
  // A gold ring bursting outward from the buzzer on tap (.55s).
  goldRing: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.pill, borderWidth: 3, borderColor: BUZZER_GOLD.ring,
    ...(IS_WEB ? {
      animationKeyframes: [{ '0%': { opacity: 0.9, transform: [{ scale: 1 }] }, '100%': { opacity: 0, transform: [{ scale: 2.2 }] } }],
      animationDuration: '0.55s', animationTimingFunction: 'ease-out', animationFillMode: 'forwards',
    } as any : {}),
  },
  goldLogo: IS_WEB ? ({ filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.6))' } as any) : {},
  // The confetti overlay (pointer-events none).
  party: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 3 },
  // A white shine that sweeps the gold pill only, once every ~3s.
  goldShine: {
    position: 'absolute', top: -12, bottom: -12, left: 0, width: '60%',
    ...(IS_WEB ? {
      backgroundImage: 'linear-gradient(110deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 65%)',
      animationKeyframes: [{ '0%': { transform: [{ translateX: '130%' }] }, '28%': { transform: [{ translateX: '-130%' }] }, '100%': { transform: [{ translateX: '-130%' }] } }],
      animationDuration: '3s', animationDelay: '0.8s', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out',
    } as any : {}),
  },
});
