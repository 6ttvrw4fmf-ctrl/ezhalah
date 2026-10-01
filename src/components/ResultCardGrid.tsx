import { Children, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { useAtLeast } from '@/lib/useAtLeast';
import { atLeast, CARD_GRID_BREAKPOINT } from '@/lib/responsive';

/** Only layout changes: children keep their original order, keys and listing callbacks. */
export function ResultCardGrid({ children }: { children: ReactNode }) {
  const { isRTL } = useI18n();
  const [slotWidth, setSlotWidth] = useState(0);
  const viewportWide = useAtLeast(CARD_GRID_BREAKPOINT);
  // Measured after layout, so SSR and the first client render both start at one column.
  const twoColumns = atLeast({ mounted: viewportWide, isWeb: true, width: slotWidth, min: CARD_GRID_BREAKPOINT });
  const itemWidth = twoColumns ? (slotWidth - 12) / 2 : '100%';
  return (
    <View testID="result-card-grid" onLayout={(e) => setSlotWidth(e.nativeEvent.layout.width)}
      style={[styles.grid, { direction: isRTL ? 'rtl' : 'ltr' }]}>
      {Children.map(children, (child) => <View style={{ width: itemWidth, minWidth: 0 }}>{child}</View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 12, marginTop: 12, alignSelf: 'stretch' },
});
