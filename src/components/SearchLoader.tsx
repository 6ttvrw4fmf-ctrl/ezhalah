// SearchLoader — the "Ezhalah is searching every Saudi platform for you" loading state, shown in the
// chat area WHILE a search runs, in the exact spot the results will appear. STATUS DISPLAY ONLY:
// it never touches the search, filters, ranking, or which listings return.
//
// DESIGN (owner 2026-07-09 v4 polish, LOCKED — Perplexity-quality interaction, Ezhalah-branded; the
// platform logos are the PRIMARY TRUST SIGNAL, not decoration):
// • The COMPLETE supported roster renders — every platform pill, never a 3–4 sample (Buy still hides
//   rent-only Gathern; a user platform-filter shows only those; a website down on its side is
//   hidden, owner 2026-09-26).
// • All names and logos fade in place inside fixed, automatically advancing pages.
//   Highlights never translate or scale logos (owner 2026-10-01: no downward pull).
// • The headline is minimal and ROTATES (~2.4s) through short Arabic status lines with smooth
//   cross-fades — no sentence ever sits static, no hard cuts.
// • The host starts this the INSTANT Search is pressed ('searching' from t=0 for guaranteed
//   searches); 'thinking' remains only for chat turns whose outcome is unknown.
// • When results are ready the loader does NOT vanish abruptly — the host flags `exiting` and the
//   whole block fades out softly (~420ms) into the results state (owner: "softly completes").
// Honors reduce-motion (plain fades; no wave, no pulse, no movement). The message column is
// LTR-pinned, so RTL is handled manually here (anchor right + row-reverse), like the rest of agent.tsx.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { PlatformLogo } from './platform-logo';
import { Image as ExpoImage } from 'expo-image';
import { scheduleLogoPrefetch } from '@/lib/prefetchLoaderLogos';
import CloudWisp from './CloudWisp';
import { cloudVariant } from '@/theme/skyScene';
import { useThemePalette } from '@/lib/appearance';
import PlatformRosterPager from './PlatformRosterPager';
import { useAtLeast } from '@/lib/useAtLeast';
import { PLATFORM_LOGO_BREAKPOINT } from '@/lib/responsive';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n, tWord } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import {
  bumpRotation,
  currentRotation,
  pickLoaderPlatforms,
  PLATFORM_META,
  type LoaderPlatform,
} from '@/data/loaderPlatforms';
import { hiddenPlatformNames, loadHiddenPlatformNames } from '@/data/loaderActivePlatforms';
import { loadSiteCount, siteCountNow } from '@/data/siteCount';
import { fetchLoaderScaleStats, type LoaderScaleStats } from '@/data/loaderScaleStats';
import { PILL_STAGGER, highlightStepMs, waveDelayMs, PILL_GROUP, WAVE_RISE, WAVE_HOLD, WAVE_FALL } from '@/lib/searchLoaderTiming';
import { buildSearchLoaderTitles, countWording, readingDurationMs } from '@/lib/searchLoaderTitles';
import { funnelKey, loadSearchFunnelFacts, type FunnelFacts, type FunnelPlace } from '@/data/searchLoaderFacts';
import type { SearchQuery } from '@/data/search';

const IS_WEB = Platform.OS === 'web';
// Which websites are down on their side — read once per session, started here at app load so it has
// normally resolved before the first search mounts the strip. Not during the web static render
// (app.json output "static"), which runs this module in Node at build time.
if (!IS_WEB || typeof window !== 'undefined') void loadHiddenPlatformNames();
// The ONE site count every user-facing number uses (owner 2026-10-20: «make it 148»): the WhatsApp
// card, the share sentence, the welcome line and this loader's «نبحث في N منصة» all read
// src/data/siteCount.ts. The strip still hides dormant logos; the sentence no longer counts them —
// until the count has been read it falls back to the logos on screen.
if (!IS_WEB || typeof window !== 'undefined') void loadSiteCount();
// The logos are fetched a moment after the app opens, so the loader never shows empty frames on a slow
// phone (owner 2026-10-25 screenshot). Web only: native ships its assets inside the app.
if (IS_WEB && typeof window !== 'undefined') scheduleLogoPrefetch(PLATFORM_META.map((p) => p.logo), (uris) => ExpoImage.prefetch(uris));
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

