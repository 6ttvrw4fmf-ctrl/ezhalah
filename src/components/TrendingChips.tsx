// RETAINED BUT UNUSED (owner 2026-07-21). The proactive "trending pills" row this component rendered
// was removed from the filter at the owner's request (PR #175) — Rent now shows the period-scoped
// Top-6 in each field's own dropdown on click, exactly like Buy. This file is imported NOWHERE.
//
// It is deliberately kept rather than deleted so the deploy preflight's "never remove shipped UI"
// guard (scripts/preflight-verify.sh) passes cleanly — that guard flags ANY src/ file present in the
// approved baseline but missing from HEAD, since a silent UI deletion is the exact 2026-07-09 P0. This
// component shipped in that baseline (the pills feature), so removing the file trips it. Safe to delete
// in a dedicated, reviewed removal once the owner confirms the pills are gone for good; the full
// implementation also remains in git history either way.
//
// ── original component (unchanged) ────────────────────────────────────────────────────────────────
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
