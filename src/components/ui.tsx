import { Image, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useEffect, useRef } from 'react';
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
const AnimatedImage = Animated.createAnimatedComponent(Image);
// Selection ease — slow-in/slow-out (bezier) so the colour fade glides edge to edge
// instead of snapping. Slightly longer than a tap so the eye can follow the change.
const EASE = { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) };
// Press feedback: a quick dip on finger-down, then a springy release so the button
// settles back with a soft bounce (modern iOS feel) instead of a flat linear fade.
const PRESS_IN = { duration: 90, easing: Easing.out(Easing.quad) };
const RELEASE = { mass: 0.5, damping: 11, stiffness: 230 }; // slightly bouncier release — a soft overshoot on finger-up
// Selection "achievement" feel (owner request): on BECOMING selected, a quick scale overshoot that springs
// back to rest, plus a green glow that blooms then settles. Subtle + premium — rewarding, not childish.
// Exported so other one-shot "pop into place" moments (e.g. TrendingList's rank badges) reuse the exact
// same motion instead of a second, slightly-different set of constants.
export const POP_UP = { duration: 130, easing: Easing.out(Easing.quad) };
export const POP_SETTLE = { mass: 0.5, damping: 9, stiffness: 210 };
// Focus/hover fade for web pointer + keyboard states (skill rule #1/#2: visible focus + hover feedback).
const FOCUS_T = { duration: 130, easing: Easing.out(Easing.quad) };

// Reusable spring-press wrapper — wraps any content so a plain tappable gets the
// same modern dip-and-bounce feedback as the styled controls below.
export function Tappable({
  children, onPress, style, dip = 0.035, disabled,
}: {
  children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>;
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
      style={[style, a]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Smooth reveal for content that mounts in — the filter's progressive steps (Property group → type →
// detail → budget). Fades + slides up gently so a newly-unlocked section glides in instead of popping,
// matching the soft feel of opening a listing. (user: filter selections should feel smooth, not harsh.)
export function Reveal({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  const v = useSharedValue(0);
  useEffect(() => { v.value = withTiming(1, EASE); }, [v]);
  const a = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 10 }] }));
  return <Animated.View style={[style as any, a]}>{children}</Animated.View>;
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
function SegButton({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: any }) {
  const p = useSharedValue(on ? 1 : 0);
  const press = useSharedValue(0);
  const focus = useSharedValue(0);
  const pop = useSharedValue(0);             // select "achievement" pop
  const glow = useSharedValue(on ? 1 : 0);   // green glow: blooms on select, rests while selected
  const wasOn = useRef(on);
  useEffect(() => {
    p.value = withTiming(on ? 1 : 0, EASE);
    if (on && !wasOn.current) {
      pop.value = withSequence(withTiming(0.045, POP_UP), withSpring(0, POP_SETTLE));
      glow.value = withSequence(withTiming(1.5, POP_UP), withTiming(1, EASE));
    } else if (!on) {
      glow.value = withTiming(0, FOCUS_T);
    }
    wasOn.current = on;
  }, [on, p]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], ['rgba(47,114,71,0)', colors.primary]),
    transform: [{ scale: 1 - press.value * 0.05 + pop.value }],
    // web keyboard-focus ring (a11y) + selection glow bloom; native uses shadow* props for the same glow
    ...(Platform.OS === 'web'
      ? { outlineStyle: 'solid', outlineColor: colors.primary, outlineWidth: focus.value * 2.5, outlineOffset: 2,
          boxShadow: `0px ${glow.value * 5}px ${glow.value * 14}px rgba(20,80,45,${glow.value * 0.28})` }
      : { shadowColor: '#14502d', shadowOpacity: glow.value * 0.28, shadowRadius: glow.value * 14, shadowOffset: { width: 0, height: glow.value * 5 }, elevation: glow.value * 5 }),
  }));
  const txt = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [colors.muted, '#ffffff']) }));
  const tint = useAnimatedStyle(() => ({ tintColor: interpolateColor(p.value, [0, 1], [colors.muted, '#ffffff']) }));
  return (
    <AnimatedPressable
      style={[s.segBtn, box]}
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
      onPressOut={() => { press.value = withSpring(0, RELEASE); }}
      onFocus={() => { focus.value = withTiming(1, FOCUS_T); }}
      onBlur={() => { focus.value = withTiming(0, FOCUS_T); }}
    >
      {icon ? <AnimatedImage source={icon} resizeMode="contain" style={[s.segIcon, tint]} /> : null}
      <Animated.Text ref={noTranslateRef} style={[s.segText, txt]}>{label}</Animated.Text>
    </AnimatedPressable>
  );
}

export function Segmented({ options, value, onChange, icons }: { options: string[]; value: string; onChange: (v: string) => void; icons?: Record<string, any> }) {
  const { t } = useI18n();
  return (
    <View style={s.segTrack}>
      {options.map((opt) => (
        <SegButton key={opt} label={t(opt)} on={opt === value} onPress={() => onChange(opt)} icon={icons?.[opt]} />
      ))}
    </View>
  );
}

