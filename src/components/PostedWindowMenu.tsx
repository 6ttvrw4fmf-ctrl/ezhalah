// «نُشر خلال» — the PUBLISHED-WITHIN field and its floating menu (owner 2026-11-11: «like Zillow … the popup shows up,
// not below … each period with the number»). One field showing the current choice; a tap opens a menu card floating over
// the screen (not a list pushed open underneath), every window with its own count, the picked one ticked. Shared by the
// main Filter (src/app/index.tsx) and the map filter (src/components/MapFilterCard.tsx), so both look and count alike.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';
import { POSTED_WINDOWS, postedWindowLabel } from '@/lib/postedWindows';
import type { PostedWindowCounts } from '@/data/remote';

/** The count for one menu row: «any» for «أي وقت», d<days> for a window; undefined while unknown (no number shown). */
export function postedCountFor(counts: PostedWindowCounts | null | undefined, days: number | null): number | undefined {
  if (!counts) return undefined;
  const v = days == null ? counts.any : (counts as Record<string, number>)[`d${days}`];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export default function PostedWindowMenu({ value, counts, onChange, testID = 'posted-window' }: {
  value: number | null | undefined;
  counts: PostedWindowCounts | null | undefined;
  onChange: (days: number | null) => void;
  testID?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rows: (number | null)[] = [null, ...POSTED_WINDOWS];
  // Plain 'row': the page is already right-to-left in Arabic (document dir=rtl, I18nManager on native), so 'row' puts the
  // label on the RIGHT and the chevron on the left. 'row-reverse' flipped it back to left-to-right (owner 2026-11-11:
  // «اي وقت should be far right not left in Arabic»).
  const row = 'row';
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" testID={`${testID}-field`}
        style={[s.field, { flexDirection: row }]}>
        <Text style={s.fieldT} numberOfLines={1}>{t(postedWindowLabel(value ?? null))}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.ink} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t('Close')}>
          <Pressable style={s.card} onPress={() => {}} testID={`${testID}-menu`}>
            <ScrollView>
              {rows.map((days) => {
                const n = postedCountFor(counts, days);
                const on = (value ?? null) === days;
                return (
                  <Pressable key={String(days)} onPress={() => { onChange(days); setOpen(false); }} accessibilityRole="button"
                    accessibilityState={{ selected: on }} testID={`${testID}-opt-${days ?? 'any'}`}
                    style={({ hovered }: any) => [s.opt, { flexDirection: row }, hovered && s.optHover]}>
                    <View style={s.tick}>{on ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}</View>
                    <Text style={[s.optT, on && s.optOn]}>{t(postedWindowLabel(days))}</Text>
                    <Text style={s.optN}>{n == null ? '' : n.toLocaleString('en-US')}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  field: { alignItems: 'center', justifyContent: 'space-between', height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.tintLine, backgroundColor: colors.surface },
  fieldT: { fontSize: 15, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, maxHeight: '80%', backgroundColor: colors.surface, borderRadius: 22, paddingVertical: 8, borderWidth: 1, borderColor: colors.tintLine },
  opt: { alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 13 },
  optHover: { backgroundColor: colors.tintFill },
  tick: { width: 20, alignItems: 'center' },
  optT: { flex: 1, minWidth: 0, fontSize: 16, color: colors.ink },
  optOn: { fontWeight: '700', color: colors.primary },
  optN: { fontSize: 14, color: colors.muted, fontVariant: ['tabular-nums'] },
});
