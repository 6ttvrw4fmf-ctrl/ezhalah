// The deep-search picker's Saudi regions map (owner 2026-10-10: «make it attractive, user can select
// within the map … highlight the entire region so users are aware of where they cover»).
//
// A VIEW, never a query: tapping a region tells the picker which sites to list; the search restriction
// still comes only from the lit sites (selectedSources). Shapes: src/data/saRegionPaths.json —
// geoBoundaries ADM1, OpenStreetMap-derived (ODbL), so the attribution line is part of the licence.
// Fills use the LITERAL palette (useThemePalette): an SVG fill cannot digest the web var() tokens.
// On web the map is plain DOM <svg>/<path> (React DOM takes a click directly; react-native-svg's web
// onPress wires responder props onto the DOM and React rejects them); native keeps react-native-svg.
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** The region's display name — the list heading while a region is tapped. */
export function regionLabel(id: number, locale: 'ar' | 'en'): string {
  const region = regionMap.regions.find((r) => r.id === id);
  return !region ? '' : locale === 'ar' ? region.name : `${region.en} Region`;
}

const IS_WEB = Platform.OS === 'web';
const SvgRoot: any = IS_WEB ? 'svg' : Svg;
const Shape: any = IS_WEB ? 'path' : Path;
import Ionicons from '@expo/vector-icons/Ionicons';
import regionMap from '@/data/saRegionPaths.json';
import { useThemePalette } from '@/lib/appearance';
import { colors, radius } from '@/theme/tokens';

type Props = {
  locale: 'ar' | 'en';
  t: (en: string, vars?: Record<string, string | number>) => string;
  fontFamily?: string;
  /** The tapped catalogue region, or null = the whole kingdom. */
  selectedRegion: number | null;
  /** Regions the lit sites have listings in — the map glows there. */
  coveredRegions: Set<number>;
  /** Offered sites per region; a region with none is quiet and inert. */
  counts: Record<number, number>;
  onSelectRegion: (id: number) => void;
  compact: boolean;
};

function PickerRegionsMap({ locale, t, fontFamily, selectedRegion, coveredRegions, counts, onSelectRegion, compact }: Props) {
  const pal = useThemePalette();
  const ar = locale === 'ar';
  const align = ar ? 'right' : 'left';
  const picked = selectedRegion === null ? null : regionMap.regions.find((region) => region.id === selectedRegion) ?? null;
  return (
    <View style={styles.wrap}>
      <View style={[styles.caption, { flexDirection: ar ? 'row-reverse' : 'row' }]}>
        {picked ? (
          <>
            <Text style={[styles.captionTitle, { fontFamily, textAlign: align }]} numberOfLines={1}>
              {ar ? picked.name : `${picked.en} Region`} · {t('{count} websites', { count: counts[picked.id] ?? 0 })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('All regions')}
              onPress={() => onSelectRegion(picked.id)}
              hitSlop={6}
              style={({ pressed }: any) => [styles.clear, pressed && { backgroundColor: colors.segTrack }]}
            >
              <Ionicons name="close" size={13} color={colors.body} />
              <Text style={[styles.clearText, { fontFamily }]}>{t('All regions')}</Text>
            </Pressable>
          </>
        ) : (
          <Text style={[styles.captionHint, { fontFamily, textAlign: align }]}>{t('Tap a region to see the websites that cover it')}</Text>
        )}
      </View>
      <SvgRoot width="100%" height={compact ? 196 : 224} viewBox={regionMap.viewBox} preserveAspectRatio="xMidYMid meet">
        {regionMap.regions.map((region) => {
          const count = counts[region.id] ?? 0;
          const isPicked = region.id === selectedRegion;
          const covered = !isPicked && coveredRegions.has(region.id);
          // Cut-paper look: light-green regions parted by white seams; the picked one solid green, the
          // lit sites' reach a softer green, a region with no site a quiet neutral.
          return (
            <Shape
              key={region.id}
              {...(IS_WEB ? { 'data-testid': `picker-region-${region.id}` } : { testID: `picker-region-${region.id}` })}
              d={region.d}
              fill={isPicked || covered ? pal.primary : count ? pal.userBubble : pal.segTrack}
              fillOpacity={covered ? 0.45 : 1}
              stroke={pal.surface}
              strokeWidth={1.6}
              strokeLinejoin="round"
              {...(count ? (IS_WEB ? { onClick: () => onSelectRegion(region.id), style: { cursor: 'pointer' } } : { onPress: () => onSelectRegion(region.id) }) : {})}
            />
          );
        })}
        {picked ? <Shape d={picked.d} fill="none" stroke={pal.dark} strokeWidth={1.8} strokeLinejoin="round" {...(IS_WEB ? { style: { pointerEvents: 'none' } } : {})} /> : null}
      </SvgRoot>
      <Text style={[styles.attribution, { fontFamily }]}>{t('Map data © OpenStreetMap contributors')}</Text>
    </View>
  );
}

export default memo(PickerRegionsMap);

const styles = StyleSheet.create({
  wrap: { paddingTop: 4, paddingBottom: 2, paddingHorizontal: 10 },
  caption: { alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 },
  captionHint: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, color: colors.muted },
  captionTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500', color: colors.ink },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  clearText: { fontSize: 12, lineHeight: 16, color: colors.body },
  attribution: { fontSize: 10, lineHeight: 14, color: colors.muted, textAlign: 'center', marginTop: 2 },
});