// Rotating searching headlines (owner-approved copy, v4 set — short, alive, smooth cross-fades).
// EXTENDED 2026-09-12 (owner: "those things are more like marketing... people would be like wow,
// this has a big database") — three of the six lines below carry a LIVE number instead of static
// copy: total searchable listings, the platform count (reused from the roster this same screen
// already computed — never a second, independently-fetched count that could disagree with what's
// on screen), and city+district coverage. Every number is DERIVED, never hardcoded — see
// loaderScaleStats.ts and loader_scale_stats_ar(). SOURCE IS TRUTH / "a failed fetch is not an empty
// answer": if the scale-stats fetch hasn't resolved (or fails), the number-bearing lines fall back to
// their original plain wording — never a zero, never a stale/guessed figure.
const SEARCH_TITLES = [
  'Ezhalah is searching the platforms…',
  'Checking the matching properties…',
  'Matching the filters…',
  'Reviewing sites and prices…',
  'Preparing the results…',
] as const;
// Per-line rotation duration is now reading-pace proportional — see readingDurationMs() in
// lib/searchLoaderTitles.ts (owner 2026-09-12: "make it all at the same speed"). The old fixed
// TITLE_ROTATE_MS=2400 constant is gone; readingDurationMs('نطابق الفلاتر') lands close to it, so
// the short lines don't perceptibly change pace — only the long live-number lines slow down.

// Pill choreography — deliberately calm (owner v4: slower, readable, premium; never "flashed and
// disappeared"), and since 2026-09-06 long enough that EVERY platform is both revealed and
// highlighted before the loader may leave (owner: "make sure all the platforms show clearly … doing
// it quick will make them lost"). The numbers and the contract live in ONE pure module so a barrier
// can execute them — see lib/searchLoaderTiming.ts and
// scripts/verify-search-loader-shows-every-platform.ts.

// Fade in place: opacity never shifts the viewport or changes logo size.
function Appear({
  children, delay = 0, reduced, style,
}: {
  children: React.ReactNode; delay?: number; reduced: boolean; style?: any;
}) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withTiming(1, { duration: reduced ? 150 : 260, easing: EASE_OUT }));
    return () => cancelAnimation(v);
  }, [v, delay, reduced]);
  const a = useAnimatedStyle(() => ({
    opacity: v.value,
  }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

// One softly-pulsing thinking dot (staggered). No bounce — just a calm opacity breathe.
function Dot({ index, reduced }: { index: number; reduced: boolean }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    if (reduced) { v.value = 0.6; return; }
    v.value = withDelay(
      index * 160,
      withRepeat(withSequence(
        withTiming(1, { duration: 340, easing: EASE_OUT }),
        withTiming(0.3, { duration: 340, easing: EASE_OUT }),
      ), -1, false),
    );
    return () => cancelAnimation(v);
  }, [v, index, reduced]);
  const a = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[s.thinkDot, a]} />;
}

function Dots({ reduced }: { reduced: boolean }) {
  return (
    <View style={s.dots}>
      {[0, 1, 2].map((i) => <Dot key={i} index={i} reduced={reduced} />)}
    </View>
  );
}

