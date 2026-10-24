import { useEffect, useState } from 'react';
import { Animated as RNAnimated, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useResolvedTheme, useThemePalette } from '@/lib/appearance';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { skyScene } from '@/theme/skyScene';
import CloudWisp from './CloudWisp';

const HERO = require('../../assets/images/desert-day.webp');
const HERO_DARK = require('../../assets/images/desert-dusk.webp');

/** One continuous sky. Only the separate foreground leaves when a search begins. */
export default function HeroBackground({ landscape = false, clouds = true, imageOpacity = 1 }: {
  landscape?: boolean;
  clouds?: boolean;
  imageOpacity?: number | RNAnimated.AnimatedInterpolation<number> | RNAnimated.Value;
}) {
  const theme = useResolvedTheme();
  const pal = useThemePalette();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const [sceneWidth, setSceneWidth] = useState(width);
  const ground = useSharedValue(landscape ? 1 : 0);
  useEffect(() => {
    ground.value = withTiming(landscape ? 1 : 0, { duration: reduced ? 0 : skyScene.fadeMs });
  }, [ground, landscape, reduced]);
  const fade = useAnimatedStyle(() => ({ opacity: ground.value }));
  return (
    <View onLayout={(event) => setSceneWidth(event.nativeEvent.layout.width)} testID="sky-backdrop" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <LinearGradient colors={[pal.skyTop, pal.skyBottom]} style={StyleSheet.absoluteFill} />
      {clouds && <>
      <CloudWisp variant={0} width={Math.min(sceneWidth * 0.7, 760)} height={180} opacity={0.48} style={{ top: '5%', left: '-16%' }} />
      <CloudWisp variant={1} width={Math.min(sceneWidth * 0.6, 620)} height={150} opacity={0.4} style={{ top: '20%', right: '-15%' }} />
      <CloudWisp variant={2} width={Math.min(sceneWidth * 0.62, 670)} height={160} opacity={0.3} style={{ top: '55%', left: '-24%' }} />
      <CloudWisp variant={3} width={Math.min(sceneWidth * 0.5, 540)} height={130} opacity={0.32} style={{ top: '72%', right: '-18%' }} />
      </>}
      <Animated.View testID="desert-foreground" style={[StyleSheet.absoluteFill, fade]}>
        <RNAnimated.View style={[StyleSheet.absoluteFill, { opacity: imageOpacity }]}>
          <Image source={theme === 'dark' ? HERO_DARK : HERO} resizeMode="stretch" accessible={false}
            style={{ position: 'absolute', bottom: 0, width: '100%', height: sceneWidth / 3 }} />
        </RNAnimated.View>
      </Animated.View>
    </View>
  );
}
