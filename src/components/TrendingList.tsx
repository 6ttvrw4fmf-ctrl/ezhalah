// Plain "trending" header + numbered list for the City/District field's empty-focus Top-6
// suggestions (owner 2026-07-20: simplified from an earlier, more elaborate leaderboard treatment —
// "no shimmer, no flashing, no gradients, no complex animations... just a clean title with a small
// fire icon and a numbered list underneath"). Deliberately has NO animation at all: no entrance,
// no press-pop on the rank, nothing that plays on mount or loops. `Tappable` still gives each row
// the same press-dip every other tappable row in the app already has — that's baseline interaction
// feedback, not a "flashy effect."
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { Tappable } from './ui';

export type TrendingItem = { key: string; label: string; sublabel?: string };

export function TrendingHeader({ title }: { title: string }) {
  return (
    <View style={s.head}>
      <Text style={s.flame}>🔥</Text>
      <Text style={s.headTitle}>{title}</Text>
    </View>
  );
}

export function TrendingRows({
  items, onPress,
}: {
  items: TrendingItem[];
  onPress: (item: TrendingItem, index: number) => void;
}) {
  return (
    <>
      {items.map((item, i) => (
        <Tappable
          key={item.key}
          dip={0.03}
          style={[s.row, i < items.length - 1 && s.rowDivider]}
          onPress={() => onPress(item, i)}
        >
          <Text style={s.rank}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>{item.label}</Text>
            {item.sublabel ? <Text style={s.rowSub}>{item.sublabel}</Text> : null}
          </View>
        </Tappable>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 12 },
  flame: { fontSize: 14 },
  headTitle: { fontSize: 13, fontWeight: '700', color: colors.dark },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rank: { fontSize: 13, fontWeight: '700', color: colors.muted, width: 18 },
  rowLabel: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 11.5, color: colors.muted },
});
