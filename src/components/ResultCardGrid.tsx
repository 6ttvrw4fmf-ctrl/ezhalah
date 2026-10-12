import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';

/** Only layout changes: children keep their original order, keys and listing callbacks. */
/** `wide` (laptop): the small row cards use the room the column already has instead of stopping at the
 *  phone's 640px (owner 2026-10-03: «look at the left and right, there is space»). */
export function ResultCardGrid({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { isRTL } = useI18n();
  return (
    <View testID="result-card-grid"
      style={[styles.grid, wide && styles.gridWide, { direction: isRTL ? 'rtl' : 'ltr' }]}>
      {Children.map(children, (child) => <View style={{ width: '100%', minWidth: 0 }}>{child}</View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12, marginTop: 12 },
  // The chat column itself stops at 940 (MAX_W in agent.tsx); stay inside it.
  gridWide: { maxWidth: 920 },
});
