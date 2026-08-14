import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, withRepeat, withDelay, Easing } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { grouped } from '@/data/search';
import { colors, radius, space, font, cardShadow } from '@/theme/tokens';

// The Ezhalah «digging through the market» signature transition (owner 2026-08-16) — shown once,
// after the Advanced Filter interview finishes, while the final search runs behind it. The feeling:
// Ezhalah is sifting many listings down to the few that fit — small card-like shapes drift inward
// toward a centre point and fade as they arrive, calm and restrained, no spinner, no bounce.
//
// TIMING CONTRACT: this component is pure decoration. It never gates the hand-off — the orchestrator
// (agent.tsx) drives dismissal with plain setTimeout latches (never an animation callback, per
// src/lib/afterAnimation.ts's rule), and the animation simply loops until unmounted. `done` flips the
// copy to the found-count beat; the parent removes the overlay shortly after. If the search resolves
// instantly the parent still holds ~1.4s so the beat reads as intentional, and if the search is slow
// the loop keeps playing — the user is never stared at by a frozen screen.
//
// Reduced motion: no drifting shapes, static copy only.

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

// One drifting fragment: starts at (x, y) offset from centre, repeatedly glides to the centre while
// fading out. Staggered delays keep the field feeling organic rather than mechanical.
function Fragment({ x, y, delay, size }: { x: number; y: number; delay: number; size: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1600, easing: EASE }), -1, false));
  }, [v, delay]);
  const a = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - v.value) + 0.08,
    transform: [
      { translateX: x * (1 - v.value) },
      { translateY: y * (1 - v.value) },
      { scale: 1 - v.value * 0.45 },
    ],
  }));
  return <Reanimated.View style={[st.frag, { width: size, height: size * 0.72 }, a]} />;
}

export default function MiningTransition({ from, to }: { from: number | null; to: number | null }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const done = to != null;

  // The centre "core" breathes gently while searching, then settles when the count lands.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: EASE }), -1, true);
  }, [pulse, reduced]);
  const coreA = useAnimatedStyle(() => ({ transform: [{ scale: done ? 1 : 1 + pulse.value * 0.06 }] }));

  // Copy swap: fade the searching copy out / the found copy in. Timing-only, short.
  const swap = useSharedValue(0);
  useEffect(() => {
    swap.value = withTiming(done ? 1 : 0, { duration: reduced ? 0 : 280, easing: EASE });
  }, [done, swap, reduced]);
  const searchTxA = useAnimatedStyle(() => ({ opacity: 1 - swap.value }));
  const foundTxA = useAnimatedStyle(() => ({ opacity: swap.value, transform: [{ translateY: (1 - swap.value) * 6 }] }));

  return (
    <View style={st.overlay} pointerEvents="auto">
      <View style={st.backdrop} />
      <View style={st.card}>
        <View style={st.stage}>
          {!reduced && !done ? (
            <>
              <Fragment x={-92} y={-38} delay={0} size={34} />
              <Fragment x={88} y={-52} delay={260} size={28} />
              <Fragment x={-70} y={54} delay={520} size={26} />
              <Fragment x={96} y={44} delay={780} size={32} />
              <Fragment x={-14} y={-72} delay={1040} size={24} />
              <Fragment x={26} y={70} delay={1300} size={30} />
            </>
          ) : null}
          <Reanimated.View style={[st.core, coreA]}>
            <Ionicons name={done ? 'checkmark' : 'search'} size={22} color={colors.surface} />
          </Reanimated.View>
        </View>
        <View style={st.copyBlock}>
          <Reanimated.View style={[st.copyLayer, searchTxA]} pointerEvents="none">
            <Text style={st.line1}>{t('Finding the closest match for you')}</Text>
            {from != null ? (
              <Text style={st.line2}>{t('Going through {count} properties to pull out the best fit', { count: grouped(from) })}</Text>
            ) : null}
          </Reanimated.View>
          <Reanimated.View style={[st.copyLayer, st.copyTop, foundTxA]} pointerEvents="none">
            {to != null ? (
              <Text style={st.line1}>{t('We found {count} properties closest to your request', { count: grouped(to) })}</Text>
            ) : null}
          </Reanimated.View>
        </View>
      </View>
    </View>
  );
}

const fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const st = StyleSheet.create({
  overlay: { ...fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.screenSide, zIndex: 300 },
  backdrop: { ...fill, backgroundColor: colors.scrim },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: colors.paper, borderRadius: radius.sheet,
    paddingVertical: 28, paddingHorizontal: space.card, alignItems: 'center',
    borderLeftWidth: 6, borderLeftColor: colors.dark, ...cardShadow,
  },
  stage: { width: 220, height: 150, alignItems: 'center', justifyContent: 'center' },
  frag: { position: 'absolute', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.primary, borderRadius: 6 },
  core: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  copyBlock: { marginTop: 14, minHeight: 58, alignSelf: 'stretch', justifyContent: 'center' },
  copyLayer: { alignItems: 'center', gap: 6 },
  copyTop: { ...fill, justifyContent: 'center' },
  line1: { fontFamily: font.family.bold, fontSize: 16, color: colors.ink, textAlign: 'center' },
  line2: { fontFamily: font.family.regular, fontSize: 13, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
