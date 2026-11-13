// THE MAP'S FILTER POPUP (owner 2026-11-02: «make it like how we have it built in design … the pop up» like
// Zillow's Map Options — a centered card, title, X top right). Inside: the site's own filter, unchanged in look —
// the same OptionBox tiles and icons the Filter home uses — for category, property group, bedrooms, area and
// price. No transaction here (the «شراء ▾» button beside it already says it) and no city or district (the map
// shows where you are looking). The button at the bottom carries the live count of pins the choice leaves in
// view; pressing it closes the card and the pins follow (owner: «whatever the user keeps he gets it in terms of pins»).
//
// ON A PHONE IT IS FULL SCREEN (owner 2026-11-09, Zillow's mobile filter: «making it like this in terms of the results
// on top and full screen … we include our things»): the live count is the title («158,514 نتيجة»), X top right, and a
// bar fixed at the bottom with «مسح الكل» and «عرض الإعلانات». A wider screen keeps the centered card.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { OptionBox, FieldLabel } from '@/components/ui';
import { CATEGORIES } from '@/data/taxonomy';
import { groupsFor, groupMembers, typeArForTypes, type Macro } from '@/data/propertyTypes';
import { EMPTY_MAP_FILTER, digits, isNarrowed, type MapFilterState } from '@/lib/mapFilter';
import { pinFilterOf as pinFilterOfWith, furnitureOffered, bedsOffered, postedOffered } from '@/lib/mapFilter';
import { mapTypeScope, type PostedWindowCounts } from '@/data/remote';
import PostedWindowMenu from '@/components/PostedWindowMenu';
import { showAdsAr } from '@/lib/mapPins';
export { EMPTY_MAP_FILTER, isNarrowed, type MapFilterState } from '@/lib/mapFilter';
/** The popup's state → the pin query, with the site's own group → type labels mapping. */
export const pinFilterOf = (f: MapFilterState, deals: readonly string[] = []) => pinFilterOfWith(f, typeArForTypes, groupMembers, deals, mapTypeScope);
import { categoryImg, groupImg, typeImg, BED_IMG, RANGE_ICON, FURN_IMG } from '@/theme/propertyIcons';
import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

