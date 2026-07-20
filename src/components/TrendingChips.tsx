// Proactive "trending now" quick-pick chips, shown ABOVE the City field once a rent period is chosen
// (owner request 2026-07-21). Period-scoped: the monthly and annual lists genuinely differ. Cities
// until one is chosen, then that city's districts. Tapping a chip runs the search immediately (the
// caller wires onPress → search). Styled to BLEND with the form's existing green "start here" chips
// (chipFill / chipLine tokens) and the Trending header (🔥 + dark title), so it reads as one system.
//
// Animation lives at the call site: the whole block is wrapped in <Reveal> keyed by period+city, so it
// fades + slides in on first appearance and re-plays whenever the period flips or the city changes.
// The chips themselves keep only the baseline Tappable press-dip — matching the owner's "no shimmer,
// no flashing" rule for the trending surfaces (see TrendingList.tsx).
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/theme/tokens';
import { Tappable } from './ui';

export type TrendingChip = { key: string; label: string };

export function TrendingChips({
  title, items, onPress,
}: {
  title: string;
  items: TrendingChip[];
  onPress: (item: TrendingChip, index: number) => void;
}) {
  if (!items.length) return null;
  return (
    <View>
      <View style={s.head}>
        <Text style={s.flame}>🔥</Text>
        <Text style={s.title}>{title}</Text>
      </View>
      <View style={s.wrap}>
        {items.map((item, i) => (
          <Tappable key={item.key} dip={0.04} style={s.chip} onPress={() => onPress(item, i)}>
            <Text style={s.chipText} numberOfLines={1}>{item.label}</Text>
          </Tappable>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8, marginHorizontal: 2 },
  flame: { fontSize: 14 },
  title: { fontSize: 13, fontWeight: '700', color: colors.dark, textAlign: 'right', writingDirection: 'rtl' },
  // Wrapping row of pills — RTL-safe (flows with the app's document direction like the property-group
  // chips), no horizontal ScrollView (which mis-anchors under RTL on react-native-web).
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.chipFill,
    borderWidth: 1,
    borderColor: colors.chipLine,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.chipIcon, writingDirection: 'rtl' },
});
