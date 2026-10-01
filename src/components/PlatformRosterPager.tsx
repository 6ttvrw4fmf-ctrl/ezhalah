import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors } from '@/theme/tokens';
import { useAtLeast } from '@/lib/useAtLeast';
import { PLATFORM_LOGO_BREAKPOINT } from '@/lib/responsive';
import { loaderPageLayout, LOADER_PAGE_MS, nextUnseenPage } from '@/lib/loaderPages';

/** No vertical scrolling. Resizing starts a fresh complete pass at the new page size. */
export default function PlatformRosterPager<T>({ items, renderItem, rtl, onPresented }: {
  items: T[]; renderItem: (item: T) => ReactNode; rtl: boolean; onPresented: (complete: boolean) => void;
}) {
  const { height } = useWindowDimensions();
  const wide = useAtLeast(PLATFORM_LOGO_BREAKPOINT);
  const [width, setWidth] = useState(0);
  const layout = loaderPageLayout(width, height, wide);
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={styles.container}>
    {width > 0 && <Pages key={`${layout.pageSize}:${layout.rowHeight}`} items={items} renderItem={renderItem}
      rtl={rtl} onPresented={onPresented} layout={layout} />}
  </View>;
}
function Pages<T>({ items, renderItem, rtl, onPresented, layout }: {
  items: T[]; renderItem: (item: T) => ReactNode; rtl: boolean;
  onPresented: (complete: boolean) => void; layout: ReturnType<typeof loaderPageLayout>;
}) {
  const [page, setPage] = useState(0);
  const seen = useRef(new Set<number>());
  const callback = useRef(onPresented);
  callback.current = onPresented;
  const total = Math.ceil(items.length / layout.pageSize);
  const touchX = useRef(0);
  useLayoutEffect(() => { callback.current(total === 0); }, [total]);
  useEffect(() => {
    if (total === 0 || seen.current.size === total) return;
    // Count actual visible dwell, not time since search started. Manual navigation resets this
    // timer; it cannot skip an unseen page or complete the presentation early.
    const timer = setTimeout(() => {
      seen.current.add(page);
      const next = nextUnseenPage(seen.current, page, total);
      if (next === null) callback.current(true);
      else setPage(next);
    }, LOADER_PAGE_MS);
    return () => clearTimeout(timer);
  }, [page, total]);
  const move = (step: number) => setPage(p => (p + step + total) % total);
  return <>
    <View style={[styles.grid, { height: layout.rows * layout.rowHeight, flexDirection: rtl ? 'row-reverse' : 'row' }]}
      onTouchStart={e => { touchX.current = e.nativeEvent.pageX; }}
      onTouchEnd={e => {
        const delta = e.nativeEvent.pageX - touchX.current;
        if (Math.abs(delta) > 45) move((delta > 0 ? 1 : -1) * (rtl ? 1 : -1));
      }}>
      {items.slice(page * layout.pageSize, (page + 1) * layout.pageSize).map((item, i) =>
        <View key={`${page}:${i}`} style={{ width: `${100 / layout.columns}%`, height: layout.rowHeight, paddingHorizontal: 2 }}>
          {renderItem(item)}
        </View>)}
    </View>
    {total > 1 && <View style={[styles.controls, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'الصفحة السابقة' : 'Previous page'} onPress={() => move(-1)} style={styles.arrow}>
        <Text style={styles.arrowText}>{rtl ? '›' : '‹'}</Text>
      </Pressable>
      <Text style={styles.counter}>{page + 1} / {total}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'الصفحة التالية' : 'Next page'} onPress={() => move(1)} style={styles.arrow}>
        <Text style={styles.arrowText}>{rtl ? '‹' : '›'}</Text>
      </Pressable>
    </View>}
  </>;
}
const styles = StyleSheet.create({
  container: { alignSelf: 'stretch' },
  grid: { flexWrap: 'wrap', alignContent: 'flex-start' },
  controls: { alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 8 },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: colors.primary, fontSize: 26 },
  counter: { color: colors.muted, fontSize: 12, minWidth: 64, textAlign: 'center', writingDirection: 'ltr' },
});