// Tappable option box (category / type / detail) — selection fades in, press dips slightly.
export function OptionBox({ label, selected, onPress, style, img }: { label: string; selected: boolean; onPress: () => void; style?: ViewStyle; img?: any }) {
  const p = useSharedValue(selected ? 1 : 0);
  const press = useSharedValue(0);
  const hover = useSharedValue(0);
  const focus = useSharedValue(0);
  const pop = useSharedValue(0);                  // select "achievement" pop
  const glow = useSharedValue(selected ? 1 : 0);  // green glow: blooms on select, rests while selected
  const wasSel = useRef(selected);
  useEffect(() => {
    p.value = withTiming(selected ? 1 : 0, EASE);
    if (selected && !wasSel.current) {
      pop.value = withSequence(withTiming(0.055, POP_UP), withSpring(0, POP_SETTLE));
      glow.value = withSequence(withTiming(1.5, POP_UP), withTiming(1, EASE));
    } else if (!selected) {
      glow.value = withTiming(0, FOCUS_T);
    }
    wasSel.current = selected;
  }, [selected, p]);
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [colors.surface, colors.primary]),
    // hover (web pointer) tints the border toward primary while unselected — subtle "tappable" cue
    borderColor: interpolateColor(Math.max(p.value, hover.value * (1 - p.value)), [0, 1], [colors.pickLine, colors.primary]),
    transform: [{ scale: 1 - press.value * 0.045 + pop.value }],
    // web keyboard-focus ring (a11y) + selection glow bloom; native uses shadow* props for the same glow
    ...(Platform.OS === 'web'
      ? { outlineStyle: 'solid', outlineColor: colors.primary, outlineWidth: focus.value * 2.5, outlineOffset: 2,
          boxShadow: `0px ${glow.value * 7}px ${glow.value * 16}px rgba(20,80,45,${glow.value * 0.30})` }
      : { shadowColor: '#14502d', shadowOpacity: glow.value * 0.30, shadowRadius: glow.value * 16, shadowOffset: { width: 0, height: glow.value * 7 }, elevation: glow.value * 6 }),
  }));
  const txt = useAnimatedStyle(() => ({ color: interpolateColor(p.value, [0, 1], [colors.ink, '#ffffff']) }));
  const tint = useAnimatedStyle(() => ({ tintColor: interpolateColor(p.value, [0, 1], [colors.ink, '#ffffff']) }));
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => { press.value = withTiming(1, PRESS_IN); }}
      onPressOut={() => { press.value = withSpring(0, RELEASE); }}
      onHoverIn={() => { hover.value = withTiming(1, FOCUS_T); }}
      onHoverOut={() => { hover.value = withTiming(0, FOCUS_T); }}
      onFocus={() => { focus.value = withTiming(1, FOCUS_T); }}
      onBlur={() => { focus.value = withTiming(0, FOCUS_T); }}
      style={[s.box, box, style]}
    >
      {img ? <AnimatedImage source={img} resizeMode="contain" style={[s.optIcon, tint]} /> : null}
      <Animated.Text ref={noTranslateRef} style={[s.boxText, selected && s.boxTextOn, txt, NO_MIDWORD_BREAK]} numberOfLines={2}>{label}</Animated.Text>
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
  // ≥44pt touch target (skill rule #2); centered so the taller box keeps the label optically centred.
  segBtn: { flex: 1, minHeight: 44, paddingVertical: 12, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  segIcon: { width: 18, height: 18 }, // Buy/Rent + Monthly/Yearly segment icon (tinted muted→white)
  segText: { fontSize: 14.5, fontWeight: '600' },

  // minHeight 46 → clears the 44pt touch-target floor (skill rule #2); more horizontal padding + a
  // pointer cursor on web for a premium, obviously-tappable feel.
  box: { flex: 1, minHeight: 46, paddingVertical: 12, paddingHorizontal: 8, borderRadius: radius.chip, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  // Softer, larger, green-tinted elevation for the selected chip (premium depth vs the old hard shadow).
  boxShadow: { shadowColor: '#14502d', shadowOpacity: 0.24, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 },
  boxText: { fontSize: 12.5, fontWeight: '600', lineHeight: 16, textAlign: 'center' },
  boxTextOn: { fontWeight: '700' }, // selected state reinforced by weight, not colour alone (skill a11y rule)
  // Filter button icon (category / group / type / bedroom) — stacked above the label, tinted ink→white
  // on selection to match the label. Restored 2026-07-05 (render wiring was lost in the git reset; the
  // PNGs + IMG maps in propertyIcons.ts survived). ~24px per UI/UX-skill icon sizing.
  optIcon: { width: 24, height: 24, marginBottom: 6 },

  cta: { backgroundColor: colors.primary, borderRadius: radius.field, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },

  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.primary, letterSpacing: 0.55, marginBottom: 8, marginHorizontal: 2 },
});
