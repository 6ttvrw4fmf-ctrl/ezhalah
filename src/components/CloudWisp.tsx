import { Image, View, type ViewStyle, type StyleProp } from 'react-native';
import { useResolvedTheme } from '@/lib/appearance';
import { skyScene } from '@/theme/skyScene';
import Animated from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/useReducedMotion';

const CLOUD = require('../../assets/images/cloud-wisp.webp');
const CLOUD_DRIFT = { from: { transform: [{ translateX: -12 }] }, to: { transform: [{ translateX: 12 }] } };

/** Transparent vapor, never a tile. Decoration is non-interactive and hidden from readers. */
export default function CloudWisp({ variant = 0, width = 82, height = 26, opacity, style, drift = false }: {
  variant?: number; width?: number; height?: number; opacity?: number; style?: StyleProp<ViewStyle>; drift?: boolean;
}) {
  const dusk = useResolvedTheme() === 'dark';
  const reduced = useReducedMotion();
  return <View accessible={false} pointerEvents="none"
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ position: 'absolute', width: width * [1, 0.85, 1.1, 0.95][variant % 4], height,
      opacity: (opacity ?? skyScene.cloudOpacity) * (dusk ? skyScene.duskCloudOpacity : 1),
      transform: [{ scaleX: variant % 2 ? -1 : 1 }, { rotate: variant % 3 === 1 ? '-5deg' : '0deg' }] }, style]}>
      <Animated.View testID={drift ? 'cloud-wisp-drift' : undefined} style={[{ width: '100%', height: '100%' }, drift && !reduced && {
        animationName: CLOUD_DRIFT,
        animationDuration: skyScene.sidebarDriftMs + variant * 2000,
        animationIterationCount: 'infinite', animationDirection: variant % 2 ? 'alternate-reverse' : 'alternate',
        animationTimingFunction: 'ease-in-out',
      }]}>
        <Image source={CLOUD} resizeMode="contain" accessible={false} style={{ width: '100%', height: '100%' }} />
      </Animated.View>
    </View>;
}