export default function MapFilterCard({ value, onApply, onClose, onClear, countPins, countPostedWindows, deals = [] }: {
  value: MapFilterState; onApply: (f: MapFilterState) => void; onClose: () => void;
  /** «مسح الكل» resets the MAP at once, not only the boxes here — so closing with X afterwards keeps it cleared
   *  (owner 2026-11-11: «when I click clear all then x … doesn't get reset»). */
  onClear: () => void;
  /** The map's deal choice: «الأثاث» shows only on «إيجار» alone (yearly rent), as on the Filter home. */
  deals?: readonly string[];
  /** Pins the choice leaves in the current view; null = could not count (the button then says «عرض الإعلانات»). */
  countPins: (f: MapFilterState) => Promise<number | null>;
  /** «نُشر خلال» numbers for the pins in view (any + every window); null = could not count (no numbers shown). */
  countPostedWindows?: (f: MapFilterState) => Promise<Record<string, number> | null>;
}) {
  const { t, isRTL } = useI18n();
  const phone = useWindowDimensions().width < PHONE_MAX;
  const insets = useSafeAreaInsets();
  const [f, setF] = useState<MapFilterState>(value);
  const [count, setCount] = useState<number | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(f);
  useEffect(() => {
    const my = ++seq.current;
    setCount(null);   // a number on the button is always for what is picked now (CodeRabbit #11828; live 2026-11-10: 59,686 lingered)
    const h = setTimeout(() => { countPins(f).then((n) => { if (my === seq.current) setCount(n); }); }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // GROUPS ONLY AFTER A CATEGORY (owner 2026-11-08: «commercial then residential … don't show the group until user
  // selects … similar to the filter»): «سكني» / «تجاري» come first; that category's groups appear once one is picked.
  const groups = useMemo(() => (f.category ? groupsFor(f.category as Macro) : []), [f.category]);
  // Un-picking a group drops its types too, so no hidden type keeps narrowing the pins.
  const toggleGroup = (g: string) => setF((x) => {
    const groups = x.groups.includes(g) ? x.groups.filter((y) => y !== g) : [...x.groups, g];
    const allowed = new Set(groups.flatMap((y) => groupMembers(y)));
    return { ...x, groups, types: (x.types ?? []).filter((ty) => allowed.has(ty)) };
  });
  const toggleType = (ty: string) => setF((x) => { const cur = x.types ?? []; return { ...x, types: cur.includes(ty) ? cur.filter((y) => y !== ty) : [...cur, ty] }; });
  // PROPERTY TYPE AFTER THE GROUP (owner 2026-11-10: «the filter button on the map is incomplete, no property type, just
  // group»): the picked groups' types, as on the Filter home.
  const typeChoices = useMemo(() => [...new Set(f.groups.flatMap((g) => groupMembers(g)))], [f.groups]);
  // What «تطبيق» hands the map: a furniture choice the row no longer offers is dropped (no hidden filter left behind).
  const applied0: MapFilterState = f.furnished != null && !furnitureOffered(deals, f.category) ? { ...f, furnished: null } : f;
  const applied: MapFilterState = applied0.postedWithinDays != null && !postedOffered(deals) ? { ...applied0, postedWithinDays: null } : applied0;
  // «نُشر خلال» numbers (owner 2026-11-11): the pins in VIEW for these choices, every window at once — the same count the
  // «عرض N إعلان» button makes, so «أي وقت» and the button always agree (live that day the menu counted the whole country,
  // 311,791, beside a 300,755 button). Cleared the moment the choices change, so a number on the menu is always for what
  // is picked now; a failed read leaves the numbers blank, never zeros.
  const [postedCounts, setPostedCounts] = useState<PostedWindowCounts | null>(null);
  const postedKey = JSON.stringify([{ ...f, postedWithinDays: null }, deals]);
  useEffect(() => {
    setPostedCounts(null);
    if (!postedOffered(deals) || !countPostedWindows) return;
    let live = true;
    const h = setTimeout(() => {
      countPostedWindows({ ...f, postedWithinDays: null })
        .then((c) => { if (live) setPostedCounts(c && typeof c.any === 'number' ? (c as unknown as PostedWindowCounts) : null); })
        .catch(() => { if (live) setPostedCounts(null); });
    }, 300);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postedKey]);
  const clearAll = () => { setF(EMPTY_MAP_FILTER); onClear(); };
  // Clear stays on while the MAP still has a filter, even if every box here was un-ticked by hand (review of #11818):
  // otherwise X would keep the old filter with no way to reset it from here.
  const canClear = isNarrowed(f) || isNarrowed(value);
  const toggleBed = (b: '1' | '2' | '3' | '4' | '5+') => setF((x) => ({ ...x, beds: x.beds.includes(b) ? x.beds.filter((y) => y !== b) : [...x.beds, b] }));

  return (
    <Modal transparent animationType={phone ? 'slide' : 'fade'} visible onRequestClose={onClose}>
      <View style={[s.backdrop, phone && s.backdropFull]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Close')} />
        <View style={[s.card, phone && s.cardFull]} testID={phone ? 'map-filter-full' : 'map-filter-card'}>
          {/* Title left, X top RIGHT — always (owner 2026-11-02). On a phone the title IS the live count (Zillow). */}
          {/* Physical order: in Arabic the page is RTL and a plain row would put the X on the LEFT (measured live
              2026-11-10: 16 px from the left edge). row-reverse under RTL keeps it top RIGHT (owner 2026-11-10). */}
          <View style={[s.head, { flexDirection: isRTL ? 'row-reverse' : 'row' }, phone && { paddingTop: 12 + insets.top }]}>
            <Text style={s.title} testID="map-filter-title">{t('Filter')}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Close')} testID="map-filter-close" style={s.close}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.bodyInner} keyboardShouldPersistTaps="handled">
            <FieldLabel>{t('Category')}</FieldLabel>
            <View style={s.row}>
              {CATEGORIES.map((cat) => (
                <OptionBox compact key={cat} label={t(cat)} img={categoryImg(cat)} selected={f.category === cat}
                  onPress={() => setF((x) => ({ ...x, category: x.category === cat ? null : cat, groups: [], types: [] }))} />
              ))}
            </View>
            {f.category ? (
              <>
                <FieldLabel>{t('Property group')}</FieldLabel>
                <View style={s.wrap}>
                  {groups.map((g) => (
                    <OptionBox key={g.group} label={t(g.group)} img={groupImg(g.group)} selected={f.groups.includes(g.group)} onPress={() => toggleGroup(g.group)} style={s.cell} />
                  ))}
                </View>
              </>
            ) : null}
            {typeChoices.length ? (
              <>
                <FieldLabel>{t('Property type')}</FieldLabel>
                <View style={s.wrap} testID="map-filter-types">
                  {typeChoices.map((ty) => (
                    <OptionBox key={ty} label={t(ty)} img={typeImg(ty)} selected={(f.types ?? []).includes(ty)} onPress={() => toggleType(ty)} style={s.cell} />
                  ))}
                </View>
              </>
            ) : null}
            {bedsOffered(f) ? (
              <>
            <FieldLabel>{t('Bedrooms')}</FieldLabel>
            <View style={s.wrap}>
              {(['any', '1', '2', '3', '4', '5+'] as const).map((opt) => (
                <OptionBox key={opt} label={opt === 'any' ? t('Any count') : opt} img={BED_IMG[opt]} selected={opt === 'any' ? !f.beds.length : f.beds.includes(opt)}
                  onPress={() => (opt === 'any' ? setF((x) => ({ ...x, beds: [] })) : toggleBed(opt))} style={s.cell} />
              ))}
            </View>
              </>
            ) : null}
            {/* «الأثاث» — copied from the Filter home (owner 2026-11-10: «yeah you copy the filter»): yearly rent homes only. */}
            {furnitureOffered(deals, f.category) ? (
              <>
                <FieldLabel>{t('Furniture')}</FieldLabel>
                <View style={s.wrap} testID="map-filter-furniture">
                  {([['any', null, 'Furniture: all'], ['yes', true, 'Furniture: furnished'], ['no', false, 'Furniture: unfurnished']] as const).map(([key, pref, label]) => (
                    <OptionBox key={key} label={t(label)} img={FURN_IMG[key]} selected={(f.furnished ?? null) === pref}
                      onPress={() => setF((x) => ({ ...x, furnished: pref }))} style={s.cell} />
                  ))}
                </View>
              </>
            ) : null}
            {/* «نُشر خلال» — the Filter home's row, copied (owner 2026-11-11): a floating menu, each period with its number. */}
            {postedOffered(deals) ? (
              <>
                <FieldLabel>{t('Published within')}</FieldLabel>
                <PostedWindowMenu value={f.postedWithinDays ?? null}
                  counts={postedCounts && count != null && f.postedWithinDays == null ? { ...postedCounts, any: count } : postedCounts}
                  onChange={(days) => setF((x) => ({ ...x, postedWithinDays: days }))} testID="map-filter-posted" />
              </>
            ) : null}
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
            {!phone && canClear ? (
              <Pressable onPress={clearAll} accessibilityRole="button" style={s.reset}><Text style={s.resetT}>{t('Clear all')}</Text></Pressable>
            ) : null}
          </ScrollView>
          {phone ? (
            // Fixed bottom bar (Zillow «Reset all filters» | «Apply»): clear on the start side, the button fills the rest.
            <View style={[s.foot, s.footRow, { flexDirection: isRTL ? 'row-reverse' : 'row', paddingBottom: 12 + insets.bottom }]}>
              <Pressable onPress={clearAll} disabled={!canClear} accessibilityRole="button" testID="map-filter-clear" style={s.footClear}>
                <Text style={[s.resetT, !canClear && { color: colors.muted }]}>{t('Clear all')}</Text>
              </Pressable>
              <Pressable style={[s.apply, { flex: 1 }]} onPress={() => onApply(applied)} accessibilityRole="button" testID="map-filter-apply">
                {/* The count lives in the button (owner 2026-11-11, Zillow's «See 201 rentals»), the title says «تصفية». */}
                <Text style={s.applyT}>{count === null ? t('Show listings') : isRTL ? showAdsAr(count) : t('Show {n} listings', { n: count.toLocaleString('en-US') })}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.foot}>
              <Pressable style={s.apply} onPress={() => onApply(applied)} accessibilityRole="button" testID="map-filter-apply">
                <Text style={s.applyT}>{count === null ? t('Show listings') : isRTL ? showAdsAr(count) : t('Show {n} listings', { n: count.toLocaleString('en-US') })}</Text>
              </Pressable>
            </View>
          )}
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

/** Below this width the filter is a phone screen: full screen, count on top, fixed bottom bar. */
export const PHONE_MAX = 768;

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(36,35,43,0.45)', alignItems: 'center', justifyContent: 'center', padding: 14 },
  backdropFull: { padding: 0, justifyContent: 'flex-start' },
  cardFull: { flex: 1, maxWidth: '100%', maxHeight: '100%', borderRadius: 0, borderWidth: 0 },
  footRow: { alignItems: 'center', gap: 14 },
  footClear: { paddingVertical: 10, paddingHorizontal: 4 },
  card: { width: '100%', maxWidth: 560, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.tintLine },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.tint, borderBottomWidth: 1, borderBottomColor: colors.tintLine },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyInner: { padding: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { flexBasis: '30%', flexGrow: 1 },
  rangeHead: { alignItems: 'center', gap: 8, marginTop: 6 },
  rangeLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  range: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.tintLine, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface },
  rangeOn: { borderColor: colors.primary },
  rangeSmall: { fontSize: 12, color: colors.muted },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: colors.ink, paddingVertical: 0, textAlign: 'center' },
  icon: { width: 18, height: 18 },
  reset: { alignSelf: 'center', paddingVertical: 8 },
  resetT: { color: colors.primary, fontWeight: '700' },
  foot: { padding: 12, borderTopWidth: 1, borderTopColor: colors.tintLine, backgroundColor: colors.surface },
  apply: { backgroundColor: colors.primary, borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  applyT: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
