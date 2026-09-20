// Shared premium reveal primitives for the results list (owner 2026-07-09: «عرض المزيد» must feel
// like a flagship AI product — cards fade in with a slight rise as the drip mounts them one-by-one;
// the button melts into calm pulsing dots while Ezhalah prepares the next batch). Motion is
// MOUNT-ONLY: existing cards never re-animate, transforms only → zero layout shift, no bounce.
// Reduced motion → fade only / static dots.
import { useEffect } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useThemePalette } from '@/lib/appearance';

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

// Soft entry for a newly-mounted property card: fade + ~10px rise over 260ms. The reveal drip mounts
// cards ~55ms apart, so the cadence itself provides the stagger the owner asked for (40–80ms).
export function CardIn({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withTiming(1, { duration: reduced ? 150 : 260, easing: EASE_OUT });
    return () => cancelAnimation(v);
  }, [v, reduced]);
  const a = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: reduced ? [] : [{ translateY: (1 - v.value) * 10 }],
  }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

// Three calm pulsing dots — the «عرض المزيد» button's active state (replaces a static text swap).
// Same breathe pattern as the search loader's thinking dots; premium, not a generic spinner.
export function LoadingDots({ color = '#fff' }: { color?: string }) {
  const reduced = useReducedMotion();
  return (
    <View style={s.row}>
      {[0, 1, 2].map((i) => <LoadDot key={i} index={i} color={color} reduced={reduced} />)}
    </View>
  );
}

function LoadDot({ index, color, reduced }: { index: number; color: string; reduced: boolean }) {
  const v = useSharedValue(0.35);
  useEffect(() => {
    if (reduced) { v.value = 0.7; return; }
    v.value = withDelay(index * 150, withRepeat(withSequence(
      withTiming(1, { duration: 320, easing: EASE_OUT }),
      withTiming(0.35, { duration: 320, easing: EASE_OUT }),
    ), -1, false));
    return () => cancelAnimation(v);
  }, [v, index, reduced]);
  const a = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[s.dot, { backgroundColor: color }, a]} />;
}

// Ambient "look at me" pulse for the encouraged-action gold CTA (owner 2026-09-20: «خلّنا نحدد
// الطلب أكثر» should draw the eye — "subtle flashing/pulsing... tasteful and smooth, not aggressive
// blinking"). Same calm machinery as LoadDot above (EASE_OUT, withRepeat/withSequence, reduced-motion
// → static), but a slower cadence and a much smaller opacity swing: LoadDot signals "working right
// now" over ~300ms bursts, this signals "idle, but worth a look" over a much longer breathing cycle
// so it never reads as urgent, broken, or attention-hostile while it sits on screen.
export function GoldPulse({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(1);
  useEffect(() => {
    if (reduced) { v.value = 1; return; }
    v.value = withRepeat(withSequence(
      withTiming(0.82, { duration: 1400, easing: EASE_OUT }),
      withTiming(1, { duration: 1400, easing: EASE_OUT }),
    ), -1, false);
    return () => cancelAnimation(v);
  }, [v, reduced]);
  const a = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

// The metallic glint (owner 2026-09-20: "I don't like the golden color, make it shiny" — layered on
// top of GoldShineButton's own gradient below). A soft white band sweeps once across the button
// (~900ms) then holds OFF-SCREEN for a few seconds before the next pass — a glint, not a scrolling
// marquee. Rest (v=0) and end (v=1) both park the band fully outside the button on either side — the
// 400px travel deliberately overshoots this row's widest realistic label (this button's text is the
// longest on the row; 400px clears it with margin to spare) so the hold between passes is genuinely
// invisible, never a frozen streak caught mid-button. Reduced motion → not rendered at all: a static
// gradient still reads as "gold", a frozen half-bright streak would not.
// Clipped by the caller's own overflow:hidden (GoldShineButton's `goldClip`) — no separate clip view.
function ShineSweep() {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    v.value = withRepeat(withSequence(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      withTiming(1, { duration: 2600, easing: Easing.linear }), // holds off-screen-right between passes
      withTiming(0, { duration: 0 }), // snaps back off-screen-left, unseen (parked there, not mid-sweep)
    ), -1, false);
    return () => cancelAnimation(v);
  }, [v, reduced]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: v.value * 400 }, { rotate: '20deg' }] }));
  if (reduced) return null;
  return (
    <Animated.View style={[s.shineBand, a]} pointerEvents="none">
      <LinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.4 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

// The encouraged-action gold CTA's own paint (owner 2026-09-20): a diagonal metallic gradient
// (light highlight → deep base, literal hex via useThemePalette — CSS var() strings can't feed
// LinearGradient, same rule HeroBackground.tsx already follows) with ShineSweep's glint on top.
// Every prop is exactly what the plain Pressable it replaces took (testID/onPress/disabled/style),
// so the call site's behavior is unchanged — only the paint is now three layers instead of one flat
// color. `style` still owns layout (padding/radius/minWidth); this component adds `overflow:hidden`
// so the gradient and the sweep both respect the pill's rounded corners.
export function GoldShineButton({ children, style, onPress, disabled, testID }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const pal = useThemePalette();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled} style={[style, s.goldClip]}>
      {({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => (
        <>
          <LinearGradient
            colors={(hovered || pressed) ? [pal.goldLightHover, pal.goldDeepHover] : [pal.goldLight, pal.goldDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <ShineSweep />
          {children}
        </>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  // height matches the button label's line so the text↔dots swap causes zero size change.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 18 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  // Clips the gradient AND the shine sweep to the button's own rounded pill — border radius comes
  // from the caller's `style` (mBtnPrimary), this only adds the clip + a relative anchor so the
  // absoluteFill gradient and the sweep's absolute band both position against THIS box.
  goldClip: { overflow: 'hidden', position: 'relative' },
  // Rests off-screen-left (see ShineSweep's travel math); taller than the button and rotated so the
  // band reads as a diagonal glint, not a vertical bar. `left` is a fixed px, not a %, because the
  // animated translateX travel distance is itself a fixed px figure — the two must agree in the same
  // unit for the parked/off-screen positions to land where the comment above claims they do.
  shineBand: { position: 'absolute', top: -20, bottom: -20, left: -70, width: 34 },
});
