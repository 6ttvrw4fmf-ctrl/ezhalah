import { Image, type ImageProps } from 'expo-image';
import { View } from 'react-native';
import { platformLogoBounds, platformLogoMonochrome } from './platform-logo-bounds';
import { PLATFORM_PICKER_PROFILES } from '@/data/platformPickerProfiles';
import { useResolvedTheme } from '@/lib/appearance';

const originalLayouts = new Map(Object.values(PLATFORM_PICKER_PROFILES).map(profile => [profile.logo, profile.layout]));

/** Shared optical sizing and transparent frames; white marks adapt their ink to the theme. */
export function PlatformLogo({ source }: { source: ImageProps['source'] }) {
  const theme = useResolvedTheme();
  const backgroundColor = 'transparent';
  const frameWidth = 96;
  const frameHeight = 48;
  const layout = originalLayouts.get(source as number);
  if (layout) {
    return (
      <View style={{ width: frameWidth, height: frameHeight, flexShrink: 0, overflow: 'hidden', direction: 'ltr', backgroundColor }}>
        <Image source={source} contentFit="contain" tintColor={layout.monochrome ? (theme === 'dark' ? '#F3F5F3' : '#253831') : undefined} style={{ position: 'absolute', width: layout.width, height: layout.height, left: layout.left, top: layout.top }} />
      </View>
    );
  }

  // Legacy white-only marks use theme-aware ink without a backing tile.
  const bounds = platformLogoBounds.get(source);

  if (!bounds) {
    return <Image source={source} contentFit="contain" style={{ width: frameWidth, height: frameHeight, flexShrink: 0 }} />;
  }

  const [imageWidth, imageHeight, left, top, right, bottom] = bounds;
  const artworkWidth = right - left;
  const artworkHeight = bottom - top;
  const scale = Math.min(88 / artworkWidth, 40 / artworkHeight);

  return (
    <View style={{ width: frameWidth, height: frameHeight, flexShrink: 0, overflow: 'hidden', direction: 'ltr', backgroundColor }}>
      <Image
        source={source}
        tintColor={platformLogoMonochrome.has(source) ? (theme === 'dark' ? '#F3F5F3' : '#253831') : undefined}
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
