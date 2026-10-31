// The row above the map (owner 2026-10-31, from Zillow's «For sale ▾ | Filters»): a transaction button and a
// «تصفية» button, Ezhalah-themed. Tapping the transaction button opens a SMALL POPUP under it — «a popup, not full
// screen» — with the three deals the app knows (شراء / إيجار / إقامات قصيرة, the rent pools in
// docs/ARCHITECTURE.md §20). MULTI-SELECT (owner: «the user can select both together, then apply;
// can select all 3»): checkboxes, at least one stays chosen, the button names what is chosen. NO «apply» step
// (owner: «if the user selects one he can select the other if he wants, not click then must click apply»): a tick
// takes effect at once; the popup stays open for more ticks and closes with the X or a tap outside. Design only for now: the choice is kept here and nothing on the map reads
// it yet; the filter button opens nothing yet — pins, the list and the filter sheet come one step at a time.
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { suggestPlaces, flyToPlace, type PlaceSuggestion } from '@/components/AppleMap';

export type MapDeal = 'buy' | 'rent' | 'short';
const DEALS: { id: MapDeal; label: string }[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'rent', label: 'Rent' },
  { id: 'short', label: 'Short stays' },
];

/** The search field above the row — Apple Maps' own place search (owner 2026-10-31: «this search connected to
 *  Apple Maps, like how a user searches in Apple Maps»): typing shows Apple's suggestions for Saudi Arabia under the
 *  field; picking one glides the map there. Suggestions only; nothing filters listings yet. */
