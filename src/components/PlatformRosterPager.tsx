import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAtLeast } from '@/lib/useAtLeast';
import { PLATFORM_LOGO_BREAKPOINT } from '@/lib/responsive';
import { loaderPageLayout, LOADER_PAGE_MS, loaderSlotIndices } from '@/lib/loaderPages';

/** No vertical scrolling. Resizing starts a fresh complete pass at the new page size. */
export default function PlatformRosterPager<T>({ items, renderItem, rtl, onPresented }: {
  items: T[]; renderItem: (item: T) => ReactNode; rtl: boolean; onPresented: (complete: boolean) => void;
}) {
  const { height } = useWindowDimensions();
  const wide = useAtLeast(PLATFORM_LOGO_BREAKPOINT);
  const [width, setWidth] = useState(0);
  const layout = loaderPageLayout(width, height, wide);
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={styles.container}>
    {width > 0 && <Slots key={`${layout.pageSize}:${layout.rowHeight}`} items={items} renderItem={renderItem}
      rtl={rtl} onPresented={onPresented} layout={layout} />}
  </View>;
}
function Slots<T>({ items, renderItem, rtl, onPresented, layout }: {
  items: T[]; renderItem: (item: T) => ReactNode; rtl: boolean;
  onPresented: (complete: boolean) => void; layout: ReturnType<typeof loaderPageLayout>;
}) {
  const [replacements, setReplacements] = useState(0);
  const callback = useRef(onPresented);
  callback.current = onPresented;
  const slots = Math.min(items.length, layout.pageSize);
  const remaining = items.length - slots;
  useLayoutEffect(() => { callback.current(slots === 0); }, [slots]);
  useEffect(() => {
    if (slots === 0) return;
    // Hold the first and last sets long enough to read; replace one tile at a time
    // between them. A full grid stays visible, including the final partial set.
    const settled = replacements >= remaining;
    const delay = replacements === 0 || settled ? LOADER_PAGE_MS : LOADER_PAGE_MS / slots;
    const timer = setTimeout(() => {
      if (settled) callback.current(true);
      else setReplacements(n => n + 1);
    }, delay);
    return () => clearTimeout(timer);
  }, [replacements, remaining, slots]);
  return (
    <View style={[styles.grid, { height: layout.rows * layout.rowHeight, flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      {loaderSlotIndices(items.length, slots, replacements).map(index =>
        <View key={index} style={{ width: `${100 / layout.columns}%`, height: layout.rowHeight, paddingHorizontal: 2 }}>
          {renderItem(items[index])}
        </View>)}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { alignSelf: 'stretch' },
  grid: { flexWrap: 'wrap', alignContent: 'flex-start' },
});
