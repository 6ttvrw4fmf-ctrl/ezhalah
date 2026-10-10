// The deep-search picker's Saudi regions map (owner 2026-10-10: «choose websites based on coverage for
// deep search — a specific website or all; make it attractive; the user won't know the map»).
//
// A VIEW, never a query: tapping a region tells the picker which sites to list; the search restriction
// still comes only from the lit sites (selectedSources). Shapes: src/data/saRegionPaths.json —
// geoBoundaries ADM1, OpenStreetMap-derived (ODbL), so the attribution line is part of the licence.
// Fills use the LITERAL palette (useThemePalette): an SVG fill cannot digest the web var() tokens.
// On web the map is plain DOM <svg>/<path> (React DOM takes a click directly; react-native-svg's web
// onPress wires responder props onto the DOM and React rejects them); native keeps react-native-svg.
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import regionMap from '@/data/saRegionPaths.json';
import { useThemePalette } from '@/lib/appearance';
import { colors, radius } from '@/theme/tokens';

/** The region's display name — the list heading while a region is tapped. */
export function regionLabel(id: number, locale: 'ar' | 'en'): string {
  const region = regionMap.regions.find((r) => r.id === id);
  return !region ? '' : locale === 'ar' ? region.name : `${region.en} Region`;
}

const IS_WEB = Platform.OS === 'web';
const SvgRoot: any = IS_WEB ? 'svg' : Svg;
const Shape: any = IS_WEB ? 'path' : Path;
const Label: any = IS_WEB ? 'text' : SvgText;
const Hit: any = IS_WEB ? 'circle' : Circle;

// Names drawn on the map: only the regions wide enough to carry one at picker size.
const LABELLED = new Set([1, 2, 3, 5, 6, 7, 9]);
// Thumb-sized invisible tap zones for the small regions (owner plan: a thumb must hit جازان/الباحة/نجران).
const SMALL = new Set([10, 11, 12]);
// Map labels: the everyday short names (the full catalogue name stays in the caption and headings).
const SHORT_AR: Record<number, string> = { 2: 'مكة', 3: 'المدينة', 9: 'الشمالية' };
const short = (id: number, name: string) => SHORT_AR[id] ?? name.replace(/^(منطقة |المنطقة )/, '');

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
  /** Measured listings per region across the offered sites. */
  listings: Record<number, number>;
  /** All offered sites — the whole-kingdom caption. */
  totalCount: number;
  onSelectRegion: (id: number) => void;
  compact: boolean;
};

function PickerRegionsMap({ locale, t, fontFamily, selectedRegion, coveredRegions, counts, listings, totalCount, onSelectRegion, compact }: Props) {
  const pal = useThemePalette();
  const ar = locale === 'ar';
  const align = ar ? 'right' : 'left';
  const picked = selectedRegion === null ? null : regionMap.regions.find((region) => region.id === selectedRegion) ?? null;
  const fmt = (n: number) => n.toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-US');
  const tap = (id: number) => (IS_WEB ? { onClick: () => onSelectRegion(id), style: { cursor: 'pointer' } } : { onPress: () => onSelectRegion(id) });
  const a11y = (name: string) => (IS_WEB ? { role: 'button', 'aria-label': name, tabIndex: 0 } : { accessible: true, accessibilityRole: 'button', accessibilityLabel: name });
  return (
    <View style={styles.wrap}>
      {/* What this part is for — the user should not have to work the map out (owner). */}
      <Text style={[styles.eyebrow, { fontFamily, textAlign: align }]}>
        <Ionicons name="map-outline" size={13} color={colors.primary} />{'  '}{t('By coverage')}
      </Text>
      <View style={[styles.caption, { flexDirection: ar ? 'row-reverse' : 'row' }]}>
        {picked ? (
          <>
            <Text style={[styles.captionTitle, { fontFamily, textAlign: align }]} numberOfLines={1}>
              {ar ? picked.name : `${picked.en} Region`} · {t('{count} websites', { count: counts[picked.id] ?? 0 })} · {t('{count} listings', { count: fmt(listings[picked.id] ?? 0) })}
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
          <Text style={[styles.captionTitle, { fontFamily, textAlign: align }]} numberOfLines={1}>
            {t('Saudi Arabia')} · {t('{count} websites', { count: totalCount })}
          </Text>
        )}
      </View>
      {picked ? null : <Text style={[styles.captionHint, { fontFamily, textAlign: align }]}>{t('Tap a region to see the websites that cover it')}</Text>}
      <SvgRoot width="100%" height={compact ? 236 : 256} viewBox={regionMap.viewBox} preserveAspectRatio="xMidYMid meet">
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
              {...(count ? a11y(ar ? region.name : `${region.en} Region`) : {})}
              d={region.d}
              fill={isPicked || covered ? pal.primary : count ? pal.userBubble : pal.segTrack}
              fillOpacity={covered ? 0.45 : 1}
              stroke={pal.surface}
              strokeWidth={1.6}
              strokeLinejoin="round"
              {...(count ? tap(region.id) : {})}
              {...(IS_WEB ? { style: { cursor: count ? 'pointer' : 'default', transition: 'fill 200ms ease, fill-opacity 200ms ease' } } : {})}
            />
          );
        })}
        {picked ? (
          <Shape d={picked.d} fill="none" stroke={pal.dark} strokeWidth={1.8} strokeLinejoin="round" {...(IS_WEB ? { style: { pointerEvents: 'none', filter: 'drop-shadow(0 2px 5px rgba(29,74,55,0.45))' } } : {})} />
        ) : null}
        {regionMap.regions.filter((region) => LABELLED.has(region.id) || region.id === selectedRegion).map((region) => {
          const isPicked = region.id === selectedRegion;
          const covered = coveredRegions.has(region.id);
          return (
            <Label
              key={`label-${region.id}`}
              x={region.cx}
              y={region.cy + 3}
              textAnchor="middle"
              fontSize={isPicked ? 11 : 9.5}
              fontWeight={isPicked ? '600' : '500'}
              fontFamily={fontFamily}
              fill={isPicked || covered ? pal.surface : pal.dark}
              fillOpacity={isPicked ? 1 : 0.85}
              {...(IS_WEB ? { style: { pointerEvents: 'none', userSelect: 'none' } } : {})}
            >
              {ar ? short(region.id, region.name) : region.en}
            </Label>
          );
        })}
        {regionMap.regions.filter((region) => SMALL.has(region.id) && (counts[region.id] ?? 0) > 0).map((region) => (
          <Hit key={`hit-${region.id}`} cx={region.cx} cy={region.cy} r={16} fill="transparent" {...tap(region.id)} {...(IS_WEB ? { 'aria-hidden': true } : {})} />
        ))}
      </SvgRoot>
      <Text style={[styles.attribution, { fontFamily }]}>{t('Map data © OpenStreetMap contributors')}</Text>
    </View>
  );
}

export default memo(PickerRegionsMap);

const styles = StyleSheet.create({
  wrap: { paddingTop: 10, paddingBottom: 2, paddingHorizontal: 10 },
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: colors.primary, marginBottom: 4 },
  caption: { alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 },
  captionHint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  captionTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500', color: colors.ink },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  clearText: { fontSize: 12, lineHeight: 16, color: colors.body },
  attribution: { fontSize: 10, lineHeight: 14, color: colors.muted, textAlign: 'center', marginTop: 2 },
});
