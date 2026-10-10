// THE ADVANCED FILTER ROUND'S LOADER (owner 2026-10-10): no website logos — Ezhalah checks the user's
// own picks, one by one («إزهله يفحص المواقع حسب اختيارك…» → each pick spins, then ✓), between 5 and
// 7 seconds in all (lib/afCheckTiming). A NEW search keeps SearchLoader and its platform roster.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { afCheckTiming } from '@/lib/afCheckTiming';

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

function Spinner({ reduced }: { reduced: boolean }) {
  const r = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    r.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(r);
  }, [r, reduced]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={a}><Ionicons name="sync-outline" size={16} color={colors.primary} /></Animated.View>;
}

export default function AfCheckLoader({ picks, exitMs, exiting = false }: { picks: string[]; exitMs: number; exiting?: boolean }) {
  const { t, isRTL: rtl } = useI18n();
  const reduced = useReducedMotion();
  // `step` counts the moments passed since mount: row i is active after 2i of them and ticked after 2i+1.
  // Plain timers, never rAF (a hidden tab must still finish the beat).
  const [step, setStep] = useState(0);
  useEffect(() => {
    const { startMs, stepMs } = afCheckTiming(picks.length, exitMs);
    const timers = picks.flatMap((_, i) => [
      setTimeout(() => setStep((k) => Math.max(k, 2 * i + 1)), startMs + i * stepMs),
      setTimeout(() => setStep((k) => Math.max(k, 2 * i + 2)), startMs + i * stepMs + Math.round(stepMs * 0.8)),
    ]);
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the schedule is fixed at mount: the round's picks never change mid-round
  }, []);
  const exit = useSharedValue(1);
  useEffect(() => {
    if (exiting) exit.value = withTiming(0, { duration: reduced ? 150 : 420, easing: EASE_OUT });
  }, [exiting, reduced, exit]);
  const exitStyle = useAnimatedStyle(() => ({ opacity: exit.value }));
  const dir = { flexDirection: rtl ? 'row-reverse' : 'row' } as const;
  const text = { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' } as const;
  return (
    <Animated.View testID="af-check-loader" style={[s.wrap, { alignItems: rtl ? 'flex-end' : 'flex-start' }, exitStyle]}>
      <View style={[s.titleRow, dir]}>
        <Ionicons name="sparkles" size={15} color={colors.primary} />
        <Text style={[s.title, text]}>{t('Ezhalah is checking the sites for your picks…')}</Text>
      </View>
      {picks.map((p, i) => {
        const state = step >= 2 * i + 2 ? 'done' : step >= 2 * i + 1 ? 'active' : 'waiting';
        return (
          <View key={p} testID={`af-check-${state}`} style={[s.row, dir]}>
            <View style={s.icon}>
              {state === 'done' ? <Ionicons name="checkmark-circle" size={17} color={colors.dark} />
                : state === 'active' ? <Spinner reduced={reduced} />
                : <Ionicons name="ellipse-outline" size={13} color={colors.muted} />}
            </View>
            <Text style={[s.pick, text, state === 'waiting' ? s.pickWaiting : state === 'done' ? s.pickDone : null]}>{p}</Text>
          </View>
        );
      })}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', gap: 8 },
  titleRow: { alignItems: 'center', gap: 7, marginBottom: 2 },
  title: { fontSize: 14.5, fontWeight: '600', color: colors.body },
  row: { alignItems: 'center', gap: 8 },
  icon: { width: 18, alignItems: 'center' },
  pick: { fontSize: 14.5, color: colors.ink },
  pickWaiting: { color: colors.muted },
  pickDone: { color: colors.dark, fontWeight: '600' },
});
