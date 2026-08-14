// Plain "trending" header + numbered list for the City/District field's empty-focus Top-6
// suggestions (owner 2026-07-20: simplified from an earlier, more elaborate leaderboard treatment —
// "no shimmer, no flashing, no gradients, no complex animations... just a clean title with a small
// fire icon and a numbered list underneath"). Deliberately has NO animation at all: no entrance,
// no press-pop on the rank, nothing that plays on mount or loops. `Tappable` still gives each row
// the same press-dip every other tappable row in the app already has — that's baseline interaction
// feedback, not a "flashy effect."
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { Tappable } from './ui';

// `icon` (2026-08-14): the LOC_IMG designed art (city/district), restored to the Top-6 rows — it was
// dropped when TrendingRows replaced the plain suggestion rows (PR#155 branch), never by the owner's
// simplification. Optional so any icon-less use keeps today's layout byte-identical.
export type TrendingItem = { key: string; label: string; sublabel?: string; icon?: any };

// Same 20×20 treatment as the typed rows' suggLocIcon (index.tsx). onError → render nothing: a bad
// asset must never break the row, the label/rank always survive.
function RowIcon({ source }: { source: any }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <Image source={source} style={s.rowIcon} onError={() => setFailed(true)} />;
}

export function TrendingHeader({ title }: { title: string }) {
  return (
    <View style={s.head}>
      <Text style={s.flame}>🔥</Text>
      <Text style={s.headTitle}>{title}</Text>
    </View>
  );
}

export function TrendingRows({
  items, onPress, selectedLabels,
}: {
  items: TrendingItem[];
  onPress: (item: TrendingItem, index: number) => void;
  // District multi-select (owner 2026-08-10): rows whose label is in this set render selected —
  // chip-green fill + a primary checkmark — and tapping again deselects (the parent toggles).
  // Optional and label-keyed so the City field's single-select use is completely untouched.
  selectedLabels?: ReadonlySet<string>;
}) {
  return (
    <>
      {items.map((item, i) => {
        const sel = selectedLabels?.has(item.label) ?? false;
        return (
          <Tappable
            key={item.key}
            testID="trending-row"
            dip={0.03}
            style={[s.row, i < items.length - 1 && s.rowDivider, sel && s.rowSelected]}
            onPress={() => onPress(item, i)}
          >
            <Text style={s.rank}>{i + 1}.</Text>
            {item.icon ? <RowIcon source={item.icon} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={[s.rowLabel, sel && s.rowLabelSelected]}>{item.label}</Text>
              {item.sublabel ? <Text style={s.rowSub}>{item.sublabel}</Text> : null}
            </View>
            {sel ? <Text style={s.selMark}>✓</Text> : null}
          </Tappable>
        );
      })}
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
  rowIcon: { width: 20, height: 20, resizeMode: 'contain' }, // mirrors index.tsx suggLocIcon
  rowLabel: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 11.5, color: colors.muted },
  // Selected = the app's existing chip treatment (chipFill/chipLine), not a new visual language.
  rowSelected: { backgroundColor: colors.chipFill },
  rowLabelSelected: { color: colors.dark, fontWeight: '700' },
  selMark: { fontSize: 14, fontWeight: '800', color: colors.primary },
});
