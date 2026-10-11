// The Advanced Filter round's search beat (owner 2026-10-11): instead of the website-logo show, ONE
// sentence built from what the user picked — «نفحص 173 إعلان لنجد لك» then each pick appearing one after
// another («فيلا» · «مصعد» · «شارع ٢٥ م فأكثر» …), as if each is being checked in turn. The whole beat is
// AF_LOADER_MS (5 s) in agent.tsx; the picks are paced to land inside it.
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';

/** ms between two picks appearing: the whole list lands by ~3.6 s, never faster than 350 ms a pick. */
export function afPickStepMs(n: number): number {
  return n <= 1 ? 0 : Math.max(350, Math.min(700, Math.floor(3600 / n)));
}

function Pick({ label, first }: { label: string; first: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a]);
  return (
    <Animated.Text
      style={[styles.pick, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}
    >
      {first ? '' : ' · '}{label}
    </Animated.Text>
  );
}

function AfRoundLoader({ count, items, exiting, fontFamily }: { count: number | null; items: string[]; exiting?: boolean; fontFamily?: string }) {
  const { t, isRTL } = useI18n();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? items.length : Math.min(1, items.length));
  useEffect(() => {
    if (reduced || shown >= items.length) return;
    const id = setTimeout(() => setShown((n) => n + 1), afPickStepMs(items.length));
    return () => clearTimeout(id);
  }, [shown, items.length, reduced]);
  const lead = count != null
    ? t('Checking {count} listings to find you', { count: count.toLocaleString('en-US') })
    : t('Searching to find you');
  return (
    <View testID="af-round-loader" style={[styles.wrap, exiting && styles.exiting, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Ionicons name="sparkles" size={16} color={colors.primary} style={styles.icon} />
      <Text style={[styles.line, { fontFamily, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }]}>
        <Text style={styles.lead}>{lead} </Text>
        {items.slice(0, shown).map((label, i) => <Pick key={`${i}-${label}`} label={label} first={i === 0} />)}
        {shown >= items.length ? <Text style={styles.lead}>…</Text> : null}
      </Text>
    </View>
  );
}

export default memo(AfRoundLoader);

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start', gap: 8, paddingHorizontal: 4, paddingVertical: 10 },
  exiting: { opacity: 0 },
  icon: { marginTop: 3 },
  line: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 24, color: colors.body },
  lead: { color: colors.muted },
  pick: { color: colors.ink, fontWeight: '600' },
});