// A platform pill with the traveling-highlight treatment. NO BOX (owner 2026-09-12: "remove those
// boxes... make the background transparent so it blends in with our background, because now it
// shows that it is a box and it's a photo" — the pill NEVER carries a fill or a border, resting or
// highlighted; the logo (a real transparent PNG since #2426) and the name sit directly on the app's
// own background). The name always renders — no logo-only compact mode (owner: "put the name also,
// because we need to include the name of each website" — reverses the 2026-09-12 mobile compact
// tile). The highlight itself survives as a SHADOW-ONLY glow (no fill under it) plus the name text
// warming from muted to primary — the same vocabulary ui.tsx's own selection glow
// already uses (text-color interpolation + boxShadow/shadow*), just with the fill dropped so nothing
// ever reads as a box. Several pills are lit at once (highlight duration > step). NO checkmarks /
// status icons (owner: never a checklist).
function PlatformPill({
  item, index, total, rtl, reduced, name,
}: {
  item: LoaderPlatform; index: number; total: number; rtl: boolean; reduced: boolean; name: string;
}) {
  const wide = useAtLeast(PLATFORM_LOGO_BREAKPOINT);
  const pillOverride = wide ? { height: 'auto' as const, gap: 8 } : { height: 'auto' as const, gap: 4 };
  const nameOverride = wide ? { fontSize: 12, lineHeight: 15 } : { fontSize: 11, lineHeight: 14 };
  const h = useSharedValue(0);
  // LITERAL hex, not the colors.* token (owner theme contract: interpolateColor parses actual color
  // values — colors.* resolves to var(--ez-*) on web, which it cannot parse). Same pattern the
  // pre-existing glow literals below already used; verify-theme-contract.ts fails the build on a
  // colors.* token reaching this call.
  const pal = useThemePalette();
  const nameBase: [string, string] = [pal.body, pal.primary];
  useEffect(() => {
    if (reduced) { h.value = 0; return; }
    // The wave reaches pill `index` at waveDelayMs(index, step) — pills share a step in groups of
    // PILL_GROUP (owner 2026-09-19: keep the ten seconds, widen the wave). The LAST pill's wait grows
    // wherever highlightStepMs()'s 180ms readable-step floor binds (every roster above 41). That real
    // deadline is lastPillLitMs(total) in lib/searchLoaderTiming, and agent.tsx's SEARCH_MIN_MS must
    // cover it — executed by scripts/verify-search-loader-shows-every-platform.ts. (The comment that
    // used to sit here claimed one sweep took LOADER_SWEEP_MS "regardless of roster size"; it does
    // not once the step is floored, and that sentence is why the overrun went unnoticed.)
    // `rest` keeps each pill's phase stable per loop.
    const step = highlightStepMs(total);
    const lit = WAVE_RISE + WAVE_HOLD + WAVE_FALL;
    // One full pass advances PILL_GROUP pills per step, so a loop is ceil(total / PILL_GROUP)
    // steps long — not `total` steps. Using the old length here would leave a dead gap at the end
    // of every loop exactly as long as the grouping saved.
    const rest = Math.max(260, Math.ceil(total / PILL_GROUP) * step - lit);
    h.value = withDelay(waveDelayMs(index, step), withRepeat(withSequence(
      withTiming(1, { duration: WAVE_RISE, easing: EASE_OUT }),
      withTiming(1, { duration: WAVE_HOLD }),
      withTiming(0, { duration: WAVE_FALL, easing: EASE_OUT }),
      withTiming(0, { duration: rest }),
    ), -1, false));
    return () => cancelAnimation(h);
  }, [h, index, total, reduced]);
  const rowGlow = useAnimatedStyle(() => {
    const g = h.value;
    return {
      // Logos keep their exact size throughout the highlight.
      // Soft green glow — SHADOW ONLY, no fill/border, so the highlight reads as ambient light under
      // the logo+name, never a filled box. Same rgba/blur curve ui.tsx's own selection glow uses.
      ...(IS_WEB
        ? ({ boxShadow: `0px ${4 * g}px ${14 * g}px rgba(73,57,83,${0.16 * g})` } as any)
        : { shadowColor: pal.primary, shadowOpacity: 0.16 * g, shadowRadius: 14 * g, shadowOffset: { width: 0, height: 4 * g }, elevation: 4 * g }),
    };
  });
  const nameGlow = useAnimatedStyle(() => ({
    color: interpolateColor(h.value, [0, 1], nameBase),
  }));
  return (
    <Appear delay={index * (reduced ? 25 : PILL_STAGGER)} reduced={reduced}>
      <Animated.View style={[s.pill, pillOverride, rowGlow]}>
        <View style={{ position: 'relative' }}>
          <CloudWisp variant={cloudVariant(name)} width={72} height={22} opacity={0.65} style={{ bottom: -3, left: cloudVariant(name) % 2 ? -12 : 36 }} />
          <PlatformLogo source={item.logo} />
        </View>
        <Animated.Text
          style={[s.pillName, nameOverride, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: 'center' }, nameGlow]}
        >
          {name}
        </Animated.Text>
      </Animated.View>
    </Appear>
  );
}

