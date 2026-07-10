import { useEffect } from 'react';
import { Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useApp } from '@/store';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const IN = { duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const OUT = { duration: 170, easing: Easing.in(Easing.cubic) };
const IS_WEB = Platform.OS === 'web';
// Smooth hover/press transitions for the close button (web only).
const WEB_SMOOTH = IS_WEB ? ({ transitionProperty: 'background-color, transform, box-shadow', transitionDuration: '150ms' } as any) : null;

const EAGLE = require('../../assets/images/eagle-mark.png');
const HERO = require('../../assets/images/hero-bg.png');

// In-app popup that hosts the Support / About content as a centered dialog over a blurred, dimmed
// page (owner 2026-07-09: premium redesign — Apple/Perplexity/Notion quality, LOCKED). Mounted at
// the app root (Shell) so it overlays every screen and works in both the mobile drawer and the
// docked web sidebar. Driven by the global `modal` state.
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

  const maxH = Math.min(height - insets.top - insets.bottom - 48, 680);

  return (
    <View style={s.overlay}>
      {/* Blurred + softly darkened page behind the dialog — the popup is the single clear focus.
          (owner: keep the blur, increase it slightly, add a subtle dark overlay.) */}
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View style={[s.card, { maxWidth: Math.min(width - 32, 560), maxHeight: maxH }, cardStyle]}>
        {/* Close — a circular button pinned to the PHYSICAL top-right (owner: right side, premium,
            subtle shadow, gentle hover — like modern Apple/Notion dialogs). */}
        <Pressable
          onPress={close}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          style={({ hovered, pressed }: any) => [s.xBtn, WEB_SMOOTH, (hovered || pressed) && s.xBtnHover]}
        >
          <Ionicons name="close" size={18} color="#4c5a52" />
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
    <View style={s.bodyPad}>
      <Text style={s.h}>{t('Support')}</Text>
      <SupCard email="support@ezhalah.com" desc={t('Questions about your account, searches, or technical issues.')} />
      <SupCard email="info@ezhalah.com" desc={t('Business inquiries, partnerships, media requests, and general information.')} />
      <View style={s.rt}>
        <Text style={s.rtH}>{t('Response Time')}</Text>
        <RtRow text={t('Typical response time: {h}.', { h: t('72 hours') })} />
        <RtRow text={t('Some inquiries may take up to {d}.', { d: t('1 week') })} />
      </View>
    </View>
  );
}

// «من نحن» — premium about dialog (owner 2026-07-09, copy is the owner's EXACT wording):
// branded header (eagle mark + big title + subtitle, faint eagle watermark) → five soft cards
// (من نحن / دورنا / الترخيص / إخلاء المسؤولية / البيانات والخصوصية), each with an icon in a green
// circle → a light Saudi-skyline footer with the brand line. Clean, spacious, trustworthy.
function AboutBody({ t }: { t: (s: string) => string }) {
  return (
    <>
      {/* Faint eagle watermark behind the header — brand presence without noise. */}
      <RNImage source={EAGLE} style={s.watermark} resizeMode="contain" />

      <View style={s.bodyPad}>
        {/* Header — room to breathe: embossed eagle badge, large title, short subtitle. */}
        <View style={s.head}>
          <View style={s.brandBadge}>
            <RNImage source={EAGLE} style={s.brandEagle} resizeMode="contain" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>{t('About Us')}</Text>
            <Text style={s.subtitle}>{t('A Saudi property-search tool, powered by AI.')}</Text>
          </View>
        </View>

        {/* 1 — من نحن (the owner's message, verbatim) */}
        <Card icon="sparkles-outline" title={t('About Us')}>
          <Text style={s.tx}>{t('Ezhalah is your first destination for property search in Saudi Arabia, fully powered by AI.')}</Text>
          <Text style={[s.tx, s.txGap]}>{t('Instead of browsing dozens of sites, we gather the properties listed on most licensed real-estate platforms in the Kingdom, plus the websites of licensed real-estate companies and offices, and show them in one organized, easy place.')}</Text>
          <Text style={[s.tx, s.txGap]}>{t('Search smart, compare fast, and contact the listing source directly. All from one screen.')}</Text>
        </Card>

        {/* 2 — دورنا */}
        <Card icon="search-outline" title={t('Our role')}>
          <Text style={s.tx}>{t('In short: Ezhalah is a search and aggregation tool — we do not own or sell properties, we connect you to them wherever they are.')}</Text>
        </Card>

        {/* 3 — الترخيص */}
        <Card icon="ribbon-outline" title={t('License')}>
          <Text style={s.tx}>{t('We operate under FAL license No. XXXXXXXX.')}</Text>
        </Card>

        {/* 4 — إخلاء المسؤولية */}
        <Card icon="information-circle-outline" title={t('Disclaimer')}>
          <Text style={s.tx}>{t('All listings are sourced directly from third-party platforms. Ezhalah does not own or verify any listing. Always confirm details directly with the original platform before making any decision.')}</Text>
        </Card>

        {/* 5 — البيانات والخصوصية */}
        <Card icon="lock-closed-outline" title={t('Data & privacy')}>
          <Text style={s.tx}>{t('We are committed to storing your data on servers inside the Kingdom in accordance with the Personal Data Protection Law.')}</Text>
        </Card>
      </View>

      {/* Footer — the hand-drawn Saudi skyline, very light, with the brand line. Ends the dialog
          with a quiet, memorable Ezhalah note instead of stopping abruptly. */}
      <View style={s.footer}>
        <RNImage source={HERO} style={s.footerArt} resizeMode="cover" />
        <LinearGradient colors={[colors.paper, 'rgba(251,251,250,0)']} locations={[0, 0.75]} style={StyleSheet.absoluteFill} />
        <Text style={s.footerLine}>{t('Ezhalah, and may your luck be good.')}</Text>
      </View>
    </>
  );
}

