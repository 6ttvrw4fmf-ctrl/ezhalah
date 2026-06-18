import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';

const MAX_W = 560;

// Support — contact addresses + expected response time (prototype SupportPage).
export default function Support() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t: ti } = useI18n();

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
          <Text style={s.h}>{ti('Support')}</Text>

          <SupCard email="support@ezhalah.com" desc={ti('Questions about your account, searches, or technical issues.')} />
          <SupCard email="info@ezhalah.com" desc={ti('Business inquiries, partnerships, media requests, and general information.')} />

          <View style={s.rt}>
            <Text style={s.rtH}>{ti('Response Time')}</Text>
            <RtRow text={ti('Typical response time: {h}.', { h: ti('72 hours') })} />
            <RtRow text={ti('Some inquiries may take up to {d}.', { d: ti('1 week') })} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SupCard({ email, desc }: { email: string; desc: string }) {
  return (
    <View style={s.card}>
      <View style={s.cardIc}><Ionicons name="mail-outline" size={20} color={colors.primary} /></View>
      <Text style={s.mail}>{email}</Text>
      <Text style={s.desc}>{desc}</Text>
    </View>
  );
}

function RtRow({ text }: { text: string }) {
  return (
    <View style={s.rtRow}>
      <View style={s.dot} />
      <Text style={s.rtText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 4 },
  xBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, alignItems: 'center', paddingTop: 4 },
  col: { width: '100%', maxWidth: MAX_W },
  h: { fontSize: 24, fontWeight: '700', color: colors.ink, marginBottom: 16 },

  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.fieldLine, padding: 18, alignItems: 'center', marginBottom: 12 },
  cardIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  mail: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  desc: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  rt: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.fieldLine, padding: 18, marginTop: 6 },
  rtH: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  rtRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  rtText: { flex: 1, fontSize: 13.5, color: colors.body, lineHeight: 19 },
});
