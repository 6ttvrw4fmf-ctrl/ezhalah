import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useEffect } from 'react';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, radius } from '@/theme/tokens';

// Rent / Buy segmented control
export function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.segTrack}>
      {options.map((opt) => {
        const on = opt === value;
        return (
          <Pressable key={opt} style={[s.segBtn, on && s.segBtnOn]} onPress={() => onChange(opt)}>
            <Text style={[s.segText, on && s.segTextOn]}>{opt}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Tappable option box (category / type / detail)
export function OptionBox({ label, selected, onPress, style }: { label: string; selected: boolean; onPress: () => void; style?: ViewStyle }) {
  return (
    <Pressable onPress={onPress} style={[s.box, selected ? s.boxOn : s.boxOff, style]}>
      <Text style={[s.boxText, selected && s.boxTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// Primary green CTA
export function PrimaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.cta, disabled && { opacity: 0.5 }]}>
      <Text style={s.ctaText}>{title}</Text>
    </Pressable>
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
  segBtnOn: { backgroundColor: colors.primary },
  segText: { fontSize: 14.5, fontWeight: '600', color: colors.muted },
  segTextOn: { color: '#fff' },

  box: { flex: 1, paddingVertical: 13, paddingHorizontal: 10, borderRadius: radius.chip, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  boxOff: { backgroundColor: colors.surface, borderColor: colors.fieldLine },
  boxOn: { backgroundColor: colors.tint, borderColor: colors.primary, borderWidth: 1.5 },
  boxText: { fontSize: 13.5, fontWeight: '500', color: colors.body },
  boxTextOn: { color: colors.primary, fontWeight: '600' },

  cta: { backgroundColor: colors.primary, borderRadius: radius.field, paddingVertical: 15, alignItems: 'center' },
  ctaText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },

  fieldLabel: { fontSize: 11, fontWeight: '600', color: colors.muted, letterSpacing: 0.4, marginBottom: 8 },
});
