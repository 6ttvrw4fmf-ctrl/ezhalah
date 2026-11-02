// THE MAP'S FILTER POPUP (owner 2026-11-02: «make it like how we have it built in design … the pop up» like
// Zillow's Map Options — a centered card, title, X top right). Inside: the site's own filter, unchanged in look —
// the same OptionBox tiles and icons the Filter home uses — for category, property group, bedrooms, area and
// price. No transaction here (the «شراء ▾» button beside it already says it) and no city or district (the map
// shows where you are looking). The button at the bottom carries the live count of pins the choice leaves in
// view; pressing it closes the card and the pins follow (owner: «whatever the user keeps he gets it in terms of pins»).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { OptionBox, FieldLabel } from '@/components/ui';
import { CATEGORIES } from '@/data/taxonomy';
import { groupsFor, typeArForTypes, type Macro } from '@/data/propertyTypes';
import { EMPTY_MAP_FILTER, digits, isNarrowed, type MapFilterState } from '@/lib/mapFilter';
import { pinFilterOf as pinFilterOfWith } from '@/lib/mapFilter';
export { EMPTY_MAP_FILTER, isNarrowed, type MapFilterState } from '@/lib/mapFilter';
/** The popup's state → the pin query, with the site's own group → type labels mapping. */
export const pinFilterOf = (f: MapFilterState) => pinFilterOfWith(f, typeArForTypes);
import { categoryImg, groupImg, BED_IMG, RANGE_ICON } from '@/theme/propertyIcons';
import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

