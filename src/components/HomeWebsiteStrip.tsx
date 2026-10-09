import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Image } from 'expo-image';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { useReducedMotion } from '@/lib/useReducedMotion';

const names = Object.keys(PLATFORM_PICKER_PROFILES);
const cycleWidth = names.length * 108;

/** Two identical tracks make the loop boundary visually seamless. */
export default function HomeWebsiteStrip() {
  const reduced = useReducedMotion();
  const motion = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    motion.setValue(0);
    if (reduced) return;
    const animation = Animated.loop(Animated.timing(motion, {
      toValue: -cycleWidth, duration: cycleWidth / 36 * 1000,
      easing: Easing.linear, useNativeDriver: true, isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [reduced, motion]);
  return <View testID="home-website-strip" style={{ width: '100%', maxWidth: 560, height: 48, alignSelf: 'center', marginTop: 8, marginBottom: 12, overflow: 'hidden' }}>
    <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: cycleWidth * 2, flexDirection: 'row', transform: [{ translateX: motion }] }}>
      {[0, 1].map(copy => names.map(name => {
        const profile = PLATFORM_PICKER_PROFILES[name];
        return <View key={`${copy}-${name}`} style={{ width: 108, height: 48, paddingHorizontal: 6 }}>
          <View style={{ width: 96, height: 48, borderRadius: 6, backgroundColor: profile.layout.dark ? '#263D32' : 'transparent', overflow: 'hidden' }}>
            <Image source={profile.logo} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" accessible={false} />
          </View>
        </View>;
      }))}
    </Animated.View>
  </View>;
}
