// The Advanced Filter round's search beat (owner 2026-10-11): no website-logo show and no count — one line,
// «نبحث عن …», whose ending CHANGES pick by pick: «نبحث عن الفلل والبيوت…» → «نبحث عن فيلا…» → «نبحث عن عمر
// حتى ٥ سنوات…» → «نبحث عن مصعد…». The whole beat is AF_LOADER_MS (5 s) in agent.tsx; the picks are paced
// to fit inside it, and the last one stays until the results arrive.
// THE LINE LOOKS AND MOVES LIKE THE SEARCH LINE ON TOP OF THE LOGO LOADER (owner 2026-10-11, pointing at «نفحص أكثر
// من 349,793 عقار…»: «keep it like this color and animation»): one soft colour for every word (colors.body, semibold
// 14.5 px — the same style as SearchLoader's headline), the same gentle continuous pulse (0.55 ↔ 1, 650 ms each way),
// and a cross-fade on every change. The picked option used to be the one dark-ink bold word against a muted lead.
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';

/** Pacing for n picks: the LAST pick lands by 4.2 s of the 5 s beat, whatever n is. `share` is one pick's
 *  turn (≤ 1.58 s), `swap` the fade out+in inside it (≤ 380 ms, a third of the share), `wait` the rest. */
// The ease SearchLoader's headline uses (its EASE_OUT), so the pulse breathes the same way.
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

export function afPickTiming(n: number): { wait: number; swap: number } {
  if (n <= 1) return { wait: 0, swap: 0 };
  const share = Math.min(1580, Math.floor(4200 / (n - 1)));
  const swap = Math.min(380, Math.floor(share / 3));
  return { wait: share - swap, swap };
}

function AfRoundLoader({ items, pools, exiting, fontFamily }: { items: string[]; pools?: Array<number | null>; exiting?: boolean; fontFamily?: string }) {
  const { t, isRTL } = useI18n();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;   // SearchLoader's continuous soft shimmer, same numbers
  useEffect(() => {
    if (reduced) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.55, duration: 650, easing: EASE_OUT, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: EASE_OUT, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);
  useEffect(() => {
    if (index >= items.length - 1) return;
    const { wait, swap } = afPickTiming(items.length);
    let swapId: ReturnType<typeof setTimeout> | undefined;
    const id = setTimeout(() => {
      if (reduced) { setIndex((i) => i + 1); return; }
      // Out, swap the word, back in — the line itself never moves. The swap rides a timer, not an
      // animation callback, so the hand-off never depends on an animation frame (nav barrier).
      const outMs = Math.round(swap * 0.4);
      Animated.timing(fade, { toValue: 0, duration: outMs, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
      swapId = setTimeout(() => {
        setIndex((i) => i + 1);
        Animated.timing(fade, { toValue: 1, duration: Math.round(swap * 0.6), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }, outMs);
    }, reduced ? wait + swap : wait);
    return () => { clearTimeout(id); if (swapId) clearTimeout(swapId); };
  }, [index, items.length, reduced, fade]);
  const at = Math.min(index, items.length - 1);
  const pick = items[at] ?? '';
  // «نفحص 830 عقار…» — CHECKING, with the real size of the set this pick is checked against (owner 2026-10-11: «the
  // animation should be checking like this», pointing at «نفحص أكثر من 349,793 عقار…»). Where that size was never
  // known the line names the pick instead («نفحص مصعد…») — it never invents a number.
  // The beat names the PICK, one after another («نفحص مصعد…» → «نفحص بلكونة…»), never the set size
  // (owner 2026-11-01: «replace ezhalah is thinking with what the user selected, without the emoji,
  // one after another»). `pools` still arrives from the round (buildAfBeatSteps) and stays unused here.
  const text = `${t('Checking')} ${pick}…`;
  return (
    <View testID="af-round-loader" style={[styles.wrap, exiting && styles.exiting, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Ionicons name="sparkles" size={16} color={colors.primary} />
      <Animated.Text style={[styles.line, { fontFamily, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr', opacity: pulse }]} numberOfLines={1}>
        <Animated.Text style={{ opacity: fade }}>{text}</Animated.Text>
      </Animated.Text>
    </View>
  );
}

export default memo(AfRoundLoader);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 10 },
  exiting: { opacity: 0 },
  // Same type as SearchLoader's `title` (14.5 px, 600, colors.body) — every word one colour, none darker.
  line: { flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 24, fontWeight: '600', color: colors.body },
});
