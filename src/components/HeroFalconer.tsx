import { StyleSheet, View } from 'react-native';
import { Image as XImage } from 'expo-image';
import Animated from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { SKY_CALM_PROPS } from '@/lib/scrollCalm';
import CloudWisp from './CloudWisp';

const FALCONER = require('../../assets/icons/insight-falconer-original.png');

// The falconer beside the home title (owner 2026-10-26): standing in the sky, partly covered by soft clouds that
// drift slowly across him («cover him with clouds a bit … let the clouds move»). `flip` mirrors only the drawing,
// so he points back at the title in Arabic; the clouds keep their own shapes. Reduced motion: the clouds stay still.
const DRIFT_PX = 7;
const drift = (ms: number, px: number) => ({
  animationName: { from: { transform: [{ translateX: -px }] }, to: { transform: [{ translateX: px }] } },
  animationDuration: ms,
  animationIterationCount: 'infinite',
  animationDirection: 'alternate',
  animationTimingFunction: 'ease-in-out',
} as const);

export default function HeroFalconer({ size, flip }: { size: { width: number; height: number }; flip: boolean }) {
  const reduced = useReducedMotion();
  const { width: w, height: h } = size;
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: w, height: h }}>
      <CloudWisp variant={0} width={w * 1.35} height={h * 0.3} opacity={0.5} style={{ bottom: -h * 0.07, left: -w * 0.27 }} />
      <XImage source={FALCONER} contentFit="contain" accessible={false} style={[StyleSheet.absoluteFill, flip && s.flip]} />
      {/* In FRONT of him: a low bank over his chest and a thin wisp across his shoulder, each on its own slow clock. */}
      <Animated.View testID="hero-falconer-clouds" {...SKY_CALM_PROPS} style={[StyleSheet.absoluteFill, !reduced && drift(5200, DRIFT_PX)]}>
        <CloudWisp variant={2} width={w * 1.25} height={h * 0.36} opacity={0.82} style={{ bottom: h * 0.02, left: -w * 0.15 }} />
      </Animated.View>
      <Animated.View {...SKY_CALM_PROPS} style={[StyleSheet.absoluteFill, !reduced && drift(7400, DRIFT_PX + 3)]}>
        <CloudWisp variant={1} width={w * 0.95} height={h * 0.22} opacity={0.6} style={{ top: h * 0.38, right: -w * 0.3 }} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({ flip: { transform: [{ scaleX: -1 }] } });
