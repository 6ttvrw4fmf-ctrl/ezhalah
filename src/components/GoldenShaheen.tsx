import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, Image, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import { useReducedMotion } from '@/lib/useReducedMotion';

const SHAHEEN = require('../../assets/models/shaheen.png');
const wink = { '0%, 20%, 40%, 100%': { opacity: 0 }, '27%, 33%': { opacity: 1 } };
const shine = { '0%, 42%, 100%': { opacity: 0 }, '65%': { opacity: 0.85 } };
const motion = { animationDuration: 1600, animationIterationCount: 1, animationTimingFunction: 'ease-in-out' } as const;

/** The approved Shaheen silhouette, gold only when real property cards are on screen. */
export default function GoldenShaheen({ animate = false }: { animate?: boolean }) {
  const reduced = useReducedMotion();
  const id = `shaheen-${useId().replace(/:/g, '')}`;
  const gradient = `${id}-gold`;
  const mask = `${id}-mask`;
  return <View testID="golden-shaheen" pointerEvents="none" accessible={false}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.mark}>
    <Svg width="100%" height="100%" viewBox="0 130 1254 1000">
      <Defs>
        <Mask id={mask} maskType="alpha" style={{ maskType: 'alpha' }} x="0" y="0" width="1254" height="1254" maskUnits="userSpaceOnUse">
          <Image href={SHAHEEN} width="1254" height="1254" />
        </Mask>
        <LinearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0" stopColor="#9C702A" /><Stop offset="0.48" stopColor="#D8B05F" />
          <Stop offset="1" stopColor="#AF7D2C" />
        </LinearGradient>
      </Defs>
      <Rect width="1254" height="1254" fill={`url(#${gradient})`} mask={`url(#${mask})`} />
    </Svg>
    {animate && !reduced && <>
      <Animated.View testID="shaheen-wink" style={[StyleSheet.absoluteFill, { opacity: 0, ...motion, animationName: wink }]}>
        <Svg width="100%" height="100%" viewBox="0 130 1254 1000">
          {/* A brief eyelid closes the original eye; the head and wing never deform. */}
          <Path d="M806 346 Q913 315 1034 418 Q921 447 813 407 Z" fill="#CAA052" />
        </Svg>
      </Animated.View>
      <Animated.View testID="shaheen-glint" style={[StyleSheet.absoluteFill, { opacity: 0, ...motion, animationName: shine }]}>
        <Svg width="100%" height="100%" viewBox="0 130 1254 1000">
          <Defs>
            <Mask id={`${id}-shine-mask`} maskType="alpha" style={{ maskType: 'alpha' }} x="0" y="0" width="1254" height="1254" maskUnits="userSpaceOnUse">
              <Image href={SHAHEEN} width="1254" height="1254" />
            </Mask>
            <LinearGradient id={`${id}-shine`} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0.38" stopColor="#FFF5D3" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#FFF5D3" stopOpacity="1" />
              <Stop offset="0.62" stopColor="#FFF5D3" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect width="1254" height="1254" fill={`url(#${id}-shine)`} mask={`url(#${id}-shine-mask)`} />
        </Svg>
      </Animated.View>
    </>}
  </View>;
}

const styles = StyleSheet.create({ mark: { width: 26, height: 26, flexShrink: 0 } });
