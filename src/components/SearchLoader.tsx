// SearchLoader — the "Ezhalah is searching every Saudi platform for you" loading state, shown in the
// chat area WHILE a search runs, in the exact spot the results will appear. STATUS DISPLAY ONLY:
// it never touches the search, filters, ranking, or which listings return.
//
// DESIGN (owner 2026-07-09 v4 polish, LOCKED — Perplexity-quality interaction, Ezhalah-branded; the
// platform logos are the PRIMARY TRUST SIGNAL, not decoration):
// • The COMPLETE supported roster renders — every platform pill, never a 3–4 sample (Buy still hides
//   rent-only Gathern; a user platform-filter shows only those).
// • Pills reveal GRADUALLY (fade + slight upward motion, ~75ms stagger → the set lands in ~1.5–2.5s),
//   then a calm highlight travels pill to pill: soft background/border emphasis + a gentle glow +
//   ~2% scale. NO checkmarks, NO ticks, NO checklist feel, no bouncing, no flash.
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
import { Image } from 'expo-image';
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
import { useResolvedTheme } from '@/lib/appearance';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import {
  bumpRotation,
  currentRotation,
  pickLoaderPlatforms,
  type LoaderPlatform,
} from '@/data/loaderPlatforms';
import { fetchActivePlatformNames } from '@/data/loaderActivePlatforms';
import { fetchLoaderScaleStats, type LoaderScaleStats } from '@/data/loaderScaleStats';
import { PILL_STAGGER, highlightStepMs } from '@/lib/searchLoaderTiming';
import { buildSearchLoaderTitles } from '@/lib/searchLoaderTitles';
import type { SearchQuery } from '@/data/search';
import { grouped } from '@/data/search';

const IS_WEB = Platform.OS === 'web';
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
const TITLE_ROTATE_MS = 2400;

// Pill choreography — deliberately calm (owner v4: slower, readable, premium; never "flashed and
// disappeared"), and since 2026-09-06 long enough that EVERY platform is both revealed and
// highlighted before the loader may leave (owner: "make sure all the platforms show clearly … doing
// it quick will make them lost"). The numbers and the contract live in ONE pure module so a barrier
// can execute them — see lib/searchLoaderTiming.ts and
// scripts/verify-search-loader-shows-every-platform.ts.
const WAVE_RISE = 300;
const WAVE_HOLD = 260;
const WAVE_FALL = 380;

