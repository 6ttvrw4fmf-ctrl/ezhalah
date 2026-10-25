import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { takeEagleLightUp } from '@/lib/eagleLightUp';
import { Image as XImage } from 'expo-image';
import Animated from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { SKY_CALM_PROPS } from '@/lib/scrollCalm';
import { skyScene } from '@/theme/skyScene';
import CloudWisp from './CloudWisp';

// The logo is a vector drawing (SVG), never a photo (owner 2026-10-24). Signed-in users see it lit with green string
// lights that twinkle in turns — the animation lives inside logo-cloud-lit.svg («when user logs in signs up it changes»).
// On its own blue sky so the white cloud eagle is clearly visible on the light sidebar (owner 2026-10-24: signed out
// «it just shows this» — the approved share-picture look). Signed in: the same, lit with the twinkling green lights.
const EAGLE = require('../../assets/images/logo-cloud-sky.svg');
const EAGLE_LIT = require('../../assets/images/logo-cloud-lit-sky.svg');
// Played once right after a log-in / sign-up: white → the green lights switch on → glow (lib/eagleLightUp.ts).
const EAGLE_LIGHTUP = require('../../assets/images/logo-cloud-lightup-sky.svg');
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

/** The same soft clouds as the main sky, spread down the sidebar, each drifting on its own slow clock so they
 *  never move in step (owner 2026-10-24). Kept faint enough that chat titles stay easy to read. */
const SIDEBAR_CLOUDS = [
  { variant: 0, width: 300, height: 110, opacity: 0.42, style: { top: -18, left: -70 } },
  { variant: 1, width: 260, height: 110, opacity: 0.3, style: { top: '30%', right: -110 } },
  { variant: 2, width: 290, height: 120, opacity: 0.34, style: { top: '56%', left: -90 } },
  { variant: 3, width: 250, height: 100, opacity: 0.28, style: { bottom: '8%', right: -90 } },
] as const;
const cloudDrift = (i: number) => ({
  animationName: { from: { transform: [{ translateX: -skyScene.sidebarCloudPx[i] }] }, to: { transform: [{ translateX: skyScene.sidebarCloudPx[i] }] } },
  animationDuration: skyScene.sidebarCloudMs[i],
  animationIterationCount: 'infinite',
  animationDirection: 'alternate',
  animationTimingFunction: 'ease-in-out',
} as const);

/** Sparse atmosphere behind the sidebar controls, clipped to this column rather than the page. */
export function SidebarClouds() {
  const reduced = useReducedMotion();
  return <View testID="sidebar-clouds" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, styles.clip]}>
    <View testID="sidebar-cloud-drift" style={StyleSheet.absoluteFill}>
      {SIDEBAR_CLOUDS.map((c, i) => (
        <Animated.View key={i} {...SKY_CALM_PROPS} style={[StyleSheet.absoluteFill, !reduced && cloudDrift(i)]}>
          <CloudWisp variant={c.variant} width={c.width} height={c.height} opacity={c.opacity} style={c.style} />
        </Animated.View>
      ))}
    </View>
  </View>;
}

/** The cloud-eagle logo on the sky tile, with a small cloud pass below its eye. `lit` = signed in: green string
 *  lights twinkle along it. The adjacent wordmark labels it. */
export function SkyEagleMark({ lit = false }: { lit?: boolean }) {
  const reduced = useReducedMotion();
  // Mounted already signed in (the phone's burger menu opening) → take the mark now; signed in while mounted (the
  // laptop's docked sidebar) → take it on the change. Either way this mount keeps playing the light-up.
  const [lightUp, setLightUp] = useState(() => lit && takeEagleLightUp());
  useEffect(() => { if (lit && !lightUp && takeEagleLightUp()) setLightUp(true); }, [lit]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View testID="sidebar-sky-eagle" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={styles.eagleTile}>
    <XImage source={!lit ? EAGLE : lightUp ? EAGLE_LIGHTUP : EAGLE_LIT} contentFit="contain" accessible={false} style={styles.eagle} />
    <Animated.View {...SKY_CALM_PROPS} style={[StyleSheet.absoluteFill,
      !reduced && { ...motion, animationName: eagleDrift }]}>
      <CloudWisp width={65} height={24} opacity={0.62} style={styles.eagleCloud} />
      <CloudWisp variant={1} width={42} height={13} opacity={0.32} style={styles.eagleTopCloud} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // No tile, no frame: the cloud eagle sits straight on the sidebar sky, blended with it (owner 2026-10-24:
  // «I don't want it to look like a pasted photo, blend it with the background»).
  eagleTile: { width: 46, height: 46, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  eagle: { width: 46, height: 46 },
  eagleCloud: { bottom: -3, left: -12 },
  eagleTopCloud: { top: -6, right: -12 },
});