// The headline — minimal, ROTATING while searching (no sentence sits for seconds), with a smooth
// cross-fade on every change and a continuous gentle shimmer-pulse so the text always reads as
// actively working. Rotation freezes while exiting. Reduced-motion: static first title, plain fades.
function PhaseTitle({
  phase, rtl, reduced, exiting, platformCount, scaleStats, query,
}: {
  phase: 'thinking' | 'searching'; rtl: boolean; reduced: boolean; exiting: boolean;
  // The SAME count the pills on screen show — never an independent fetch that could disagree.
  platformCount: number;
  // null until loader_scale_stats_ar() resolves (or forever, on failure) — the Kingdom line then
  // falls back to its original static wording.
  scaleStats: LoaderScaleStats | null;
  // THIS search — its city and district drive the two personal lines (lib/searchLoaderTitles.ts).
  query?: SearchQuery | null;
}) {
  const { t, locale } = useI18n();
  const loc: 'ar' | 'en' = locale === 'en' ? 'en' : 'ar';
  const [titleIdx, setTitleIdx] = useState(0);
  // The city/district counts of THIS search, from the once-per-session caches the headline already
  // uses — no per-search round trip. Refetched only when the place the search names changes.
  const placeKey = funnelKey(query);
  const [funnel, setFunnel] = useState<FunnelFacts>({});
  useEffect(() => {
    let live = true;
    setFunnel({});
    loadSearchFunnelFacts(query).then((f) => { if (live) setFunnel(f); }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the place, not the query object identity
  }, [placeKey]);
  const titles = useMemo(() => {
    const arabic = /[؀-ۿ]/;
    // Exact digits only (owner 2026-10-17, countWording): there is no «more than» wording any more, and
    // the old branch on it was the one TypeScript error in the app (TS2367) once tsc became a PR gate.
    const placeLine = (p: FunnelPlace | undefined, exactKey: string, slot: 'city' | 'district'): string | null => {
      const w = countWording(p?.count, loc);
      const name = p ? (loc === 'ar' ? p.ar : p.en) : '';
      if (!w || !name || (loc === 'en' && arabic.test(name))) return null; // never Arabic mid-English
      return t(exactKey, { count: w.text, [slot]: name });
    };
    const kingdom = countWording(scaleStats?.listingCount, loc);
    // WHAT THEY ASKED FOR: the type (one picked type, else the category) + buy/rent. No type at all →
    // the original «نطابق الفلاتر».
    const types = (query as (SearchQuery & { types?: string[] }) | null | undefined)?.types;
    const kind = query?.type ?? (types?.length === 1 ? types[0] : null) ?? query?.category ?? null;
    const dealWord = query?.deal === 'Rent' ? t('for rent') : query?.deal === 'Buy' ? t('for sale') : '';
    const what = kind ? [tWord(kind, loc), dealWord].filter(Boolean).join(' ') : '';
    return buildSearchLoaderTitles({
      search: platformCount > 0 ? t('Searching {count} real-estate platforms…', { count: platformCount }) : t(SEARCH_TITLES[0]),
      checking: kingdom ? t('Checking {count} listings across the Kingdom…', { count: kingdom.text }) : t(SEARCH_TITLES[1]),
      city: placeLine(funnel.city, 'Reviewing {count} listings in {city}…', 'city'),
      district: placeLine(funnel.district, 'Going through {count} listings in {district}…', 'district'),
      matching: what ? t('Matching your request: {what}…', { what }) : t(SEARCH_TITLES[2]),
      preparing: t(SEARCH_TITLES[4]),
    });
  }, [t, loc, scaleStats, platformCount, funnel, query]);
  useEffect(() => {
    if (phase !== 'searching' || reduced || exiting) return;
    // Reading-pace rotation (owner 2026-09-12): each line stays up for readingDurationMs(that
    // line) — a self-rescheduling timeout, not a fixed setInterval, so a short line and a long
    // live-number line both feel like the same READING speed instead of the same raw duration.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setTitleIdx((i) => {
        const next = (i + 1) % titles.length;
        if (!cancelled) timer = setTimeout(tick, readingDurationMs(titles[next]));
        return next;
      });
    };
    timer = setTimeout(tick, readingDurationMs(titles[Math.min(titleIdx, titles.length - 1)]));
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- titleIdx deliberately excluded: the
    // functional setTitleIdx update above reads the current index without needing it in scope, and
    // including it would restart this effect (and the pending timer) on every single tick.
  }, [phase, reduced, exiting, titles]);
  // titles can shrink (e.g. scaleStats arrives) between renders —
  // clamp so a stale index never reads past the current array's end.
  const label = phase === 'thinking' ? t('Ezhalah is thinking…') : titles[Math.min(titleIdx, titles.length - 1)];

  const v = useSharedValue(1);       // cross-fade on phase/title change
  const pulse = useSharedValue(1);   // continuous soft shimmer
  const prev = useRef(label);
  useEffect(() => {
    if (prev.current !== label) {
      prev.current = label;
      v.value = 0;
      v.value = withTiming(1, { duration: reduced ? 160 : 260, easing: EASE_OUT });
    }
  }, [label, reduced, v]);
  useEffect(() => {
    if (reduced) { cancelAnimation(pulse); pulse.value = 1; return; }
    pulse.value = withRepeat(withSequence(
      withTiming(0.55, { duration: 650, easing: EASE_OUT }),
      withTiming(1, { duration: 650, easing: EASE_OUT }),
    ), -1, false);
    return () => cancelAnimation(pulse);
  }, [pulse, reduced]);
  const a = useAnimatedStyle(() => ({
    opacity: v.value * pulse.value,
  }));
  return (
    <Animated.Text style={[s.title, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }, a]}>
      {label}
    </Animated.Text>
  );
}

