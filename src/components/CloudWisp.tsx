import { Image, View, type ViewStyle, type StyleProp } from 'react-native';
import { useResolvedTheme } from '@/lib/appearance';
import { skyScene } from '@/theme/skyScene';

const CLOUD = require('../../assets/images/cloud-wisp.webp');

/** Transparent vapor, never a tile. Decoration is non-interactive and hidden from readers. */
export default function CloudWisp({ variant = 0, width = 82, height = 26, opacity, style }: {
  variant?: number; width?: number; height?: number; opacity?: number; style?: StyleProp<ViewStyle>;
}) {
  const dusk = useResolvedTheme() === 'dark';
  return <View accessible={false} pointerEvents="none"
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[{ position: 'absolute', width: width * [1, 0.85, 1.1, 0.95][variant % 4], height,
      opacity: (opacity ?? skyScene.cloudOpacity) * (dusk ? skyScene.duskCloudOpacity : 1),
      transform: [{ scaleX: variant % 2 ? -1 : 1 }, { rotate: variant % 3 === 1 ? '-5deg' : '0deg' }] }, style]}>
      <Image source={CLOUD} resizeMode="contain" accessible={false} style={{ width: '100%', height: '100%' }} />
    </View>;
}
