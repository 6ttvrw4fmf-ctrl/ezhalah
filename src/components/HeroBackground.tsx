import { Animated, ImageResizeMode, StyleSheet, View } from 'react-native';
import { useResolvedTheme, useThemePalette } from '@/lib/appearance';
import { alpha0 } from '@/theme/palette';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '@/theme/tokens';

// The hand-drawn Saudi skyline + falcon sketch, used as a soft full-bleed backdrop behind the home
// filter, the AI Agent chat, and (faintly) the sidebar. It's a light pencil illustration, so even at
// moderate opacity the foreground UI stays readable; a `scrim` (flat paper wash) and a bottom
// gradient fade keep text crisp where content is dense.
const HERO = require('../../assets/images/hero-bg.png');
// Pre-rendered dark variant (chalk-on-night: the same drawing inverted and blended onto the dark
// paper — generated offline, NOT a CSS filter, so it renders identically everywhere).
const HERO_DARK = require('../../assets/images/hero-bg-dark.png');

export default function HeroBackground({
  imageOpacity = 0.55,
  scrim = 0,
  // Where the bottom fade-to-paper begins / completes (fractions of height). Lower = more sketch.
  fadeStart = 0.12,
  fadeEnd = 0.82,
  // 'contain' shows the WHOLE sketch (used on phones so every landmark is visible, letterboxed onto
  // the paper); 'cover' fills the frame (used on wide web where the portrait image can't fit fully).
  resizeMode = 'cover',
}: {
  // Accepts a plain number OR an Animated value/interpolation so callers can fade the backdrop
  // (e.g. the home screen lightens it while the user is typing a search).
  imageOpacity?: number | Animated.AnimatedInterpolation<number> | Animated.Value;
  scrim?: number;
  fadeStart?: number;
  fadeEnd?: number;
  resizeMode?: ImageResizeMode;
}) {
  // Dark theme: the pencil sketch sinks into the night — much fainter, and the bottom fade melts
  // into the DARK paper. Gradient colors are parsed (expo-linear-gradient), so literals via the
  // resolved palette, never the var() tokens.
  const theme = useResolvedTheme();
  const pal = useThemePalette();
  const artOpacity =
    theme === 'dark'
      ? typeof imageOpacity === 'number'
        ? imageOpacity * 0.35
        : Animated.multiply(imageOpacity as Animated.Value, 1.4)
      : imageOpacity;
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      {/* Explicit 100%×100% (not just absoluteFill insets) so react-native-web gives the image a
          concrete box to size against; without it RNW lays the image out at its intrinsic pixel
          width, which overflows the screen and blows the page layout up. `overflow:hidden` clips it. */}
      <Animated.Image
        source={theme === 'dark' ? HERO_DARK : HERO}
        style={{ width: '100%', height: '100%', opacity: artOpacity as any }}
        resizeMode={resizeMode}
      />
      {scrim > 0 && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper, opacity: scrim }]} />
      )}
      <LinearGradient
        colors={[alpha0(pal.paper), pal.paper]}
        locations={[fadeStart, fadeEnd]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