export default function SearchLoader({
  phase, query, resultSources, exiting = false, onPresented, bottomInset, settleTop,
}: {
  phase: 'thinking' | 'searching';
  bottomInset?: number;
  settleTop?: number; // window y the grid will sit at once the thread has glided down to it (host-measured)
  query?: SearchQuery | null;
  resultSources?: string[];
  onPresented?: (complete: boolean) => void;
  exiting?: boolean; // host sets this just before morphing to results → soft fade-out, no hard cut
}) {
  const { t, isRTL } = useI18n();
  const reduced = useReducedMotion();
  const rtl = isRTL;

  // Per-search rotation cursor — with the full roster always shown it only varies the ORDER, so the
  // strip reads slightly differently each search. Advance it so the next search differs.
  const offsetRef = useRef<number | null>(null);
  if (offsetRef.current == null) offsetRef.current = currentRotation();
  useEffect(() => { bumpRotation(); }, []);

  // THE FULL ROSTER, MINUS WEBSITES DOWN ON THEIR SIDE. Owner 2026-09-20 (reversing the 2026-08-29
  // active-only rule): "show 59 … whenever I add a new website that number changes and it stays stable
  // … even if it's dead, till I manually [remove it]" — so a scraper going cold does NOT shrink the
  // strip. Owner 2026-09-26, the one exception: a website down on ITS side (platform_registry
  // 'dormant'/'retired') loses its logo and the count drops; both return when it is flipped back to
  // 'active'. hiddenPlatformNames() is that set (null until known → full roster, never a guess).
  //
  // No per-search round trip: loader_active_platforms_ar ran on every search mount, measured 0.4-3.7 s
  // (9,004 calls in 9.3 days), competing with the query the user was waiting for (removed 2026-09-21).
  // The statuses are read once per SESSION instead (module scope above); this retries only if that
  // read failed, and does nothing once it has succeeded.
  useEffect(() => { void loadHiddenPlatformNames(); }, []);

  // The "big database" marketing numbers (owner 2026-09-12) — resolved once per mount, same
  // null-on-failure/no-guess contract used across the loader. See loaderScaleStats.ts.
  const [scaleStats, setScaleStats] = useState<LoaderScaleStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLoaderScaleStats().then((stats) => {
      if (!cancelled && stats) setScaleStats(stats);
    });
    return () => { cancelled = true; };
  }, []);

  // Roster is computed once per (query, resultSources) and FROZEN — `resultSources`
  // arriving later (as the query resolves) only reorders which pills lead; it must never reshuffle
  // or hide pills already on screen. `query` just gates WHEN the strip mounts (a search is actually
  // underway); its contents do not affect WHICH platforms show. If the down-site statuses resolve
  // AFTER the strip already mounted for THIS search, the frozen roster stays — the next search
  // picks up the filtered set. That prevents mid-search jitter.
  const frozenRef = useRef<LoaderPlatform[] | null>(null);
  const platforms = useMemo<LoaderPlatform[]>(() => {
    if (frozenRef.current && frozenRef.current.length) return frozenRef.current;
    const picked = query ? pickLoaderPlatforms(resultSources, offsetRef.current ?? 0, hiddenPlatformNames()) : [];
    if (picked.length) frozenRef.current = picked;
    return picked;
  }, [query, resultSources]);

  useEffect(() => {
    if (phase === 'searching' && platforms.length === 0) onPresented?.(true);
  }, [phase, platforms.length, onPresented]);

  // Soft completion (owner v4): fade the whole block out gently before the results morph in —
  // the loader must never vanish in a single frame.
  const exit = useSharedValue(1);
  useEffect(() => {
    if (exiting) exit.value = withTiming(0, { duration: reduced ? 150 : 420, easing: EASE_OUT });
  }, [exiting, reduced, exit]);
  const exitStyle = useAnimatedStyle(() => ({
    opacity: exit.value,

  }));

  return (
    <Animated.View style={[s.wrap, { alignItems: rtl ? 'flex-end' : 'flex-start' }, exitStyle]}>
      {/* Headline: sparkle + rotating phase text (+ soft dots while thinking) */}
      <View style={[s.titleRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Ionicons name="sparkles" size={15} color={colors.primary} />
        <PhaseTitle phase={phase} rtl={rtl} reduced={reduced} exiting={exiting} platformCount={siteCountNow() ?? platforms.length} scaleStats={scaleStats} query={query} />
        {phase === 'thinking' ? <Dots reduced={reduced} /> : null}
      </View>

      {/* The complete platform roster — logo + Arabic name pills with the traveling highlight, NO
          box (owner 2026-09-12: "remove those boxes... put the name also" — supersedes the same-day
          logo-only mobile compact tile; the name always renders now, on every viewport). */}
      {phase === 'searching' && platforms.length > 0 ? (
        <PlatformRosterPager bottomInset={bottomInset} settleTop={settleTop} items={platforms} rtl={rtl} onPresented={onPresented ?? (() => {})}
          renderItem={p => <PlatformPill item={p} index={0} total={1} rtl={rtl} reduced={reduced} name={t(p.i18nKey)} />} />
      ) : null}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', gap: 12 },
  titleRow: { alignItems: 'center', gap: 7 },
  title: { fontSize: 14.5, fontWeight: '600', color: colors.body },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: 3 },
  thinkDot: { width: 4.5, height: 4.5, borderRadius: 2.5, backgroundColor: colors.muted },

  // NO BOX (owner 2026-09-12): the pill has no fill and no border, resting or highlighted — the
  // logo (a real transparent PNG, #2426) and the name sit directly on the app's own background, so
  // nothing ever reads as "a box" or "a photo." The highlight is a shadow-only glow (PlatformPill's
  // rowGlow) plus the name warming from muted to primary — transforms/shadow/color only, so the wave
  // still causes ZERO layout shift.
  // Name below its equal-size logo frame. No truncation and no moving/scaling highlight.
  pill: { alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 2 },
  pillName: { fontWeight: '600', color: colors.body, alignSelf: 'stretch' },
});