// Fade (+ slight upward motion) a child into place after `delay`. Reduced motion → fade only.
function Appear({
  children, delay = 0, reduced, distance = 5, style,
}: {
  children: React.ReactNode; delay?: number; reduced: boolean; distance?: number; style?: any;
}) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withTiming(1, { duration: reduced ? 150 : 260, easing: EASE_OUT }));
    return () => cancelAnimation(v);
  }, [v, delay, reduced]);
  const a = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: reduced ? [] : [{ translateY: (1 - v.value) * distance }],
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
// warming from muted to primary and a ~2% logo pop — the same vocabulary ui.tsx's own selection glow
// already uses (text-color interpolation + boxShadow/shadow*), just with the fill dropped so nothing
// ever reads as a box. Several pills are lit at once (highlight duration > step). NO checkmarks /
// status icons (owner: never a checklist).
function PlatformPill({
  item, index, total, rtl, reduced, name,
}: {
  item: LoaderPlatform; index: number; total: number; rtl: boolean; reduced: boolean; name: string;
}) {
  const h = useSharedValue(0);
  // LITERAL hex, not the colors.* token (owner theme contract: interpolateColor parses actual color
  // values — colors.* resolves to var(--ez-*) on web, which it cannot parse). Same pattern the
  // pre-existing glow literals below already used; verify-theme-contract.ts fails the build on a
  // colors.* token reaching this call.
  const darkTheme = useResolvedTheme() === 'dark';
  const nameBase: [string, string] = darkTheme ? ['#c9cbc9', '#2b6f4c'] : ['#34403a', '#1d4a37'];
  useEffect(() => {
    if (reduced) { h.value = 0; return; }
    // One full sweep takes LOADER_SWEEP_MS regardless of roster size, so the LAST pill is always
    // reached inside the search floor (agent.tsx SEARCH_MIN_MS ≥ reveal + sweep — executed by
    // scripts/verify-search-loader-shows-every-platform.ts). highlightStepMs also floors the step so
    // a small roster reads as a wave, not a strobe. `rest` keeps each pill's phase stable per loop.
    const step = highlightStepMs(total);
    const lit = WAVE_RISE + WAVE_HOLD + WAVE_FALL;
    const rest = Math.max(260, total * step - lit);
    h.value = withDelay(index * step, withRepeat(withSequence(
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
      transform: reduced ? [] : [{ scale: 1 + g * 0.02 }],
      // Soft green glow — SHADOW ONLY, no fill/border, so the highlight reads as ambient light under
      // the logo+name, never a filled box. Same rgba/blur curve ui.tsx's own selection glow uses.
      ...(IS_WEB
        ? ({ boxShadow: `0px ${4 * g}px ${14 * g}px rgba(20,80,45,${0.16 * g})` } as any)
        : { shadowColor: '#14502d', shadowOpacity: 0.16 * g, shadowRadius: 14 * g, shadowOffset: { width: 0, height: 4 * g }, elevation: 4 * g }),
    };
  });
  const nameGlow = useAnimatedStyle(() => ({
    color: interpolateColor(h.value, [0, 1], nameBase),
  }));
  return (
    <Appear delay={index * (reduced ? 25 : PILL_STAGGER)} reduced={reduced}>
      <Animated.View style={[s.pill, { flexDirection: rtl ? 'row-reverse' : 'row' }, rowGlow]}>
        <Image source={item.logo} style={s.pillLogo} contentFit="contain" />
        <Animated.Text
          style={[s.pillName, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }, nameGlow]}
          numberOfLines={1}
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
  phase, rtl, reduced, exiting, platformCount, scaleStats,
}: {
  phase: 'thinking' | 'searching'; rtl: boolean; reduced: boolean; exiting: boolean;
  // The SAME count the pills on screen show — never an independent fetch that could disagree.
  platformCount: number;
  // null until loader_scale_stats_ar() resolves (or forever, on failure) — the two lines that use
  // it fall back to their original static wording, and the coverage line is simply omitted.
  scaleStats: LoaderScaleStats | null;
}) {
  const { t } = useI18n();
  const [titleIdx, setTitleIdx] = useState(0);
  const titles = useMemo(() => buildSearchLoaderTitles({
    search: t(SEARCH_TITLES[0]),
    checking: scaleStats ? t('Checking more than {count} properties…', { count: grouped(scaleStats.listingCount) }) : t(SEARCH_TITLES[1]),
    matchFilters: t(SEARCH_TITLES[2]),
    reviewing: platformCount > 0 ? t('Reviewing {count} real-estate platforms…', { count: platformCount }) : t(SEARCH_TITLES[3]),
    coverage: scaleStats ? t('Covering more than {cities} cities and {districts} districts…', { cities: grouped(scaleStats.cityCount), districts: grouped(scaleStats.districtCount) }) : null,
    preparing: t(SEARCH_TITLES[4]),
  }), [t, scaleStats, platformCount]);
  useEffect(() => {
    if (phase !== 'searching' || reduced || exiting) return;
    const id = setInterval(() => setTitleIdx((i) => (i + 1) % titles.length), TITLE_ROTATE_MS);
    return () => clearInterval(id);
  }, [phase, reduced, exiting, titles.length]);
  // titles can shrink (e.g. scaleStats arrives, or activeNames narrows the roster) between renders —
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
    transform: reduced ? [] : [{ translateY: (1 - v.value) * 5 }],
  }));
  return (
    <Animated.Text style={[s.title, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }, a]}>
      {label}
    </Animated.Text>
  );
}

