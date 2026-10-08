import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { PLATFORM_PICKER_PROFILES, homeWebsiteRoster } from '@/data/platformPickerProfiles';
import { hiddenPlatformNames, loadHiddenPlatformNames } from '@/data/loaderActivePlatforms';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

/** The same searchable website catalog as the picker; registry failures never invent a count. */
export default function HomeWebsiteStrip() {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [roster, setRoster] = useState(() => homeWebsiteRoster(hiddenPlatformNames()));
  const [offset, setOffset] = useState(0);
  const motion = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let mounted = true;
    loadHiddenPlatformNames().then(() => {
      if (mounted) setRoster(homeWebsiteRoster(hiddenPlatformNames()));
    });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    motion.setValue(reduced || roster.names.length < 6 ? 1 : 0);
    if (reduced || roster.names.length < 6) return;
    const animation = Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration: 350, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(3200),
      Animated.timing(motion, { toValue: 0, duration: 350, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setOffset(value => (value + 1) % roster.names.length);
    });
    return () => animation.stop();
  }, [offset, reduced, roster.names.length, motion]);
  const visible = Array.from({ length: Math.min(5, roster.names.length) }, (_, index) => roster.names[(offset + index) % roster.names.length]);
  return (
    <View testID="home-website-strip" style={{ width: '100%', maxWidth: 340, alignSelf: 'center', marginTop: 8, marginBottom: 12, alignItems: 'center' }}>
      <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: '100%', flexDirection: 'row', justifyContent: 'space-around', opacity: motion, transform: [{ translateX: motion.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>
        {visible.map(name => {
          const profile = PLATFORM_PICKER_PROFILES[name];
          return <View key={name} style={{ width: 56, height: 32, overflow: 'hidden' }}>
            <Image source={profile.logo} style={{ position: 'absolute', width: profile.layout.width, height: profile.layout.height, left: profile.layout.left, top: profile.layout.top }} contentFit="contain" tintColor={profile.layout.dark ? colors.ink : undefined} accessible={false} />
          </View>;
        })}
      </Animated.View>
      <Text testID="home-website-count" style={{ fontSize: 12, lineHeight: 18, color: colors.muted, marginTop: 6, textAlign: 'center' }}>
        {roster.count === null ? t('Real-estate websites in one search') : t('Search across {count} real-estate websites', { count: roster.count })}
      </Text>
    </View>
  );
}
