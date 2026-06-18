import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useApp } from '@/store';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const IN = { duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const OUT = { duration: 170, easing: Easing.in(Easing.cubic) };

// In-app popup that hosts the Support / About content as a centered dialog over a dimmed page,
// instead of a full-screen route. Mounted at the app root (Shell) so it overlays every screen and
// works in both the mobile drawer and the docked web sidebar. Driven by the global `modal` state.
export default function InfoModal() {
  const { modal, closeModal } = useApp();
  if (!modal) return null;
  return <Sheet kind={modal} onClose={closeModal} />;
}

function Sheet({ kind, onClose }: { kind: 'support' | 'about'; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { t } = useI18n();

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, IN);
  }, [progress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.92, 1]) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const close = () => {
    progress.value = withTiming(0, OUT, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  const maxH = Math.min(height - insets.top - insets.bottom - 48, 640);

  return (
    <View style={s.overlay}>
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View style={[s.card, { maxWidth: Math.min(width - 32, 540), maxHeight: maxH }, cardStyle]}>
        <Pressable onPress={close} style={s.xBtn} hitSlop={8}>
          <Ionicons name="close" size={20} color="#56635c" />
        </Pressable>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {kind === 'support' ? <SupportBody t={t} /> : <AboutBody t={t} />}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function SupportBody({ t }: { t: (s: string, v?: Record<string, string>) => string }) {
  return (
    <>
      <Text style={s.h}>{t('Support')}</Text>
      <SupCard email="support@ezhalah.com" desc={t('Questions about your account, searches, or technical issues.')} />
      <SupCard email="info@ezhalah.com" desc={t('Business inquiries, partnerships, media requests, and general information.')} />
      <View style={s.rt}>
        <Text style={s.rtH}>{t('Response Time')}</Text>
        <RtRow text={t('Typical response time: {h}.', { h: t('72 hours') })} />
        <RtRow text={t('Some inquiries may take up to {d}.', { d: t('1 week') })} />
      </View>
    </>
  );
}

function AboutBody({ t }: { t: (s: string) => string }) {
  return (
    <>
      <Text style={s.h}>{t('About Us')}</Text>
      <Text style={s.intro}>
        {t('Ezhalah is a Saudi, AI-powered property search platform. We help people find properties faster by searching Aqar, Bayut, Property Finder, Wasalt and Aldarim in one place, and help those platforms reach more users by driving traffic directly to their listings.')}
      </Text>
      <Text style={s.sec}>{t('Our role')}</Text>
      <Text style={s.tx}>{t('We are a property search platform only. We do not own, list, sell or rent any property. We do not facilitate transactions or collect commission.')}</Text>
      <Text style={s.sec}>{t('License')}</Text>
      <Text style={s.tx}>{t('Ezhalah operates under REGA FAL license number XXXXXXXX, issued by the General Authority for Real Estate in Saudi Arabia.')}</Text>
      <Text style={s.sec}>{t('Disclaimer')}</Text>
      <Text style={s.tx}>{t('All listings are sourced directly from third-party platforms. Ezhalah does not own or verify any listing. Always confirm details directly with the original platform before making any decision.')}</Text>
      <Text style={s.sec}>{t('Data & privacy')}</Text>
      <Text style={s.tx}>{t("Ezhalah complies with Saudi Arabia's PDPL. All user data is stored on Saudi servers. We do not sell user data.")}</Text>
    </>
  );
}

function SupCard({ email, desc }: { email: string; desc: string }) {
  return (
    <View style={s.supCard}>
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
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70, alignItems: 'center', justifyContent: 'center', padding: 16 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.45)' },
  card: { width: '100%', backgroundColor: colors.paper, borderRadius: 22, paddingTop: 8, ...cardShadow, shadowOpacity: 0.22, shadowRadius: 26 },
  xBtn: { alignSelf: 'flex-end', marginRight: 12, marginTop: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 22, paddingTop: 2, paddingBottom: 26 },

  h: { fontSize: 23, fontWeight: '700', color: colors.ink, marginBottom: 16 },

  supCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.fieldLine, padding: 18, alignItems: 'center', marginBottom: 12 },
  cardIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  mail: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  desc: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  rt: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.fieldLine, padding: 18, marginTop: 6 },
  rtH: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  rtRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  rtText: { flex: 1, fontSize: 13.5, color: colors.body, lineHeight: 19 },

  intro: { fontSize: 14, color: colors.body, lineHeight: 22 },
  sec: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 22, marginBottom: 7 },
  tx: { fontSize: 13.5, color: colors.body, lineHeight: 21 },
});
