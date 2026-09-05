import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, withRepeat, withDelay, withSequence, Easing } from 'react-native-reanimated';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { grouped } from '@/data/search';
import { deepSearchLine } from '@/lib/afDeepSearchCopy';
import { colors, font, space } from '@/theme/tokens';

// The Ezhalah DEEP-SEARCH transition (owner redesign 2026-08-31, supersedes the 2026-08-16 «digging»
// card). Shown once, after the Advanced Filter interview finishes, while the final search runs
// behind it. The old white dialog — and its «لقينا N عقار أقرب لطلبك» success beat — are GONE: the
// overlay now speaks the user's OWN selections (deepSearchLine weaves the chosen type + facet labels
// into one Arabic sentence, src/lib/afDeepSearchCopy.ts) and hands off DIRECTLY to the results.
//
// The composition is full-bleed on a near-opaque theme surface (no boxed popup, and nothing behind
// it — platform pills included — can show through): the dynamic sentence, an honest «نراجع N عقار»
// sub-line when the count is known, the user's criteria as small green chips, and the signature —
// a vertical pipeline of miniature listing cards flowing down through a green scanning aperture.
// Cards that pass the gate flash the primary edge and continue; every third card veers aside and
// fades (a non-match leaving the set). The user's fields visibly ARE the checking criteria.
//
// TIMING CONTRACT (unchanged): this component is pure decoration. It never gates the hand-off — the
// orchestrator (agent.tsx) drives dismissal with plain setTimeout latches (never an animation
// callback, per src/lib/afterAnimation.ts's rule), and the loops here simply run until unmounted.
// `to != null` only tells the pipeline to stop spawning (the gate settles); no text changes, no
// count is claimed, no success beat — the parent removes the overlay and the results are already
// cascading underneath. A 15s failsafe in the parent still guarantees the user is never trapped.
//
// Reduced motion: no moving cards — the sentence, sub-line, chips and a static gate only.

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const IS_WEB = Platform.OS === 'web';

// ── The pipeline geometry (transform-only; zero layout shift) ────────────────────────────────────
const STAGE_H = 216;
const GATE_Y = STAGE_H / 2; // gate sits mid-stage; cards travel from -30 → STAGE_H + 30
const CARD_W = 34;
const CARD_H = 26;
const LANES = 5;            // cards in flight per loop
const LANE_MS = 2400;       // one card's full top→bottom journey
const LANE_STAGGER = LANE_MS / LANES;

// One miniature listing card riding the pipeline. Deterministic fate by index: indices 1 and 3 are
// the non-matches — at the gate they veer toward the side and fade; the rest flash the primary edge
// and continue through. withRepeat keeps each lane looping until unmount; `settled` (search done)
// lets the current pass finish then hides further passes via opacity — the drain reads as the set
// being sealed, not a hard stop.
function PipeCard({ index, settled }: { index: number; settled: boolean }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(index * LANE_STAGGER, withRepeat(withTiming(1, { duration: LANE_MS, easing: Easing.linear }), -1, false));
  }, [v, index]);
  const reject = index % LANES === 1 || index % LANES === 3;
  const a = useAnimatedStyle(() => {
    const p = v.value; // 0 → 1 along the journey
    const y = -30 + p * (STAGE_H + 60);
    const pastGate = y > GATE_Y;
    // Non-matches veer sideways after the gate and fade out fast; matches dip slightly inward.
    const veer = reject && pastGate ? (y - GATE_Y) * 1.4 : 0;
    const fade = reject && pastGate ? Math.max(0, 1 - (y - GATE_Y) / 46) : 1;
    // Everyone fades in at the top and (matches) out near the bottom edge.
    const edge = Math.min(p * 6, 1) * Math.min((1 - p) * 6, 1);
    return {
      opacity: (settled && p < 0.08 ? 0 : 1) * 0.9 * fade * edge,
      transform: [{ translateY: y }, { translateX: veer }, { scale: pastGate && !reject ? 0.92 : 1 }],
      borderColor: pastGate && !reject ? colors.primary : colors.tintLine,
    };
  });
  return (
    <Reanimated.View style={[st.pipeCard, a]}>
      <View style={st.pipePhoto} />
      <View style={st.pipeLine} />
      <View style={[st.pipeLine, { width: '52%' }]} />
    </Reanimated.View>
  );
}