export function MapSearchBar() {
  const { t, isRTL, locale } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceSuggestion[]>([]);
  const [focused, setFocused] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (q.trim().length < 2) { setHits([]); return; }
    const h = setTimeout(() => { suggestPlaces(q, locale).then((r) => { if (seq.current === id) setHits(r); }); }, 220);
    return () => clearTimeout(h);
  }, [q, locale]);
  const pick = (p: PlaceSuggestion) => {
    setQ(p.displayLines[0]); setHits([]); setFocused(false);
    flyToPlace(p);
  };
  const open = focused && hits.length > 0;
  return (
    <View style={s.searchWrap}>
      <View style={s.search}>
        <Ionicons name="search" size={16} color={colors.muted} />
        <TextInput
          style={[s.searchInput, { textAlign: isRTL ? 'right' : 'left' }]}
          value={q}
          onChangeText={setQ}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={t('Region, city, landmark or district')}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t('Search')}
          autoCorrect={false}
          testID="map-search"
        />
        {q ? (
          <Pressable onPress={() => { setQ(''); setHits([]); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Close')}>
            <Ionicons name="close-circle" size={17} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={s.hits} testID="map-search-hits">
          {hits.slice(0, 6).map((p, i) => (
            <Pressable key={i} style={({ hovered }: any) => [s.hit, hovered && s.optionHover]} onPress={() => pick(p)} accessibilityRole="button">
              <Ionicons name="location-outline" size={16} color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.hitT} numberOfLines={1}>{p.displayLines[0]}</Text>
                {p.displayLines[1] ? <Text style={s.hitSub} numberOfLines={1}>{p.displayLines[1]}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function MapDealRow() {
  const { t, isRTL } = useI18n();
  const [deals, setDeals] = useState<MapDeal[]>(['buy']);
  const [open, setOpen] = useState(false);
  // Untick only while another stays ticked: the map always has at least one deal.
  const toggle = (id: MapDeal) => setDeals((d) => (d.includes(id) ? (d.length > 1 ? d.filter((x) => x !== id) : d) : DEALS.filter((x) => x.id === id || d.includes(x.id)).map((x) => x.id)));
  const label = deals.length === DEALS.length ? t('All') : DEALS.filter((d) => deals.includes(d.id)).map((d) => t(d.label)).join(t(', '));

  return (
    // On the physical LEFT in both languages, the transaction button FIRST (leftmost) and «تصفية» beside it
    // (owner: «push this to the left»; «put the thing first, buy then filter»). In an RTL document `row` runs
    // right→left, so Arabic reverses it to read left→right from the left edge.
    <View style={[s.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      {/* The transaction button: the chosen deal, outlined in plum so it reads as «this is set». */}
      <Pressable
        style={({ pressed, hovered }: any) => [s.btn, s.btnActive, hovered && s.btnHover, pressed && s.btnPressed]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('Transaction')}
        testID="map-deal-btn"
      >
        <Text style={[s.btnText, s.btnTextActive]} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-down" size={15} color={colors.primary} />
      </Pressable>
      {/* «تصفية» beside it — the filter sheet is the next step; the button is here so the row is complete. */}
      <Pressable
        style={({ pressed, hovered }: any) => [s.btn, hovered && s.btnHover, pressed && s.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel={t('Filter')}
        testID="map-filter-btn"
      >
        <Ionicons name="options-outline" size={17} color={colors.ink} />
        <Text style={s.btnText}>{t('Filter')}</Text>
        <Ionicons name="chevron-down" size={15} color={colors.ink} />
      </Pressable>

      {/* The popup: a small card under the row, not a full-screen sheet. A transparent Modal so a tap anywhere
          outside closes it, like a menu. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t('Close')}>
          <Pressable style={s.card} onPress={() => {}} testID="map-deal-popup">
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>{t('Transaction')}</Text>
              {/* The X on the physical RIGHT, always, in both languages (owner: «keep the x on the right, no matter what»). */}
              <Pressable style={s.close} onPress={() => setOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Close')}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {DEALS.map((d) => {
              const on = deals.includes(d.id);
              return (
                <Pressable
                  key={d.id}
                  style={({ hovered }: any) => [s.option, hovered && s.optionHover]}
                  onPress={() => toggle(d.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  testID={`map-deal-${d.id}`}
                >
                  <View style={[s.box, on && s.boxOn]}>{on ? <Ionicons name="checkmark" size={15} color={colors.onFill} /> : null}</View>
                  <Text style={[s.optionText, on && s.optionTextOn]}>{t(d.label)}</Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const GLASS = 'rgba(255,255,255,0.42)';
const GLASS_ON = 'rgba(241,238,244,0.7)';

const s = StyleSheet.create({
  // BLENDED into the sky, not white (owner 2026-10-31: «I don't like how it's white, blend it more into the
  // background»): a translucent fill the clouds show through, the pill's own hairline border, no drop shadow.
  searchWrap: { zIndex: 3 },
  hits: { position: 'absolute', top: 52, left: 0, right: 0, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.tintLine, padding: 6, ...cardShadow, shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  hit: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10 },
  hitT: { fontSize: 14, fontWeight: '700', color: colors.ink },
  hitSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: GLASS, borderWidth: 1, borderColor: colors.tintLine, marginTop: 10 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, /* ≥16px: iOS Safari zooms into any smaller input (verify-input-font-no-ios-zoom) */ color: colors.ink, paddingVertical: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  // Plain `row`: the document direction already lays Arabic out right-to-left (reversing it again flipped the row
  // back to the left — seen in the local preview).
  // Tight under the search field (owner: «the box is very big and a lot of space between it and the buttons»).
  row: { alignItems: 'center', justifyContent: 'flex-start', gap: 8, marginTop: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: GLASS, borderWidth: 1, borderColor: colors.tintLine },
  btnActive: { backgroundColor: GLASS_ON, borderColor: colors.primary, borderWidth: 1.5 },
  btnHover: { borderColor: colors.primary },
  btnPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  btnText: { fontSize: 14, fontWeight: '700', color: colors.ink, includeFontPadding: false },
  btnTextActive: { color: colors.primary },
  // CENTERED, a normal popup (owner 2026-10-31: «I don't like how it's not in the centre; a small popup, normal»).
  // Pinned to the WHOLE screen, not `flex: 1`: on iPhone Safari the modal wrapper does not stretch, so a flex child
  // collapsed to its content and the card sat at the top (owner 2026-10-31: «on the phone it doesn't pop up in the
  // centre of the screen»). Explicit edges centre it on every browser.
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(36,35,43,0.28)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 320, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.tintLine, padding: 18, ...cardShadow, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  cardHead: { minHeight: 28, justifyContent: 'center', marginBottom: 6, paddingRight: 32 },
  close: { position: 'absolute', right: 0, top: 0, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 10 },
  optionHover: { backgroundColor: colors.tint },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: colors.primary, backgroundColor: colors.selFill },
  optionText: { fontSize: 15, color: colors.ink },
  optionTextOn: { fontWeight: '700', color: colors.primary },
});
