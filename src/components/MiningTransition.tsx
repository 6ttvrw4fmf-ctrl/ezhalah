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
// RESTORED VERBATIM 2026-09-06 (owner, on seeing the replacement live: "remove this design … keep it
// how it was"). The 2026-08-31 redesign that briefly replaced it — a full-bleed opaque surface with a
// dynamic «إزهله يدقّق في …» sentence and a card-pipeline gate (PR #1440) — is reverted, and
// src/lib/afDeepSearchCopy.ts went with it. Two consequences worth stating, because a later reader
// will find them in the barriers:
//   • The translucent scrim is back ON PURPOSE. The searching turn behind the card — the platform
//     roster included — reads through again, which is what the owner asked for in the same breath
//     ("make sure all the platforms show clearly"). The redesign's opaque backdrop existed to hide
//     exactly that, and hiding it is no longer wanted.
//   • The «لقينا N عقار» completion beat is GONE (owner 2026-09-20, see the note above the component).
//     This card now only ever says it is searching. It still cannot compute a total of its own —
//     `from` is handed in by agent.tsx and is the only number it may state — which is the guarantee
//     scripts/verify-mining-total-honesty.ts actually protects, and that is unchanged.
//
// TIMING CONTRACT: this component is pure decoration. It never gates the hand-off — the orchestrator
// (agent.tsx) drives dismissal with plain setTimeout latches (never an animation callback, per
// src/lib/afterAnimation.ts's rule), and the animation simply loops until unmounted. The parent
// removes the overlay the moment the results are ready. If the search resolves instantly the parent
// still holds ~1.4s so the card cannot flash up and vanish, and if the search is slow the loop keeps
// playing — the user is never stared at by a frozen screen.
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

// NO COMPLETION STATE AT ALL (owner 2026-09-20: "this green check needs to always be gone … it was
// a mistake"). The card used to take a `to` count, flip a `done` flag, swap the magnifier for a
// checkmark and hold on «لقينا N عقار أقرب لطلبك». The owner removed the beat, saw it again, and
// asked for it to be impossible rather than merely unreachable — so the whole branch is deleted, not
// just its trigger. There is no `to` prop, no `done`, no checkmark and no found-copy left to reach:
// re-adding the beat now means re-writing it, which is a review, not an accident.
export default function MiningTransition({ from }: { from: number | null }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();

  // The centre "core" breathes gently for as long as the card is up.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: EASE }), -1, true);
  }, [pulse, reduced]);
  const coreA = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.06 }] }));

  return (
    <View style={st.overlay} pointerEvents="auto">
      <View style={st.backdrop} />
      <View style={st.card}>
        <View style={st.stage}>
          {!reduced ? (
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
            <Ionicons name="search" size={22} color={colors.surface} />
          </Reanimated.View>
        </View>
        <View style={st.copyBlock}>
          <View style={st.copyLayer} pointerEvents="none">
            <Text style={st.line1}>{t('Finding the closest match for you')}</Text>
            {from != null ? (
              <Text style={st.line2}>{t('Going through {count} properties to pull out the best fit', { count: grouped(from) })}</Text>
            ) : null}
          </View>
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
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.selFill,
    alignItems: 'center', justifyContent: 'center',
  },
  copyBlock: { marginTop: 14, minHeight: 58, alignSelf: 'stretch', justifyContent: 'center' },
  copyLayer: { alignItems: 'center', gap: 6 },
  copyTop: { ...fill, justifyContent: 'center' },
  line1: { fontFamily: font.family.bold, fontSize: 16, color: colors.ink, textAlign: 'center' },
  line2: { fontFamily: font.family.regular, fontSize: 13, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
