// The row above the map (owner 2026-10-31, from Zillow's «For sale ▾ | Filters»): a transaction button and a
// «تصفية» button, Ezhalah-themed. Tapping the transaction button opens a SMALL POPUP under it — «a popup, not full
// screen» — with the three deals the app knows (شراء / إيجار / إقامات قصيرة, the rent pools in
// docs/ARCHITECTURE.md §20). MULTI-SELECT (owner: «the user can select both together, then apply;
// can select all 3»): checkboxes, at least one stays chosen, the button names what is chosen. NO «apply» step
// (owner: «if the user selects one he can select the other if he wants, not click then must click apply»): a tick
// takes effect at once; the popup stays open for more ticks and closes with the X or a tap outside. Design only for now: the choice is kept here and nothing on the map reads
// it yet; the filter button opens nothing yet — pins, the list and the filter sheet come one step at a time.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';

export type MapDeal = 'buy' | 'rent' | 'short';
const DEALS: { id: MapDeal; label: string }[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'rent', label: 'Rent' },
  { id: 'short', label: 'Short stays' },
];

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

const s = StyleSheet.create({
  // Plain `row`: the document direction already lays Arabic out right-to-left (reversing it again flipped the row
  // back to the left — seen in the local preview).
  row: { alignItems: 'center', justifyContent: 'flex-start', gap: 8, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.tintLine, ...cardShadow, shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  btnActive: { backgroundColor: colors.tint, borderColor: colors.primary, borderWidth: 1.5 },
  btnHover: { borderColor: colors.primary },
  btnPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  btnText: { fontSize: 14, fontWeight: '700', color: colors.ink, includeFontPadding: false },
  btnTextActive: { color: colors.primary },
  // CENTERED, a normal popup (owner 2026-10-31: «I don't like how it's not in the centre; a small popup, normal»).
  backdrop: { flex: 1, backgroundColor: 'rgba(36,35,43,0.28)', alignItems: 'center', justifyContent: 'center', padding: 24 },
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
