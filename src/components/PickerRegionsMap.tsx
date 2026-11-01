// The deep-search picker's Saudi regions map (owner 2026-10-10: «choose websites based on coverage for
// deep search — a specific website or all; make it attractive; the user won't know the map»).
//
// A VIEW, never a query: tapping a region tells the picker which sites to list; the search restriction
// still comes only from the lit sites (selectedSources). Shapes: src/data/saRegionPaths.json —
// geoBoundaries ADM1, OpenStreetMap-derived (ODbL), so the attribution line is part of the licence.
// Fills use the LITERAL palette (useThemePalette): an SVG fill cannot digest the web var() tokens.
// On web the map is plain DOM <svg>/<path> (React DOM takes a click directly; react-native-svg's web
// onPress wires responder props onto the DOM and React rejects them); native keeps react-native-svg.
import { memo, useState } from 'react';
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

// Every region carries its name (owner 2026-10-10: «some don't even show»); the type size follows the
// room each shape has at picker size.
const LABEL_SIZE: Record<number, number> = { 1: 10, 2: 9.5, 3: 9.5, 5: 10, 7: 9.5, 9: 9, 13: 8.5, 8: 8.5, 4: 8.5, 6: 8.5, 11: 8.5, 10: 7, 12: 6.5 };
// Thumb-sized invisible tap zones for the small regions (a thumb must hit جازان/الباحة/نجران).
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
  const [hovered, setHovered] = useState<number | null>(null);
  const ar = locale === 'ar';
  const align = ar ? 'right' : 'left';
  const picked = selectedRegion === null ? null : regionMap.regions.find((region) => region.id === selectedRegion) ?? null;
  const fmt = (n: number) => n.toLocaleString(ar ? 'ar-SA-u-nu-latn' : 'en-US');
  // Web: a hover lift says «tappable» before the user commits (owner: «people won't know if it's clickable»).
  const tap = (id: number) => (IS_WEB
    ? { onClick: () => onSelectRegion(id), onMouseEnter: () => setHovered(id), onMouseLeave: () => setHovered((h) => (h === id ? null : h)) }
    : { onPress: () => onSelectRegion(id) });
  const a11y = (name: string) => (IS_WEB ? { role: 'button', 'aria-label': name } : { accessible: true, accessibilityRole: 'button', accessibilityLabel: name });
  // Solid green = «in scope»: the whole kingdom under «كل المواقع» / the lit sites' reach, or ONLY the
  // tapped region once one is tapped (owner: the entire map highlighted vs. one region highlighted).
  const isSolid = (id: number) => (selectedRegion === null ? coveredRegions.has(id) : id === selectedRegion);
  return (
    <View style={styles.wrap}>
      {/* Step 1 of the sheet (owner 2026-10-10): pick the region, then the websites below. «كل المملكة» is
          a real button, lit when nothing is tapped, so nobody has to guess what the default is. */}
      <Text style={[styles.step, { fontFamily, textAlign: align }]}>{t('Step 1 · Choose the region')}</Text>
      <View style={[styles.caption, { flexDirection: ar ? 'row-reverse' : 'row' }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !picked }}
          accessibilityLabel={t('Whole kingdom')}
          onPress={() => picked && onSelectRegion(picked.id)}
          hitSlop={6}
          style={({ pressed }: any) => [styles.kingdom, !picked && styles.kingdomOn, pressed && picked && { backgroundColor: colors.segTrack }]}
        >
          {!picked ? <Ionicons name="checkmark" size={14} color={colors.onFill} /> : null}
          <Text style={[styles.kingdomText, !picked && styles.kingdomTextOn, { fontFamily }]}>{t('Whole kingdom')}</Text>
        </Pressable>
        {/* Up to two lines (owner 2026-10-10: «9,664 إع…» — the count was cut on a phone). The row reserves
            both (styles.caption minHeight), so a region that wraps where the kingdom fits on one line never
            moves the map under the finger between taps (#6711), and one line sits centred by the chip. */}
        <Text style={[styles.captionTitle, { fontFamily, textAlign: align }]} numberOfLines={2}>
          {picked
            ? `${ar ? picked.name : `${picked.en} Region`} · ${t('{count} websites', { count: counts[picked.id] ?? 0 })} · ${t('{count} listings', { count: fmt(listings[picked.id] ?? 0) })}`
            : `${t('Saudi Arabia')} · ${t('{count} websites', { count: totalCount })}`}
        </Text>
      </View>
      {/* Always rendered: removing it on the first tap moved the map up under the user's finger, so a
          quick second tap missed its region (found in the 2026-10-10 real-user check on production). */}
      <Text style={[styles.captionHint, { fontFamily, textAlign: align }]}>{t('Tap a region to see the websites that cover it')}</Text>
      <SvgRoot width="100%" height={compact ? 236 : 256} viewBox={regionMap.viewBox} preserveAspectRatio="xMidYMid meet">
        {regionMap.regions.map((region) => {
          const count = counts[region.id] ?? 0;
          const solid = isSolid(region.id);
          const lift = !solid && count > 0 && hovered === region.id;
          // Cut-paper look: regions parted by white seams; in-scope regions solid green, a hovered one
          // lifted toward it, the rest light green, a region with no site a quiet neutral.
          return (
            <Shape
              key={region.id}
              {...(IS_WEB ? { 'data-testid': `picker-region-${region.id}` } : { testID: `picker-region-${region.id}` })}
              {...(count ? a11y(ar ? region.name : `${region.en} Region`) : {})}
              d={region.d}
              fill={solid || lift ? pal.primary : count ? pal.userBubble : pal.segTrack}
              fillOpacity={lift ? 0.55 : 1}
              stroke={pal.surface}
              strokeWidth={1.6}
              strokeLinejoin="round"
              {...(count ? tap(region.id) : {})}
              {...(IS_WEB ? { style: { cursor: count ? 'pointer' : 'default', outline: 'none', transition: 'fill 200ms ease, fill-opacity 200ms ease' } } : {})}
            />
          );
        })}
        {picked ? (
          <Shape d={picked.d} fill="none" stroke={pal.dark} strokeWidth={1.8} strokeLinejoin="round" {...(IS_WEB ? { style: { pointerEvents: 'none', filter: 'drop-shadow(0 2px 5px rgba(29,74,55,0.45))' } } : {})} />
        ) : null}
        {regionMap.regions.map((region) => {
          const isPicked = region.id === selectedRegion;
          const solid = isSolid(region.id) || (hovered === region.id && (counts[region.id] ?? 0) > 0);
          return (
            <Label
              key={`label-${region.id}`}
              x={region.cx}
              y={region.cy + 3}
              textAnchor="middle"
              fontSize={isPicked ? LABEL_SIZE[region.id] + 1.5 : LABEL_SIZE[region.id]}
              fontWeight={isPicked ? '700' : '500'}
              fontFamily={fontFamily}
              fill={solid ? pal.surface : pal.dark}
              fillOpacity={isPicked || solid ? 1 : 0.8}
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
  step: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  caption: { alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 40 },   // two caption lines, always reserved
  kingdom: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, flexShrink: 0 },
  kingdomOn: { backgroundColor: colors.selFill, borderColor: colors.primary },
  kingdomText: { fontSize: 13, lineHeight: 17, fontWeight: '500', color: colors.body },
  kingdomTextOn: { color: colors.onFill },
  captionHint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  captionTitle: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500', color: colors.ink },
  attribution: { fontSize: 10, lineHeight: 14, color: colors.muted, textAlign: 'center', marginTop: 2 },
});