export default function MapFilterCard({ value, onApply, onClose, countPins }: {
  value: MapFilterState; onApply: (f: MapFilterState) => void; onClose: () => void;
  /** Pins the choice leaves in the current view; null = could not count (the button then says «عرض الإعلانات»). */
  countPins: (f: MapFilterState) => Promise<number | null>;
}) {
  const { t, isRTL } = useI18n();
  const [f, setF] = useState<MapFilterState>(value);
  const [count, setCount] = useState<number | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(f);
  useEffect(() => {
    const my = ++seq.current;
    const h = setTimeout(() => { countPins(f).then((n) => { if (my === seq.current) setCount(n); }); }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const groups = useMemo(() => (f.category ? groupsFor(f.category as Macro) : [...groupsFor('Residential'), ...groupsFor('Commercial')]), [f.category]);
  const toggleGroup = (g: string) => setF((x) => ({ ...x, groups: x.groups.includes(g) ? x.groups.filter((y) => y !== g) : [...x.groups, g] }));
  const toggleBed = (b: '1' | '2' | '3' | '4' | '5+') => setF((x) => ({ ...x, beds: x.beds.includes(b) ? x.beds.filter((y) => y !== b) : [...x.beds, b] }));

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Close')} />
        <View style={s.card} testID="map-filter-card">
          {/* Title left, X top RIGHT — always (owner 2026-11-02). */}
          <View style={s.head}>
            <Text style={s.title}>{t('Filter')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Close')} testID="map-filter-close" style={s.close}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.bodyInner} keyboardShouldPersistTaps="handled">
            <FieldLabel>{t('Category')}</FieldLabel>
            <View style={s.row}>
              {CATEGORIES.map((cat) => (
                <OptionBox compact key={cat} label={t(cat)} img={categoryImg(cat)} selected={f.category === cat}
                  onPress={() => setF((x) => ({ ...x, category: x.category === cat ? null : cat, groups: [] }))} />
              ))}
            </View>
            <FieldLabel>{t('Property group')}</FieldLabel>
            <View style={s.wrap}>
              {groups.map((g) => (
                <OptionBox key={g.group} label={t(g.group)} img={groupImg(g.group)} selected={f.groups.includes(g.group)} onPress={() => toggleGroup(g.group)} style={s.cell} />
              ))}
            </View>
            <FieldLabel>{t('Bedrooms')}</FieldLabel>
            <View style={s.wrap}>
              {(['any', '1', '2', '3', '4', '5+'] as const).map((opt) => (
                <OptionBox key={opt} label={opt === 'any' ? t('Any count') : opt} img={BED_IMG[opt]} selected={opt === 'any' ? !f.beds.length : f.beds.includes(opt)}
                  onPress={() => (opt === 'any' ? setF((x) => ({ ...x, beds: [] })) : toggleBed(opt))} style={s.cell} />
              ))}
            </View>
            <View style={[s.rangeHead, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><Image source={RANGE_ICON.areaHead} style={s.icon} /><Text style={s.rangeLabel}>{t('Area (m²)')}</Text></View>
            <View style={[s.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Range icon={RANGE_ICON.areaFrom} label={t('From')} unit={t('m²')} value={f.areaMin} onChange={(v) => setF((x) => ({ ...x, areaMin: digits(v) }))} testID="map-filter-area-min" />
              <Range icon={RANGE_ICON.areaTo} label={t('To')} unit={t('m²')} value={f.areaMax} onChange={(v) => setF((x) => ({ ...x, areaMax: digits(v) }))} testID="map-filter-area-max" />
            </View>
            <View style={[s.rangeHead, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><Image source={RANGE_ICON.priceHead} style={s.icon} /><Text style={s.rangeLabel}>{t('Price')}</Text></View>
            <View style={[s.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Range icon={RANGE_ICON.priceFrom} label={t('From')} unit={t('SAR')} value={f.priceMin} onChange={(v) => setF((x) => ({ ...x, priceMin: digits(v) }))} testID="map-filter-price-min" />
              <Range icon={RANGE_ICON.priceTo} label={t('To')} unit={t('SAR')} value={f.priceMax} onChange={(v) => setF((x) => ({ ...x, priceMax: digits(v) }))} testID="map-filter-price-max" />
            </View>
            {isNarrowed(f) ? (
              <Pressable onPress={() => setF(EMPTY_MAP_FILTER)} accessibilityRole="button" style={s.reset}><Text style={s.resetT}>{t('Clear all')}</Text></Pressable>
            ) : null}
          </ScrollView>
          <View style={s.foot}>
            <Pressable style={s.apply} onPress={() => onApply(f)} accessibilityRole="button" testID="map-filter-apply">
              <Text style={s.applyT}>{count === null ? t('Show listings') : t('Show {n} listings', { n: count.toLocaleString('en-US') })}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Range({ icon, label, unit, value, onChange, testID }: { icon: unknown; label: string; unit: string; value: string; onChange: (v: string) => void; testID: string }) {
  const shown = value ? Number(value).toLocaleString('en-US') : '';
  return (
    <View style={[s.range, value ? s.rangeOn : null]}>
      <Image source={icon as never} style={s.icon} />
      <Text style={s.rangeSmall}>{label}</Text>
      <TextInput testID={testID} style={s.input} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} value={shown} onChangeText={onChange} maxLength={13} />
      <Text style={s.rangeSmall}>{unit}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(36,35,43,0.45)', alignItems: 'center', justifyContent: 'center', padding: 14 },
  card: { width: '100%', maxWidth: 560, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.tintLine },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.tint, borderBottomWidth: 1, borderBottomColor: colors.tintLine },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0 },
  bodyInner: { padding: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexBasis: '30%', flexGrow: 1 },
  rangeHead: { alignItems: 'center', gap: 8, marginTop: 6 },
  rangeLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  range: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.tintLine, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface },
  rangeOn: { borderColor: colors.primary },
  rangeSmall: { fontSize: 12, color: colors.muted },
  input: { flex: 1, minWidth: 40, fontSize: 15, color: colors.ink, paddingVertical: 0, textAlign: 'center' },
  icon: { width: 18, height: 18 },
  reset: { alignSelf: 'center', paddingVertical: 8 },
  resetT: { color: colors.primary, fontWeight: '700' },
  foot: { padding: 12, borderTopWidth: 1, borderTopColor: colors.tintLine, backgroundColor: colors.surface },
  apply: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  applyT: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
