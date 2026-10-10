import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useI18n } from '@/i18n';
import { cardShadow, colors, radius } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';

const MODELS = [
  { id: 'shaheen', ar: 'شاهين', en: 'Shaheen', version: '2.2',
    descriptionAr: 'سرعة خاطفة ودقة متناهية للإجابات السريعة',
    descriptionEn: 'Lightning-fast precision for instant answers',
    // Why the name, and what it does (owner 2026-10-10, approved wording). Describes the model only —
    // never «best», never a recommendation about a property.
    storyAr: 'الشاهين أسرع الطيور انقضاضاً، ومن هنا جاء اسمه. نموذجٌ يفهم طلبك من أول جملة، ويعرض لك الإعلانات المطابقة بسرعة ودقة.',
    storyEn: 'The Shaheen (peregrine falcon) is the fastest bird when it dives — that is where the name comes from. A model that understands your request from the first sentence and shows you the matching listings quickly and accurately.' },
  { id: 'hurr', ar: 'حُر', en: 'Hurr', version: '4.4',
    descriptionAr: 'قوة وتحمل فائق لأصعب المهام والمعالجات',
    descriptionEn: 'Unmatched endurance for your toughest challenges',
    storyAr: 'الحُرّ أقوى صقور الجزيرة العربية وأكثرها صبراً في الصيد، ومن هنا جاء اسمه. نموذجٌ يبحث بعمق في جميع المواقع، ويتعامل مع الطلبات المعقّدة متعددة الشروط.',
    storyEn: 'The Hurr (saker falcon) is the strongest falcon in the Arabian Peninsula and the most patient hunter — that is where the name comes from. A model that searches deeply across all websites and handles complex requests with many conditions.' },
] as const;

