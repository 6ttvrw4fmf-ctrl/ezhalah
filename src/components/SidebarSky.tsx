import { Image, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemePalette } from '@/lib/appearance';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { skyScene } from '@/theme/skyScene';
import CloudWisp from './CloudWisp';

const EAGLE = require('../../assets/images/eagle-mark.png');
const sidebarDrift = {
  from: { transform: [{ translateX: -skyScene.sidebarDriftPx }] },
  to: { transform: [{ translateX: skyScene.sidebarDriftPx }] },
};
const eagleDrift = {
  from: { transform: [{ translateX: -skyScene.eagleDriftPx }] },
  to: { transform: [{ translateX: skyScene.eagleDriftPx }] },
};
const motion = {
  animationDuration: skyScene.sidebarDriftMs,
  animationIterationCount: 'infinite',
  animationDirection: 'alternate',
  animationTimingFunction: 'ease-in-out',
} as const;

/** Sparse atmosphere behind the sidebar controls, clipped to this column rather than the page. */
export function SidebarClouds() {
  const reduced = useReducedMotion();
  return <View testID="sidebar-clouds" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, styles.clip]}>
    <Animated.View testID="sidebar-cloud-drift" style={[StyleSheet.absoluteFill,
      !reduced && { ...motion, animationName: sidebarDrift }]}>
      <CloudWisp width={280} height={100} opacity={0.38} style={styles.topCloud} />
      <CloudWisp variant={1} width={240} height={110} opacity={0.25} style={styles.middleCloud} />
      <CloudWisp variant={2} width={270} height={120} opacity={0.3} style={styles.bottomCloud} />
    </Animated.View>
  </View>;
}

/** Original eagle artwork, with a small cloud pass below its eye. The adjacent wordmark labels it. */
export function SkyEagleMark() {
  const pal = useThemePalette();
  const reduced = useReducedMotion();
  return <View testID="sidebar-sky-eagle" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.eagleTile, { borderColor: pal.line }]}>
    <LinearGradient colors={[pal.skyTop, pal.skyBottom]} style={StyleSheet.absoluteFill} />
    <Image source={EAGLE} resizeMode="contain" accessible={false} style={styles.eagle} />
    <Animated.View style={[StyleSheet.absoluteFill,
      !reduced && { ...motion, animationName: eagleDrift }]}>
      <CloudWisp width={65} height={24} opacity={0.62} style={styles.eagleCloud} />
      <CloudWisp variant={1} width={42} height={13} opacity={0.32} style={styles.eagleTopCloud} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  topCloud: { top: -18, left: -65 },
  middleCloud: { top: '34%', right: -100 },
  bottomCloud: { bottom: '9%', left: -65 },
  eagleTile: { width: 44, height: 44, flexShrink: 0, borderRadius: 13, borderWidth: 1,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  eagle: { width: 36, height: 35 },
  eagleCloud: { bottom: -3, left: -12 },
  eagleTopCloud: { top: -6, right: -12 },
});
