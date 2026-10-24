// «كيف تشتغل؟» — what a user sees after tapping the home headline's market fact (owner 2026-10-22: «when user
// clicks on it we explain how it works», «include how it works with duplicates»). Wording approved by the owner.
// Facts only, never advice: the sheet itself says so.
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { HOW_IT_WORKS } from '@/lib/insightHowItWorks';

export function InsightHowItWorks({ visible, locale, onClose }: { visible: boolean; locale: 'ar' | 'en'; onClose: () => void }) {
  const c = HOW_IT_WORKS[locale];
  const rtl = locale === 'ar';
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={c.ok} testID="insight-how-backdrop" />
      <View style={s.sheet} testID="insight-how-it-works">
        <ScrollView contentContainerStyle={s.body}>
          <View style={[s.heading, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <Text style={[s.title, align]} accessibilityRole="header">{c.title}</Text>
            <Image
              source={require('../../assets/icons/insight-falconer.png')}
              style={s.falconer}
              resizeMode="contain"
              accessible={false}
              testID="insight-how-falconer"
            />
            <Image
              source={require('../../assets/icons/insight-falconer-original.png')}
              style={s.falconer}
              resizeMode="contain"
              accessible={false}
              testID="insight-how-falconer-original"
            />
          </View>
          {c.sections.map((x) => (
            <View key={x.title} style={s.section}>
              <Text style={[s.sectionTitle, align]}>{`${x.icon} ${x.title}`}</Text>
              <Text style={[s.sectionBody, align]}>{x.body}</Text>
            </View>
          ))}
          <Text style={[s.note, align]}>{c.note}</Text>
          <Pressable style={s.ok} onPress={onClose} accessibilityRole="button" testID="insight-how-ok">
            <Text style={s.okText}>{c.ok}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%', alignSelf: 'center', width: '100%', maxWidth: 560,
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  body: { padding: 20, paddingBottom: 28, gap: 14 },
  heading: { direction: 'ltr', alignItems: 'center', gap: 10 },
  falconer: { width: 46, height: 54 },
  title: { flexShrink: 1, fontSize: 20, fontWeight: '700', color: colors.ink },
  section: { gap: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  sectionBody: { fontSize: 15, lineHeight: 23, color: colors.body },
  note: { fontSize: 14, color: colors.muted, marginTop: 4 },
  ok: { marginTop: 6, backgroundColor: colors.selFill, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  okText: { color: colors.onFill, fontSize: 16, fontWeight: '700' },
});
