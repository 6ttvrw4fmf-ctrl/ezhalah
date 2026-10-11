// The Advanced Filter round's search beat (owner 2026-10-11): no website-logo show and no count — one line,
// «نبحث عن …», whose ending CHANGES pick by pick: «نبحث عن الفلل والبيوت…» → «نبحث عن فيلا…» → «نبحث عن عمر
// حتى ٥ سنوات…» → «نبحث عن مصعد…». The whole beat is AF_LOADER_MS (5 s) in agent.tsx; the picks are paced
// to fit inside it, and the last one stays until the results arrive.
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';

/** Pacing for n picks: the LAST pick lands by 4.2 s of the 5 s beat, whatever n is. `share` is one pick's
 *  turn (≤ 1.58 s), `swap` the fade out+in inside it (≤ 380 ms, a third of the share), `wait` the rest. */
export function afPickTiming(n: number): { wait: number; swap: number } {
  if (n <= 1) return { wait: 0, swap: 0 };
  const share = Math.min(1580, Math.floor(4200 / (n - 1)));
  const swap = Math.min(380, Math.floor(share / 3));
  return { wait: share - swap, swap };
}

function AfRoundLoader({ items, exiting, fontFamily }: { items: string[]; exiting?: boolean; fontFamily?: string }) {
  const { t, isRTL } = useI18n();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (index >= items.length - 1) return;
    const { wait, swap } = afPickTiming(items.length);
    const id = setTimeout(() => {
      if (reduced) { setIndex((i) => i + 1); return; }
      // Out, swap the word, back in — the line itself never moves.
      Animated.timing(fade, { toValue: 0, duration: Math.round(swap * 0.4), easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        setIndex((i) => i + 1);
        Animated.timing(fade, { toValue: 1, duration: Math.round(swap * 0.6), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      });
    }, reduced ? wait + swap : wait);
    return () => clearTimeout(id);
  }, [index, items.length, reduced, fade]);
  const pick = items[Math.min(index, items.length - 1)] ?? '';
  return (
    <View testID="af-round-loader" style={[styles.wrap, exiting && styles.exiting, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Ionicons name="sparkles" size={16} color={colors.primary} />
      <Text style={[styles.line, { fontFamily, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }]} numberOfLines={1}>
        <Text style={styles.lead}>{t('Searching for')} </Text>
        <Animated.Text style={[styles.pick, { opacity: fade }]}>{pick}…</Animated.Text>
      </Text>
    </View>
  );
}

export default memo(AfRoundLoader);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 10 },
  exiting: { opacity: 0 },
  line: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 24, color: colors.body },
  lead: { color: colors.muted },
  pick: { color: colors.ink, fontWeight: '600' },
});