// Display selection only until provider model IDs are approved. Never send marketing versions
// as provider API IDs or imply a backend cutover from a UI label.
export default function AgentModelSelector({ disabled = false }: { disabled?: boolean }) {
  const { locale } = useI18n();
  const arabic = locale === 'ar';
  const [selected, setSelected] = useState<string>('shaheen');
  const [about, setAbout] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const trigger = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const model = MODELS.find((item) => item.id === selected)!;
  const close = () => { setAnchor(null); };

  useEffect(() => { setAnchor(null); }, [width, height, disabled]);
  useEffect(() => {
    if (!anchor || Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setAnchor(null); trigger.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anchor]);

  const menuWidth = Math.min(300, width - 24);
  const left = anchor ? Math.max(12, Math.min(anchor.x + anchor.width - menuWidth, width - menuWidth - 12)) : 12;
  return (
    <View style={styles.wrap}>
      <Pressable ref={trigger} testID="agent-model-selector" disabled={disabled}
        accessibilityRole="button" accessibilityState={{ expanded: !!anchor, disabled }}
        accessibilityLabel={`${arabic ? 'اختيار النموذج' : 'Select model'}: ${arabic ? model.ar : model.en} ${model.version}`}
        onPress={() => { setAbout(false); trigger.current?.measureInWindow((x, y, measuredWidth) => setAnchor({ x, y, width: measuredWidth })); }}
        // Visually a 24px line; the 44px floor comes from TAP_TARGET_CSS via this marker.
        // @ts-expect-error web-only DOM props on the RNW host node
        dataSet={{ ...TAP44 }}
        style={({ pressed }) => [styles.trigger, { opacity: disabled ? 0.45 : 1 }, pressed && styles.pressed]}>
        {/* No ⌄ arrow (owner 2026-10-10: «for shaheen 2.2 don't include this drop menu thing») — the name alone. */}
        <Text style={styles.label} numberOfLines={1}>{arabic ? model.ar : model.en} {model.version}</Text>
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close}
            accessibilityLabel={arabic ? 'إغلاق قائمة النماذج' : 'Close model menu'} accessibilityRole="button" />
          <View style={[styles.menu, { width: menuWidth, left, bottom: anchor ? Math.max(12, height - anchor.y + 6) : 12 }]}
            accessibilityViewIsModal>
              <>
            <View role="radiogroup" accessibilityLabel={arabic ? 'النموذج' : 'Model'}>
            {MODELS.map((item) => (
              <Pressable key={item.id} testID={`agent-model-${item.id}`} accessibilityRole="radio"
                disabled={item.id === 'hurr'}
                accessibilityState={{ checked: selected === item.id, disabled: item.id === 'hurr' }}
                aria-checked={selected === item.id}
                onPress={() => { setSelected(item.id); close(); trigger.current?.focus(); }}
                style={({ pressed }) => [styles.option, { flexDirection: arabic ? 'row-reverse' : 'row' }, item.id === 'hurr' && styles.unavailable, pressed && styles.pressed]}>
                {/* Name + its one-line sentence (owner 2026-10-10: «for the models include the sentence»); an
                    unavailable model says «قريباً» in words instead of an ⓘ glyph. */}
                <View style={styles.copy}>
                  <Text style={[styles.name, { textAlign: arabic ? 'right' : 'left' }, item.id === 'hurr' && styles.unavailableName]}>{arabic ? item.ar : item.en} {item.version}</Text>
                  <Text style={[styles.optionLine, { textAlign: arabic ? 'right' : 'left' }]}>{arabic ? item.descriptionAr : item.descriptionEn}</Text>
                </View>
                <View style={styles.check}>
                  {selected === item.id ? <Ionicons name="checkmark" size={18} color={colors.primary} />
                    : item.id === 'hurr' ? <Text style={styles.soon}>{arabic ? 'قريباً' : 'Soon'}</Text> : null}
                </View>
              </Pressable>
            ))}
            </View>
            <View style={styles.rule} />
            <Pressable testID="agent-about-models" accessibilityRole="button" onPress={() => { setAnchor(null); setAbout(true); }}
              style={({ pressed }) => [styles.aboutRow, styles.aboutLink, { flexDirection: 'row' }, pressed && styles.pressed]}>
              {/* The arrow sits beside the words, small and quiet — a link, not a far-away chevron. The page is
                  dir=rtl in Arabic, so a plain row already starts at the right edge (row-reverse put it on the left). */}
              <Text style={styles.aboutText}>{arabic ? 'لماذا شاهين وحُر؟' : 'Why Shaheen and Hurr?'}</Text>
              <Ionicons name={arabic ? 'chevron-back' : 'chevron-forward'} size={12} color={colors.muted} style={arabic ? styles.rtlFlip : undefined} />
            </Pressable>
              </>
          </View>
        </View>
      </Modal>
      {/* «لماذا شاهين وحُر؟» — a small card in the MIDDLE of the screen (owner 2026-10-10): why each model is
          named so, and what it does. Hurr stays dimmed with «قريباً», as in the menu. */}
      <Modal visible={about} transparent animationType="fade" onRequestClose={() => setAbout(false)}>
        <View style={styles.storyOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAbout(false)}
            accessibilityLabel={arabic ? 'إغلاق' : 'Close'} accessibilityRole="button" />
          <View testID="agent-models-story" style={[styles.storyCard, { width: Math.min(380, width - 32) }]} accessibilityViewIsModal>
            <View style={[styles.storyHead, { flexDirection: 'row' }]}>
              <Text style={[styles.storyTitle, { textAlign: arabic ? 'right' : 'left' }]}>{arabic ? 'نماذج إزهله' : "Ezhalah's models"}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={arabic ? 'إغلاق' : 'Close'} onPress={() => setAbout(false)} hitSlop={8}
                style={({ pressed }) => [styles.storyClose, pressed && styles.pressed]}>
                <Ionicons name="close" size={18} color={colors.muted} />
              </Pressable>
            </View>
            {MODELS.map((item) => (
              <View key={item.id} style={[styles.storyItem, item.id === 'hurr' && styles.unavailable]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.name, styles.storyName]}>{arabic ? item.ar : item.en} {item.version}</Text>
                  {item.id === 'hurr' ? <Text style={styles.soon}>{arabic ? 'قريباً' : 'Coming soon'}</Text> : null}
                </View>
                <Text style={[styles.storyText, { textAlign: arabic ? 'right' : 'left' }]}>{arabic ? item.storyAr : item.storyEn}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // A zero-width anchor at the mic's centre; the trigger is centred on it and overflows both ways.
  // Centred under the chat box in both locales (owner 2026-10-09 round 3: «keep it below» — not under
  // the mic). Negative margins eat most of the column's 8px gaps: ~6px to the box, ~10px to the disclaimer.
  wrap: { alignSelf: 'center' },
  trigger: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 4, height: 24, paddingHorizontal: 6, borderRadius: radius.pill },
  label: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  pressed: { backgroundColor: colors.tint },
  unavailable: { opacity: 0.55 },
  unavailableName: { color: colors.muted },
  overlay: { flex: 1 },
  menu: { position: 'absolute', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine,
    borderRadius: 18, padding: 7, ...cardShadow, shadowOpacity: 0.16, shadowRadius: 20, elevation: 10 },
  option: { alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingVertical: 8, minHeight: 52, borderRadius: 9 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 10, minHeight: 44, borderRadius: 9 },
  aboutCopy: { paddingHorizontal: 10, paddingVertical: 10 },
  rule: { height: 1, backgroundColor: colors.fieldLine, marginVertical: 4, marginHorizontal: 7 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.ink, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 21, marginTop: 3 },
  optionLine: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 1 },
  soon: { color: colors.muted, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  aboutLink: { justifyContent: 'flex-start', gap: 4, minHeight: 40 },
  // Same voice as the model names (owner: the lighter grey link «doesn't look right»).
  aboutText: { color: colors.ink, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  storyOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 28, 22, 0.28)', padding: 16 },
  storyCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.fieldLine,
    ...cardShadow, shadowOpacity: 0.18, shadowRadius: 24, elevation: 12 },
  storyHead: { alignItems: 'center', justifyContent: 'space-between' },
  storyTitle: { color: colors.ink, fontSize: 17, lineHeight: 26, fontWeight: '700' },
  storyClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  storyItem: { gap: 4 },
  storyName: { fontWeight: '700' },
  storyText: { color: colors.body, fontSize: 14, lineHeight: 23 },
  // Under dir=rtl the icon font draws the chevron facing the wrong way (measured live 2026-10-10: «عن النماذج»
  // showed ›); mirroring it makes the Arabic link read «عن النماذج ‹», like every RTL «more» link.
  rtlFlip: { transform: [{ scaleX: -1 }] },
  check: { width: 24, alignItems: 'center' },
});
