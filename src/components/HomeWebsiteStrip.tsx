import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import { useResolvedTheme } from '@/lib/appearance';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { STRIP_SLOT, STRIP_SPEED, stripPhase, useStripNames } from './homeWebsiteStripShared';

/** Two identical tracks make the loop boundary visually seamless. The loop starts at the wall-clock
 *  phase (homeWebsiteStripShared.ts): the first pass runs from there to the end of the cycle, then the
 *  steady loop takes over from 0 — the same pixel the first pass ended on. */
export default function HomeWebsiteStrip() {
  const theme = useResolvedTheme();
  const reduced = useReducedMotion();
  const names = useStripNames();
  const cycleWidth = names.length * STRIP_SLOT;
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const phase = stripPhase(Date.now(), cycleWidth);
    motion.setValue(-phase);
    if (reduced || cycleWidth === 0) return;
    const run = (from: number) => Animated.timing(motion, {
      toValue: -cycleWidth, duration: (cycleWidth - from) / STRIP_SPEED * 1000,
      easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    });
    const animation = Animated.sequence([
      run(phase),
      Animated.loop(Animated.sequence([Animated.timing(motion, { toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false }), run(0)])),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reduced, motion, cycleWidth]);
  return <View testID="home-website-strip" style={{ width: '100%', maxWidth: 560, height: 48, alignSelf: 'center', marginTop: 8, marginBottom: 12, overflow: 'hidden' }}>
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: cycleWidth * 2, flexDirection: 'row', transform: [{ translateX: motion }] }}>
      {[0, 1].map(copy => names.map(name => {
        const profile = PLATFORM_PICKER_PROFILES[name];
        return <View key={`${copy}-${name}`} style={{ width: STRIP_SLOT, height: 48, paddingHorizontal: 6 }}>
          <View style={{ width: 96, height: 48, backgroundColor: 'transparent', overflow: 'hidden' }}>
            <Image source={profile.logo} tintColor={profile.layout.monochrome ? (theme === 'dark' ? '#F3F5F3' : '#253831') : undefined} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" accessible={false} />
          </View>
        </View>;
      }))}
    </Animated.View>
  </View>;
}
