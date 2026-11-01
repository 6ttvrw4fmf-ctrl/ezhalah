import { Children, useEffect, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useI18n } from '@/i18n';
import { GLINT_CELL_PROPS, installScrollCalm, watchGlintCells } from '@/lib/scrollCalm';

/** Only layout changes: children keep their original order, keys and listing callbacks. */
/** `wide` (laptop): the cards use the room the column already has instead of stopping at the
 *  phone's 640px (owner 2026-10-03: «look at the left and right, there is space»).
 *  `cols` (laptop, 2026-10-11): the photo-first card sits in a real grid — 3 across when nothing is
 *  open beside the results, 2 across when the ad pane is open — and the grid may run a little wider
 *  than the 940px chat column so the cards fill the screen (owner: «cover the entire screen»). */
export function ResultCardGrid({ children, wide = false, cols }: { children: ReactNode; wide?: boolean; cols?: 2 | 3 }) {
  const { isRTL } = useI18n();
  const gridded = Platform.OS === 'web' && !!cols;
  const gridRef = useRef<View>(null);
  // THE LIVE-ANIMATION BUDGET (src/lib/scrollCalm.ts): every cell is a glint cell and the observer marks the ones near
  // the screen, so a 500-card list keeps ~50 live animations at rest instead of 1,500, and none while scrolling.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = gridRef.current as unknown as HTMLElement | null;
    if (!el) return;
    installScrollCalm();
    return watchGlintCells(el);
  }, []);
  return (
    <View ref={gridRef} testID="result-card-grid"
      style={[
        styles.grid, wide && styles.gridWide,
        gridded && styles.gridCols,
        gridded && cols === 3 && styles.gridThree,
        gridded && cols === 2 && styles.gridTwo,
        { direction: isRTL ? 'rtl' : 'ltr' },
      ]}>
      {Children.map(children, (child) => <View {...GLINT_CELL_PROPS} style={{ width: '100%', minWidth: 0 }}>{child}</View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12, marginTop: 12 },
  // The chat column itself stops at 940 (MAX_W in agent.tsx); stay inside it.
  gridWide: { maxWidth: 920 },
  // Web-only CSS grid (the laptop is web). A flex column would stack the cards one under another.
  // Each card is content-sized: no blank reserved rows inside a card (owner 2026-10-11 «a lot of blank white
  // space»); a row is as tall as its tallest card and the shorter ones simply end earlier.
  gridCols: { display: 'grid', gap: 16, alignItems: 'start' } as object,
  // 3 across: allowed to run 120px past the 940 column, never past the screen minus the sidebar.
  gridThree: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', width: 'calc(100% + 120px)', maxWidth: 'min(1100px, calc(100vw - 340px))' } as object,
  // 2 across (ad pane open): stays inside whatever the narrowed column gives it.
  gridTwo: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: '100%' } as object,
});
