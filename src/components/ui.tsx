import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useEffect } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { noTranslateRef } from '@/noTranslate';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
// Selection ease — slow-in/slow-out (bezier) so the colour fade glides edge to edge
// instead of snapping. Slightly longer than a tap so the eye can follow the change.
const EASE = { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) };
// Press feedback: a quick dip on finger-down, then a springy release so the button
// settles back with a soft bounce (modern iOS feel) instead of a flat linear fade.
const PRESS_IN = { duration: 90, easing: Easing.out(Easing.quad) };
const RELEASE = { mass: 0.5, damping: 13, stiffness: 230 };

// Reusable spring-press wrapper — wraps any content so a plain tappable gets the
// same modern dip-and-bounce feedback as the styled controls below.
export function Tappable({
  children, onPress, style, dip = 0.035, disabled,
}: {
  children: React.ReactNode; onPress?: () => void; style?: ViewStyle | ViewStyle[];
  dip?: number; disabled?: boolean;
}) {
  const press = useSharedValue(0);
  const a = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * dip }],
    opacity: 1 - press.value * 0.06,
  }));
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
      onPressOut={() => { press.value = withSpring(0, RELEASE); }}
      style={[style as any, a]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Gentle "heartbeat" pulse — a soft double-thump (lub-dub) then a rest, looping forever, so the
// example/suggestion cards feel alive without being distracting. Subtle scale only (≤1.035). An
// optional index staggers each card's beat so they don't all thump in lockstep. (user request.)
export function Heartbeat({
  children, style, index = 0,
}: {
  children: React.ReactNode; style?: ViewStyle | ViewStyle[]; index?: number;
}) {
  const v = useSharedValue(1);
  useEffect(() => {
    const beat = withSequence(
      withTiming(1.035, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 140, easing: Easing.in(Easing.quad) }),
      withTiming(1.035, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 160, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 1500 }), // rest between heartbeats
    );
    v.value = withDelay((index % 6) * 120, withRepeat(beat, -1, false));
    return () => cancelAnimation(v);
  }, [v, index]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: v.value }] }));
  return <Animated.View style={[style as any, a]}>{children}</Animated.View>;
}

// Rent / Buy segmented control. Option values stay in English; only the label is localized.
function SegButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const p = useSharedValue(on ? 1 : 0);
  const press = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(on ? 1 : 0, EASE);
  }, [on, p]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], ['rgba(47,114,71,0)', colors.primary]),
    transform: [{ scale: 1 - press.value * 0.05 }],
  }));
  const txt = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [colors.muted, '#ffffff']) }));
  return (
    <AnimatedPressable
      style={[s.segBtn, box]}
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
      onPressOut={() => { press.value = withSpring(0, RELEASE); }}
    >
      <Animated.Text ref={noTranslateRef} style={[s.segText, txt]}>{label}</Animated.Text>
    </AnimatedPressable>
  );
}

export function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <View style={s.segTrack}>
      {options.map((opt) => (
        <SegButton key={opt} label={t(opt)} on={opt === value} onPress={() => onChange(opt)} />
      ))}
    </View>
  );
}

// Tappable option box (category / type / detail) — selection fades in, press dips slightly.
export function OptionBox({ label, selected, onPress, style }: { label: string; selected: boolean; onPress: () => void; style?: ViewStyle }) {
  const p = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(selected ? 1 : 0, EASE);
  }, [selected, p]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [colors.surface, colors.primary]),
    borderColor: interpolateColor(p.value, [0, 1], [colors.pickLine, colors.primary]),
    transform: [{ scale: 1 - press.value * 0.045 }],
  }));
  const txt = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [colors.ink, '#ffffff']) }));
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
      onPressOut={() => { press.value = withSpring(0, RELEASE); }}
      style={[s.box, selected && s.boxShadow, box, style]}
    >
      <Animated.Text ref={noTranslateRef} style={[s.boxText, txt, NO_MIDWORD_BREAK]} numberOfLines={2}>{label}</Animated.Text>
    </AnimatedPressable>
  );
}

// Two-word labels like "Commercial Building" must wrap at the SPACE, never mid-word — otherwise a
// trailing letter drops to its own line ("Commercia / l Building"). Forbid in-word breaking on web.
const NO_MIDWORD_BREAK = Platform.OS === 'web'
  ? ({ wordBreak: 'keep-all', overflowWrap: 'normal' } as any)
  : null;

// Primary green CTA — dips and softens on press.
export function PrimaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const press = useSharedValue(0);
  const a = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.03 }],
    opacity: 1 - press.value * 0.12,
  }));
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
      onPressOut={() => { press.value = withSpring(0, RELEASE); }}
      style={[s.cta, disabled && { opacity: 0.5 }, a]}
    >
      <Text style={s.ctaText}>{title}</Text>
    </AnimatedPressable>
  );
}

export function FieldLabel({ children }: { children: string }) {
  return <Text style={s.fieldLabel}>{children.toUpperCase()}</Text>;
}

// 8-spoke loading spinner
export function Spinner({ tint = colors.primary }: { tint?: string }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(r);
  }, [r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value * 360}deg` }] }));
  return (
    <Animated.View style={[{ width: 20, height: 20 }, style]}>
      {Array.from({ length: 8 }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute', left: 9, top: 1, width: 2.5, height: 6, borderRadius: 2,
            backgroundColor: tint, opacity: (i + 1) / 8,
            transform: [{ rotate: `${i * 45}deg` }, { translateY: 0 }],
          }}
        />
      ))}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  segTrack: { flexDirection: 'row', backgroundColor: colors.segTrack, borderRadius: radius.pill, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 11, borderRadius: radius.pill, alignItems: 'center' },
  segText: { fontSize: 14.5, fontWeight: '600' },

  box: { flex: 1, paddingVertical: 12, paddingHorizontal: 5, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  boxShadow: { shadowColor: '#14502d', shadowOpacity: 0.5, shadowRadius: 7, shadowOffset: { width: 0, height: 6 } },
  boxText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },

  cta: { backgroundColor: colors.primary, borderRadius: radius.field, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },

  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 0.55, marginBottom: 8, marginHorizontal: 2 },
});
