import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';

/** Only layout changes: children keep their original order, keys and listing callbacks. */
export function ResultCardGrid({ children }: { children: ReactNode }) {
  const { isRTL } = useI18n();
  return (
    <View testID="result-card-grid"
      style={[styles.grid, { direction: isRTL ? 'rtl' : 'ltr' }]}>
      {Children.map(children, (child) => <View style={{ width: '100%', minWidth: 0 }}>{child}</View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12, marginTop: 12 },
});
