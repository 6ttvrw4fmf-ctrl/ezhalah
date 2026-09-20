// Shared premium reveal primitives for the results list (owner 2026-07-09: «عرض المزيد» must feel
// like a flagship AI product — cards fade in with a slight rise as the drip mounts them one-by-one;
// the button melts into calm pulsing dots while Ezhalah prepares the next batch). Motion is
// MOUNT-ONLY: existing cards never re-animate, transforms only → zero layout shift, no bounce.
// Reduced motion → fade only / static dots.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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

const s = StyleSheet.create({
  // height matches the button label's line so the text↔dots swap causes zero size change.
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 18 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