export default function MiningTransition({
  from, to, type, labels,
}: {
  from: number | null;
  to: number | null;
  /** The resolved clean type key (SearchQuery.type) — plural-mapped into the sentence. */
  type?: string | null;
  /** The committed facet labels of THIS interview (carry included, deduped by the caller). */
  labels?: string[];
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const settled = to != null;
  const chips = (labels ?? []).filter(Boolean).slice(0, 5);

  // The gate breathes gently while checking, then rests once the search lands.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced || settled) return;
    pulse.value = withRepeat(withSequence(
      withTiming(1, { duration: 900, easing: EASE }),
      withTiming(0, { duration: 900, easing: EASE }),
    ), -1, false);
  }, [pulse, reduced, settled]);
  const gateA = useAnimatedStyle(() => ({
    transform: [{ scale: settled ? 1 : 1 + pulse.value * 0.05 }],
    shadowOpacity: 0.18 + pulse.value * 0.14,
  }));

  return (
    <View style={st.overlay} pointerEvents="auto">
      {/* Near-opaque THEME surface (var-token → correct in dark mode) + a soft blur on web: the
          transition owns the whole screen — no dialog box, and the searching turn underneath
          (platform pills included) is fully covered until the results are ready. */}
      <View style={st.backdrop} />
      <View style={st.column}>
        <Text style={st.headline}>{deepSearchLine(type ?? null, chips)}</Text>
        {from != null ? (
          <Text style={st.subline}>{t('Going through {count} properties to pull out the best fit', { count: grouped(from) })}</Text>
        ) : null}

        {/* The user's criteria — the literal checking rules, visible beside the gate. */}
        {chips.length ? (
          <View style={st.chips}>
            {chips.map((l) => (
              <View key={l} style={st.chip}><Text style={st.chipText} numberOfLines={1}>{l}</Text></View>
            ))}
          </View>
        ) : null}

        {/* The pipeline: cards flow through the gate; rejects veer off, matches continue. */}
        <View style={st.stage}>
          {!reduced ? Array.from({ length: LANES }, (_, i) => <PipeCard key={i} index={i} settled={settled} />) : null}
          <Reanimated.View style={[st.gate, reduced ? null : gateA]} />
          <View style={st.laneLine} />
        </View>
      </View>
    </View>
  );
}

const fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const st = StyleSheet.create({
  overlay: { ...fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.screenSide, zIndex: 300 },
  backdrop: {
    ...fill, backgroundColor: colors.paper, opacity: 0.96,
    ...(IS_WEB ? ({ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' } as any) : null),
  },
  column: { width: '100%', maxWidth: 360, alignItems: 'center' },
  headline: {
    fontFamily: font.family.bold, fontSize: 16.5, lineHeight: 26, color: colors.ink,
    textAlign: 'center', writingDirection: 'rtl' as any,
  },
  subline: {
    marginTop: 8, fontFamily: font.family.regular, fontSize: 13, color: colors.muted,
    textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  chips: {
    flexDirection: 'row-reverse', flexWrap: 'wrap', justifyContent: 'center',
    gap: 7, marginTop: 14, maxWidth: 330,
  },
  chip: {
    backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine,
    borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, maxWidth: 200,
  },
  chipText: { fontFamily: font.family.medium, fontSize: 12, color: colors.dark, textAlign: 'center' },

  stage: { width: 120, height: STAGE_H, marginTop: 18, alignItems: 'center' },
  laneLine: { position: 'absolute', top: 6, bottom: 6, width: 1, backgroundColor: colors.tintLine, opacity: 0.7 },
  gate: {
    position: 'absolute', top: GATE_Y - 24, width: 60, height: 48, borderRadius: 16,
    borderWidth: 2, borderColor: colors.primary, backgroundColor: 'transparent',
    shadowColor: '#14502d', shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
    ...(IS_WEB ? ({ boxShadow: '0 0 18px rgba(20,80,45,0.22)' } as any) : null),
  },
  pipeCard: {
    position: 'absolute', top: 0, width: CARD_W, height: CARD_H, borderRadius: 6,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.tintLine,
    padding: 3, gap: 2,
  },
  pipePhoto: { flex: 1, borderRadius: 3, backgroundColor: colors.tint },
  pipeLine: { height: 2.5, width: '78%', borderRadius: 2, backgroundColor: colors.tintLine },
});