// One soft content card: icon in a green circle + section title, body underneath. Rounded, lightly
// shadowed, generously padded (owner: no plain text blocks, no clutter).
function Card({ icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <View style={s.secCard}>
      <View style={s.secHead}>
        <View style={s.secIc}>
          <Ionicons name={icon} size={18} color={colors.primary} />
        </View>
        <Text style={s.secTitle}>{title}</Text>
      </View>
      {children}
    </View>
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
  // Deeper dim + a real blur (web) so the dialog is unmistakably the focus. (owner request.)
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.55)',
    ...(IS_WEB ? ({ backdropFilter: 'blur(10px)' } as any) : {}),
  },
  // overflow hidden lets the skyline footer bleed edge-to-edge inside the rounded corners.
  card: { width: '100%', backgroundColor: colors.paper, borderRadius: 24, overflow: 'hidden', ...cardShadow, shadowOpacity: 0.26, shadowRadius: 32 },
  // Circular close pinned to the PHYSICAL top-right (RN `right` is physical — RTL never flips it).
  xBtn: {
    position: 'absolute', top: 14, right: 14, zIndex: 5,
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: 'rgba(20,40,30,1)', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
    ...(IS_WEB ? ({ cursor: 'pointer' } as any) : {}),
  },
  xBtnHover: { backgroundColor: '#eef3ef', transform: [{ scale: 1.06 }] },
  scroll: { paddingTop: 0, paddingBottom: 0 },
  bodyPad: { paddingHorizontal: 24, paddingTop: 26, paddingBottom: 8 },

  // ——— About: header ———
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22, paddingTop: 6 },
  brandBadge: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.tint,
    borderWidth: 1, borderColor: colors.tintLine, alignItems: 'center', justifyContent: 'center',
  },
  brandEagle: { width: 34, height: 34 },
  h1: { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, color: colors.muted, marginTop: 4, lineHeight: 20 },
  // Large, near-invisible eagle behind the header (physical left = the quiet corner in RTL).
  watermark: { position: 'absolute', top: -24, left: -30, width: 190, height: 190, opacity: 0.05 },

  // ——— About: section cards ———
  secCard: {
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.fieldLine,
    padding: 18, marginBottom: 14,
    shadowColor: 'rgba(20,40,30,1)', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 11 },
  secIc: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  secTitle: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  tx: { fontSize: 13.5, color: colors.body, lineHeight: 23 },
  txGap: { marginTop: 10 },

  // ——— About: footer ———
  footer: { height: 116, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden' },
  footerArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0.5 },
  footerLine: { fontSize: 13, fontWeight: '700', color: colors.dark, marginBottom: 16 },

  // ——— Support (content unchanged; shares the upgraded shell) ———
  h: { fontSize: 23, fontWeight: '700', color: colors.ink, marginBottom: 16, paddingTop: 4 },
  supCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.fieldLine, padding: 18, alignItems: 'center', marginBottom: 12 },
  cardIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  mail: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  desc: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  rt: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.fieldLine, padding: 18, marginTop: 6, marginBottom: 18 },
  rtH: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  rtRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  rtText: { flex: 1, fontSize: 13.5, color: colors.body, lineHeight: 19 },
});