export default function SearchLoader({
  phase, query, resultSources, exiting = false,
}: {
  phase: 'thinking' | 'searching';
  query?: SearchQuery | null;
  resultSources?: string[];
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

  // ACTIVE-ONLY roster (owner rule 2026-08-29): only platforms with reachable rows in
  // `search_listings_ar` are advertised, so a scraper that goes cold stops showing without a
  // deploy. `fetchActivePlatformNames()` resolves once and is cached at the module level via the
  // usual React state; if it fails, `activeNames` stays null and pickLoaderPlatforms falls back to
  // the full catalog (safe degradation — see loaderPlatforms.ts). The catalog itself is barrier-
  // pinned equal to production's active set at CI time (verify-loader-platforms-match-active.ts).
  const [activeNames, setActiveNames] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchActivePlatformNames().then((names) => {
      if (!cancelled) setActiveNames(names);
    });
    return () => { cancelled = true; };
  }, []);

  // The "big database" marketing numbers (owner 2026-09-12) — resolved once per mount, same
  // null-on-failure/no-guess contract as activeNames above. See loaderScaleStats.ts.
  const [scaleStats, setScaleStats] = useState<LoaderScaleStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchLoaderScaleStats().then((stats) => {
      if (!cancelled && stats) setScaleStats(stats);
    });
    return () => { cancelled = true; };
  }, []);

  // Roster is computed once per (query, resultSources, activeNames) and FROZEN — `resultSources`
  // arriving later (as the query resolves) only reorders which pills lead; it must never reshuffle
  // or hide pills already on screen. `query` just gates WHEN the strip mounts (a search is actually
  // underway); its contents do not affect WHICH platforms show. If the active-names fetch resolves
  // AFTER the strip already mounted for THIS search, the frozen roster stays — the next search
  // picks up the filtered set. That prevents mid-search jitter.
  const frozenRef = useRef<LoaderPlatform[] | null>(null);
  const platforms = useMemo<LoaderPlatform[]>(() => {
    if (frozenRef.current && frozenRef.current.length) return frozenRef.current;
    const picked = query ? pickLoaderPlatforms(resultSources, offsetRef.current ?? 0, activeNames) : [];
    if (picked.length) frozenRef.current = picked;
    return picked;
  }, [query, resultSources, activeNames]);

  // Soft completion (owner v4): fade the whole block out gently before the results morph in —
  // the loader must never vanish in a single frame.
  const exit = useSharedValue(1);
  useEffect(() => {
    if (exiting) exit.value = withTiming(0, { duration: reduced ? 150 : 420, easing: EASE_OUT });
  }, [exiting, reduced, exit]);
  const exitStyle = useAnimatedStyle(() => ({
    opacity: exit.value,
    transform: reduced ? [] : [{ translateY: (1 - exit.value) * -4 }],
  }));

  return (
    <Animated.View style={[s.wrap, { alignItems: rtl ? 'flex-end' : 'flex-start' }, exitStyle]}>
      {/* Headline: sparkle + rotating phase text (+ soft dots while thinking) */}
      <View style={[s.titleRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Ionicons name="sparkles" size={15} color={colors.primary} />
        <PhaseTitle phase={phase} rtl={rtl} reduced={reduced} exiting={exiting} platformCount={platforms.length} scaleStats={scaleStats} />
        {phase === 'thinking' ? <Dots reduced={reduced} /> : null}
      </View>

      {/* The complete platform roster — logo + Arabic name pills with the traveling highlight, NO
          box (owner 2026-09-12: "remove those boxes... put the name also" — supersedes the same-day
          logo-only mobile compact tile; the name always renders now, on every viewport). */}
      {phase === 'searching' && platforms.length > 0 ? (
        <View style={[s.strip, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
          {platforms.map((p, i) => (
            <PlatformPill key={p.name} item={p} index={i} total={platforms.length} rtl={rtl} reduced={reduced} name={t(p.i18nKey)} />
          ))}
        </View>
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
  strip: { flexWrap: 'wrap', alignSelf: 'stretch', gap: 9, rowGap: 9 },
  pill: { alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 2 },
  pillLogo: { width: 18, height: 18, borderRadius: 4 },
  pillName: { fontSize: 12.5, fontWeight: '600', color: colors.body, maxWidth: 150 },
});
