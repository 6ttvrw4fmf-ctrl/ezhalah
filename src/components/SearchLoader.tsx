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
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { bumpRotation, currentRotation, pickLoaderPlatforms, type LoaderPlatform } from '@/data/loaderPlatforms';
import type { SearchQuery } from '@/data/search';

const IS_WEB = Platform.OS === 'web';
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

// Rotating searching headlines (owner-approved copy, v4 set — short, alive, smooth cross-fades).
const SEARCH_TITLES = [
  'Ezhalah is searching the platforms…',
  'Checking the matching properties…',
  'Matching the filters…',
  'Reviewing sites and prices…',
  'Sorting the best results…',
] as const;
const TITLE_ROTATE_MS = 2400;

// Pill choreography (ms) — deliberately calm (owner v4: slower, readable, premium; never "flashed
// and disappeared"). 60ms stagger (owner range 60–100) lands the full 32-pill roster at ~2.12s
// (31×60 + 260 fade), which agent.tsx's SEARCH_MIN_MS=2200 floor fully covers — the complete roster
// is ALWAYS on screen before the exit fade can start (review finding: 75ms overran the floor).
const PILL_STAGGER = 60;
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

// A platform pill with the traveling-highlight treatment: when the calm wave reaches it, the pill's
// tint brightens, the border warms, a SOFT GLOW blooms underneath and it lifts ~2% — "this platform
// is being checked right now" — then eases back as the wave moves on. Several pills are lit at once
// (highlight duration > step). NO checkmarks / status icons (owner: never a checklist).
function PlatformPill({
  item, index, total, rtl, reduced, name,
}: {
  item: LoaderPlatform; index: number; total: number; rtl: boolean; reduced: boolean; name: string;
}) {
  const h = useSharedValue(0);
  useEffect(() => {
    if (reduced) { h.value = 0; return; }
    // Full sweep ≈3.5–4.5s regardless of roster size; rest keeps each pill's phase stable per loop.
    const step = Math.max(110, Math.min(220, Math.round(3600 / Math.max(1, total))));
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
  const a = useAnimatedStyle(() => {
    const g = h.value;
    return {
      backgroundColor: interpolateColor(g, [0, 1], ['#f4f9f6', '#e2f1e7']),
      borderColor: interpolateColor(g, [0, 1], ['#e3ece6', '#b7dbc4']),
      transform: reduced ? [] : [{ scale: 1 + g * 0.02 }],
      // Soft green glow under the active pill — premium emphasis, not a flash. Same pattern as the
      // app's selection glow (ui.tsx): boxShadow string on web; shadow* + elevation on native
      // (elevation is required for Android — shadow* alone is iOS-only; review finding).
      ...(IS_WEB
        ? ({ boxShadow: `0px ${4 * g}px ${14 * g}px rgba(20,80,45,${0.16 * g})` } as any)
        : { shadowColor: '#14502d', shadowOpacity: 0.16 * g, shadowRadius: 14 * g, shadowOffset: { width: 0, height: 4 * g }, elevation: 4 * g }),
    };
  });
  return (
    <Appear delay={index * (reduced ? 25 : PILL_STAGGER)} reduced={reduced}>
      <Animated.View style={[s.pill, { flexDirection: rtl ? 'row-reverse' : 'row' }, a]}>
        <Image source={item.logo} style={s.pillLogo} contentFit="contain" />
        <Text style={[s.pillName, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }]} numberOfLines={1}>
          {name}
        </Text>
      </Animated.View>
    </Appear>
  );
}

// The headline — minimal, ROTATING while searching (no sentence sits for seconds), with a smooth
// cross-fade on every change and a continuous gentle shimmer-pulse so the text always reads as
// actively working. Rotation freezes while exiting. Reduced-motion: static first title, plain fades.
function PhaseTitle({ phase, rtl, reduced, exiting }: { phase: 'thinking' | 'searching'; rtl: boolean; reduced: boolean; exiting: boolean }) {
  const { t } = useI18n();
  const [titleIdx, setTitleIdx] = useState(0);
  useEffect(() => {
    if (phase !== 'searching' || reduced || exiting) return;
    const id = setInterval(() => setTitleIdx((i) => (i + 1) % SEARCH_TITLES.length), TITLE_ROTATE_MS);
    return () => clearInterval(id);
  }, [phase, reduced, exiting]);
  const label = phase === 'thinking' ? t('Ezhalah is thinking…') : t(SEARCH_TITLES[titleIdx]);

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

  // The COMPLETE eligible roster, computed once from the query and FROZEN — `resultSources` arriving
  // later (as the query resolves) must never reshuffle pills already on screen.
  const frozenRef = useRef<LoaderPlatform[] | null>(null);
  const platforms = useMemo<LoaderPlatform[]>(() => {
    if (frozenRef.current && frozenRef.current.length) return frozenRef.current;
    const picked = query
      ? pickLoaderPlatforms(
          { deal: query.deal, bothDeals: query.bothDeals, category: query.category, sources: query.sources, resultSources },
          offsetRef.current ?? 0,
        )
      : [];
    if (picked.length) frozenRef.current = picked;
    return picked;
  }, [query, resultSources]);

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
        <PhaseTitle phase={phase} rtl={rtl} reduced={reduced} exiting={exiting} />
        {phase === 'thinking' ? <Dots reduced={reduced} /> : null}
      </View>

      {/* The complete platform roster — logo + Arabic name pills with the traveling highlight */}
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

  // Premium, consistent pills: identical height/logo sizes, soft near-neutral fill, hairline-soft
  // border, generous spacing. backgroundColor/borderColor/glow are ANIMATED per-pill (highlight wave)
  // from these base values — transforms only, so the wave causes ZERO layout shift.
  strip: { flexWrap: 'wrap', alignSelf: 'stretch', gap: 9, rowGap: 9 },
  pill: {
    alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 11, borderRadius: 14,
    backgroundColor: '#f4f9f6', borderWidth: 1, borderColor: '#e3ece6',
  },
  pillLogo: { width: 18, height: 18, borderRadius: 4, backgroundColor: colors.surface },
  pillName: { fontSize: 12.5, fontWeight: '600', color: colors.body, maxWidth: 150 },
});
