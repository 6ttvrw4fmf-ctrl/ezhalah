import { Image, type ImageProps } from 'expo-image';
import { View, useWindowDimensions } from 'react-native';
import { platformLogoBounds, platformLogoContrast } from './platform-logo-bounds';
import { useResolvedTheme } from '@/lib/appearance';

/** The same transparent slot and optical sizing on every platform surface. */
export function PlatformLogo({ source }: { source: ImageProps['source'] }) {
  const { width } = useWindowDimensions();
  const theme = useResolvedTheme();
  const themedSource = platformLogoContrast.get(source)?.[theme] ?? source;
  const unit = width >= 720 ? 32 : 24;
  const frameWidth = unit * 3;
  const frameHeight = unit * 1.5;
  const bounds = platformLogoBounds.get(source);

  if (!bounds) {
    return <Image source={themedSource} contentFit="contain" style={{ width: frameWidth, height: frameHeight, flexShrink: 0 }} />;
  }

  const [imageWidth, imageHeight, left, top, right, bottom] = bounds;
  const artworkWidth = right - left;
  const artworkHeight = bottom - top;
  // Equal visible bounding-box area gives wordmarks more width without distorting
  // their lettering. Bound tall/wide extremes inside the same transparent slot.
  const scale = Math.min(
    unit / Math.sqrt(artworkWidth * artworkHeight),
    (frameWidth - 4) / artworkWidth,
    (frameHeight - 4) / artworkHeight,
  );

  return (
    <View style={{ width: frameWidth, height: frameHeight, flexShrink: 0, overflow: 'hidden', direction: 'ltr' }}>
      <Image
        source={themedSource}
        contentFit="contain"
        style={{
          position: 'absolute',
          width: imageWidth * scale,
          height: imageHeight * scale,
          left: (frameWidth - artworkWidth * scale) / 2 - left * scale,
          top: (frameHeight - artworkHeight * scale) / 2 - top * scale,
        }}
      />
    </View>
  );
}
