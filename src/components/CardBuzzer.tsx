import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { useReducedMotion } from '@/lib/useReducedMotion';

const IS_WEB = Platform.OS === 'web';

// THE GOLDEN BUZZER (owner 2026-10-11, extended to EVERY card 2026-10-17: «whenever a user clicks on a
// listing I want this party confetti … on everything», then «your job is doing it for the 76 sites»):
// pressing the photo, body or gold «اضغط هنا» button of a card whose listing opens INSIDE Ezhalah —
// laptop roomy, laptop tight, phone alike — flashes the whole card gold, like a talent-show buzzer,
// and throws a short burst of confetti (the screen-level party in ConfettiOverlay plays with it). It is
// DECORATION ONLY — the press handler opens the ad first and bumps `burst` second, so the ad opens
// even if this layer never paints (backgrounded tab, reduced motion, a throw here).
//
// One layer per card, mounted only after the first press: a results grid of hundreds of cards pays
// nothing until somebody presses one. Reduced motion → nothing is drawn at all.
const PARTICLES = 34;
const BURST_MS = 1350;
const FLASH_MS = 900;

type Bit = { dx: number; dy: number; rot: number; w: number; h: number; color: string; round: boolean };

// A fixed spread (computed from the index, nothing drawn at random): the same burst every press.
export function makeBits(): Bit[] {
  const palette = [colors.goldLight, colors.goldDeep, colors.primary, colors.goldLightHover, colors.onFill, colors.selFill];
  return Array.from({ length: PARTICLES }, (_, i) => {
    const a = (i / PARTICLES) * Math.PI * 2 + (i % 3) * 0.21;
    const v = 120 + ((i * 53) % 150);
    return {
      dx: Math.cos(a) * v,
      dy: Math.sin(a) * v - 70,
      rot: ((i * 97) % 720) - 360,
      w: 6 + (i % 3) * 2,
      h: 9 + (i % 4) * 2,
      color: palette[i % palette.length],
      round: i % 5 === 0,
    };
  });
}

export function BuzzLayer({ burst }: { burst: number }) {
  const reduced = useReducedMotion();
  const flash = useRef(new Animated.Value(0)).current;
  const t = useRef(new Animated.Value(0)).current;
  const [live, setLive] = useState(false);
  const bits = useMemo(makeBits, []);

  useEffect(() => {
    if (burst === 0 || reduced) return;
    setLive(true);
    flash.setValue(0);
    t.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: !IS_WEB }),
        Animated.timing(flash, { toValue: 0.18, duration: 180, useNativeDriver: !IS_WEB }),
        Animated.timing(flash, { toValue: 0.75, duration: 90, useNativeDriver: !IS_WEB }),
        Animated.timing(flash, { toValue: 0, duration: FLASH_MS - 360, useNativeDriver: !IS_WEB }),
      ]),
      Animated.timing(t, { toValue: 1, duration: BURST_MS, easing: Easing.out(Easing.cubic), useNativeDriver: !IS_WEB }),
    ]).start();
    // The layer is removed by a timer, never by an animation callback (a frozen rAF must not strand it).
    const id = setTimeout(() => setLive(false), BURST_MS + 150);
    return () => clearTimeout(id);
  }, [burst, reduced, flash, t]);

  if (!live || reduced) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="card-buzz-layer">
      <Animated.View style={[StyleSheet.absoluteFill, s.flash, { opacity: flash }]} />
      <View style={s.origin}>
        {bits.map((b, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: b.w,
              height: b.h,
              borderRadius: b.round ? b.w : 2,
              backgroundColor: b.color,
              opacity: t.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx] }) },
                // gravity: the bit rises with its throw, then falls away
                { translateY: t.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, b.dy * 0.7, b.dy + 190] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.rot}deg`] }) },
              ],
            }}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flash: { backgroundColor: colors.goldLight },
  // The burst erupts from the middle of the card.
  origin: { position: 'absolute', left: '50%', top: '46%', width: 0, height: 0 },
});
