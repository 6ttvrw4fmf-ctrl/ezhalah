import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useI18n } from '@/i18n';
import { cardShadow, colors, radius } from '@/theme/tokens';

const MODELS = [
  { id: 'shaheen', ar: 'شاهين', en: 'Shaheen', version: '2.2',
    descriptionAr: 'سرعة خاطفة ودقة متناهية للإجابات السريعة',
    descriptionEn: 'Lightning-fast precision for instant answers' },
  { id: 'hurr', ar: 'حُر', en: 'Hurr', version: '4.4',
    descriptionAr: 'قوة وتحمل فائق لأصعب المهام والمعالجات',
    descriptionEn: 'Unmatched endurance for your toughest challenges' },
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
  const close = () => { setAnchor(null); setAbout(false); };

  useEffect(() => { setAnchor(null); }, [width, height, disabled]);
  useEffect(() => {
    if (!anchor || Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setAnchor(null); trigger.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anchor]);

  const menuWidth = Math.min(about ? 320 : 240, width - 24);
  const left = anchor ? Math.max(12, Math.min(anchor.x + anchor.width - menuWidth, width - menuWidth - 12)) : 12;
  return (
    <View style={styles.wrap}>
      <Pressable ref={trigger} testID="agent-model-selector" disabled={disabled}
        accessibilityRole="button" accessibilityState={{ expanded: !!anchor, disabled }}
        accessibilityLabel={`${arabic ? 'اختيار النموذج' : 'Select model'}: ${arabic ? model.ar : model.en} ${model.version}`}
        onPress={() => { setAbout(false); trigger.current?.measureInWindow((x, y, measuredWidth) => setAnchor({ x, y, width: measuredWidth })); }}
        style={({ pressed }) => [styles.trigger, { opacity: disabled ? 0.45 : 1 }, pressed && styles.pressed]}>
        <Text style={styles.label}>{arabic ? model.ar : model.en} {model.version}</Text>
        <Ionicons name="chevron-down" size={12} color={colors.muted} />
      </Pressable>
      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close}
            accessibilityLabel={arabic ? 'إغلاق قائمة النماذج' : 'Close model menu'} accessibilityRole="button" />
          <View style={[styles.menu, { width: menuWidth, left, bottom: anchor ? Math.max(12, height - anchor.y + 6) : 12 }]}
            accessibilityViewIsModal>
            {about ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => setAbout(false)} style={styles.aboutRow}>
                  <Ionicons name={arabic ? 'chevron-forward' : 'chevron-back'} size={15} color={colors.muted} />
                  <Text style={styles.name}>{arabic ? 'عن النماذج' : 'About models'}</Text>
                </Pressable>
                {MODELS.map((item) => (
                  <View key={item.id} style={styles.aboutCopy}>
                    <Text style={[styles.name, { textAlign: arabic ? 'right' : 'left' }]}>{arabic ? item.ar : item.en} {item.version}</Text>
                    <Text style={[styles.description, { textAlign: arabic ? 'right' : 'left' }]}>{arabic ? item.descriptionAr : item.descriptionEn}</Text>
                    {item.id === 'hurr' && <Text style={[styles.description, { textAlign: arabic ? 'right' : 'left' }]}>{arabic ? 'غير متاح حاليًا' : 'Currently unavailable'}</Text>}
                  </View>
                ))}
              </>
            ) : (
              <>
            <View role="radiogroup" accessibilityLabel={arabic ? 'النموذج' : 'Model'}>
            {MODELS.map((item) => (
              <Pressable key={item.id} testID={`agent-model-${item.id}`} accessibilityRole="radio"
                disabled={item.id === 'hurr'}
                accessibilityState={{ checked: selected === item.id, disabled: item.id === 'hurr' }}
                aria-checked={selected === item.id}
                onPress={() => { setSelected(item.id); close(); trigger.current?.focus(); }}
                style={({ pressed }) => [styles.option, { flexDirection: arabic ? 'row-reverse' : 'row' }, item.id === 'hurr' && styles.unavailable, pressed && styles.pressed]}>
                <View style={styles.copy}>
                  <Text style={[styles.name, { textAlign: arabic ? 'right' : 'left' }, item.id === 'hurr' && styles.unavailableName]}>{arabic ? item.ar : item.en} {item.version}</Text>
                </View>
                <View style={styles.check}>
                  {selected === item.id ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : item.id === 'hurr' && <Ionicons name="information-circle-outline" size={14} color={colors.muted} />}
                </View>
              </Pressable>
            ))}
            </View>
            <View style={styles.rule} />
            <Pressable testID="agent-about-models" accessibilityRole="button" onPress={() => setAbout(true)}
              style={({ pressed }) => [styles.aboutRow, { flexDirection: arabic ? 'row-reverse' : 'row' }, pressed && styles.pressed]}>
              <Text style={styles.name}>{arabic ? 'عن النماذج' : 'About models'}</Text>
              <Ionicons name={arabic ? 'chevron-back' : 'chevron-forward'} size={15} color={colors.muted} />
            </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-end', marginTop: 2, marginRight: 36 },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 8, borderRadius: radius.pill },
  label: { color: colors.muted, fontSize: 12, fontWeight: '500' },
  pressed: { backgroundColor: colors.tint },
  unavailable: { opacity: 0.55 },
  unavailableName: { color: colors.muted },
  overlay: { flex: 1 },
  menu: { position: 'absolute', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine,
    borderRadius: 18, padding: 7, ...cardShadow, shadowOpacity: 0.16, shadowRadius: 20, elevation: 10 },
  option: { alignItems: 'center', gap: 12, paddingHorizontal: 10, minHeight: 44, borderRadius: 9 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 10, minHeight: 44, borderRadius: 9 },
  aboutCopy: { paddingHorizontal: 10, paddingVertical: 10 },
  rule: { height: 1, backgroundColor: colors.fieldLine, marginVertical: 4, marginHorizontal: 7 },
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.ink, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  description: { color: colors.muted, fontSize: 13, lineHeight: 21, marginTop: 3 },
  check: { width: 24, alignItems: 'center' },
});
