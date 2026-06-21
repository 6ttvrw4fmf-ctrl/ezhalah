import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';

const MAX_W = 560;

// About Us — neutrality, REGA FAL licensing, disclaimer, and PDPL data residency (prototype AboutPage).
export default function About() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.back()} style={s.xBtn} hitSlop={8}>
          <Ionicons name="close" size={20} color="#56635c" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}>
        <View style={s.col}>
          <Text style={s.h}>{t('About Us')}</Text>
          <Text style={s.intro}>
            {t('Ezhalah is a Saudi, AI-powered property search platform. We help people find properties faster by searching Aqar, Wasalt, Aldarim and more in one place, and help those platforms reach more users by driving traffic directly to their listings.')}
          </Text>

          <Text style={s.sec}>{t('Our role')}</Text>
          <Text style={s.tx}>{t('We are a property search platform only. We do not own, list, sell or rent any property. We do not facilitate transactions or collect commission.')}</Text>

          <Text style={s.sec}>{t('License')}</Text>
          <Text style={s.tx}>{t('Ezhalah operates under REGA FAL license number XXXXXXXX, issued by the General Authority for Real Estate in Saudi Arabia.')}</Text>

          <Text style={s.sec}>{t('Disclaimer')}</Text>
          <Text style={s.tx}>{t('All listings are sourced directly from third-party platforms. Ezhalah does not own or verify any listing. Always confirm details directly with the original platform before making any decision.')}</Text>

          <Text style={s.sec}>{t('Data & privacy')}</Text>
          <Text style={s.tx}>{t("Ezhalah complies with Saudi Arabia's PDPL. All user data is stored on Saudi servers. We do not sell user data.")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  xBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, alignItems: 'center', paddingTop: 4 },
  col: { width: '100%', maxWidth: MAX_W },
  h: { fontSize: 24, fontWeight: '700', color: colors.ink, marginBottom: 14 },
  intro: { fontSize: 14, color: colors.body, lineHeight: 22 },
  sec: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 22, marginBottom: 7 },
  tx: { fontSize: 13.5, color: colors.body, lineHeight: 21 },
});
