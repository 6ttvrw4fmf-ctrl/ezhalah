// "Trending" leaderboard treatment for the City/District field's empty-focus Top-6 suggestions
// (owner request 2026-07-20: make it "feel like a live trending leaderboard", not a plain list —
// but "a subtle flash... only when the section first appears or when the rankings change", never
// looping). Reuses the app's own motion language rather than inventing a new one: row fade+rise is
// literally CardReveal's <CardIn> (the results list uses it too), and the rank badge's scale-in
// reuses ui.tsx's POP_UP/POP_SETTLE — the same "achievement" pop OptionBox plays on selection. The
// ONLY new motion here is the one-shot light-sweep across the header title.
//
// Deliberately drops 🥇🥈🥉 medal emoji (render inconsistently across Android OEM fonts, and skew
// the whole row toward "listicle" rather than "premium fintech leaderboard" — see the design
// proposal shared with the owner). Rank is a small graduated badge instead: #1 filled gradient, #2
// light fill, #3 outline, #4-6 a plain muted numeral — the same visual-weight-by-rank idea, built
// from tokens already in this app's palette.
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/theme/tokens';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { Tappable, POP_UP } from './ui';
import { CardIn } from './CardReveal';

export type TrendingItem = { key: string; label: string; sublabel?: string };

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const arabicDigit = (n: number) => String(n).split('').map((c) => ARABIC_DIGITS[Number(c)] ?? c).join('');

const ROW_STAGGER_MS = 55; // same cadence CardReveal's results drip already uses
const ROW_BASE_DELAY_MS = 140;
const SWEEP_DURATION_MS = 900;
const SWEEP_DELAY_MS = 120;

// One-shot light-sweep across the header — plays once per `runKey` change, never loops.
function HeaderSweep({ runKey }: { runKey: string }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(-1);
  useEffect(() => {
    if (reduced) return;
    x.value = -1;
    x.value = withDelay(SWEEP_DELAY_MS, withTiming(1, { duration: SWEEP_DURATION_MS, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(x);
  }, [runKey, reduced, x]);
  const a = useAnimatedStyle(() => ({
    opacity: reduced ? 0 : 1,
    transform: [{ translateX: x.value * 220 }, { rotate: '12deg' }],
  }));
  if (reduced) return null;
  return (
    <Animated.View pointerEvents="none" style={[s.sweep, a]} />
  );
}

function RankBadge({ rank, runKey, index }: { rank: number; runKey: string; index: number }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) { v.value = 1; return; }
    v.value = 0;
    v.value = withDelay(
      ROW_BASE_DELAY_MS + index * ROW_STAGGER_MS + 60,
      withSequence(withTiming(1, POP_UP), withTiming(1, { duration: 0 })),
    );
    return () => cancelAnimation(v);
  }, [runKey, reduced, index, v]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + v.value * 0.3 }] }));
  const box = rank === 1 ? s.rank1 : rank === 2 ? s.rank2 : rank === 3 ? s.rank3 : s.rankPlain;
  const textStyle = rank === 1 ? s.rank1Text : rank <= 3 ? s.rankAccentText : s.rankPlainText;
  return (
    <Animated.View style={[s.rank, box, a]}>
      <Text style={textStyle}>{arabicDigit(rank)}</Text>
    </Animated.View>
  );
}

// Shared header — flame glyph + title, with the one-shot sweep. `runKey` should change exactly when
// the underlying ranking changes (new deal, new city, or first mount) so the sweep replays then and
// only then — re-focusing the same field with the same ranking must NOT replay it.
export function TrendingHeader({ title, runKey }: { title: string; runKey: string }) {
  return (
    <View style={s.head}>
      <HeaderSweep runKey={runKey} />
      <Ionicons name="flame" size={16} color={colors.amberInk} style={s.flame} />
      <Text style={s.headTitle}>{title}</Text>
    </View>
  );
}

// The ranked rows themselves. `runKey` gates the entrance replay exactly like the header's sweep —
// pass the same value to both so they stay in lockstep.
export function TrendingRows({
  items, runKey, onPress, testIdPrefix,
}: {
  items: TrendingItem[];
  runKey: string;
  onPress: (item: TrendingItem, index: number) => void;
  testIdPrefix?: string;
}) {
  return (
    <>
      {items.map((item, i) => (
        <CardIn key={`${runKey}:${item.key}`} delay={ROW_BASE_DELAY_MS + i * ROW_STAGGER_MS}>
          <Tappable
            dip={0.03}
            style={[s.row, i < items.length - 1 && s.rowDivider]}
            onPress={() => onPress(item, i)}
          >
            <RankBadge rank={i + 1} runKey={runKey} index={i} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>{item.label}</Text>
              {item.sublabel ? <Text style={s.rowSub}>{item.sublabel}</Text> : null}
            </View>
          </Tappable>
        </CardIn>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12,
    overflow: 'hidden',
  },
  flame: { flexShrink: 0 },
  headTitle: { fontSize: 13, fontWeight: '700', color: colors.dark },
  sweep: {
    position: 'absolute', top: -10, bottom: -10, left: '30%', width: 60,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rank: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rank1: { backgroundColor: colors.primary },
  rank2: { backgroundColor: colors.tint },
  rank3: { backgroundColor: 'transparent', borderWidth: 1.4, borderColor: colors.tintLine },
  rankPlain: { backgroundColor: 'transparent' },
  rank1Text: { fontSize: 12.5, fontWeight: '700', color: '#fff' },
  rankAccentText: { fontSize: 12.5, fontWeight: '700', color: colors.dark },
  rankPlainText: { fontSize: 12.5, fontWeight: '600', color: colors.muted },
  rowLabel: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 11.5, color: colors.muted },
});
