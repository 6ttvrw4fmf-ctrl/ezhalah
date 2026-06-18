import { useEffect, useState } from 'react';
import { Image as RNImage, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import * as Clipboard from 'expo-clipboard';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';

// Real, resolvable share link (the deployed app), not a placeholder.
const LINK = 'https://ezhalah-app.vercel.app';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const SLIDE_IN = { duration: 280, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const SLIDE_OUT = { duration: 210, easing: Easing.in(Easing.cubic) };
const SLIDE_PX = 520; // taller than the card so it fully clears the bottom edge

// In-screen iOS-style share sheet. Rendered ON TOP of the current screen (not a separate route)
// so the page stays visible/dimmed behind it instead of going blank. The host mounts it when
// open and removes it after onClose fires (we animate out first, then call onClose).
export default function ShareSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, SLIDE_IN);
  }, [progress]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [SLIDE_PX, 0]) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const animateOut = (after: () => void) => {
    progress.value = withTiming(0, SLIDE_OUT, (finished) => {
      if (finished) runOnJS(after)();
    });
  };
  const close = () => animateOut(onClose);

  // Bilingual share message — Arabic when the UI is Arabic, English otherwise — so WhatsApp (and any
  // share target) carries the text in the user's own language, not always English. (user request.)
  const msg = (locale === 'ar'
    ? 'إزهله — مكان واحد تستكشف فيه كل إعلانات العقارات في ثواني. جرّبها الآن: '
    : 'Ezhalah — one place to explore all property listings in seconds. Try it now: ') + LINK;
  const copy = async () => {
    // expo-clipboard works on web (navigator.clipboard) and native alike.
    try { await Clipboard.setStringAsync(msg); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // Open a real share target, then dismiss the sheet. On web we open directly
  // (Linking.canOpenURL is unreliable there and was silently swallowing every
  // tap). On native we hand off to the OS via Linking. Falls back to copying.
  const openShare = async (url: string) => {
    try {
      if (Platform.OS === 'web') {
        if (/^https?:/i.test(url)) {
          window.open(url, '_blank', 'noopener,noreferrer');
        } else {
          // mailto: / sms: — navigate so the OS hands off to the mail/SMS app.
          window.location.href = url;
        }
      } else {
        await Linking.openURL(url);
      }
    } catch { await copy(); return; }
    close();
  };

  const text = encodeURIComponent(msg);
  const link = encodeURIComponent(LINK);
  const subject = encodeURIComponent(t('Ezhalah'));

  // Note #3 — full multi-option share sheet, fully localized. WhatsApp / X / Telegram / Email / Copy
  // Link. The native OS share sheet is invoked from the home page before this fallback opens, so it
  // covers any other target (Messages, AirDrop, etc.) automatically. (user request.)
  const apps: { name: string; bg: string; fg: string; icon: any; onPress: () => void }[] = [
    { name: t('WhatsApp'),  bg: '#25d366', fg: '#fff', icon: 'logo-whatsapp', onPress: () => openShare(`https://wa.me/?text=${text}`) },
    { name: 'X',            bg: '#000',    fg: '#fff', icon: 'logo-twitter',  onPress: () => openShare(`https://twitter.com/intent/tweet?text=${text}&url=${link}`) },
    { name: t('Telegram'),  bg: '#27a4e3', fg: '#fff', icon: 'paper-plane',   onPress: () => openShare(`https://t.me/share/url?url=${link}&text=${text}`) },
    { name: t('Mail'),      bg: '#2a8cf0', fg: '#fff', icon: 'mail',          onPress: () => openShare(`mailto:?subject=${subject}&body=${text}`) },
  ];

  return (
    <View style={s.overlay}>
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View style={[s.card, { paddingBottom: insets.bottom + 12 }, cardStyle]}>
        <View style={s.grip} />

        <View style={s.preview}>
          <RNImage source={require('../../assets/images/ezhalah-logo.png')} style={s.logo} resizeMode="cover" />
          <View style={{ flex: 1 }}>
            <Text style={s.pvT}>{t('Ezhalah')}</Text>
            <Text style={s.pvS}>{t('One place to explore all listings and more in seconds. Try now.')}</Text>
            <Text style={s.pvL}>{LINK}</Text>
          </View>
        </View>

        <View style={s.apps}>
          {apps.map((a) => (
            <Pressable key={a.name} style={s.app} onPress={a.onPress}>
              <View style={[s.appIc, { backgroundColor: a.bg }]}>
                <Ionicons name={a.icon} size={30} color={a.fg} />
              </View>
              <Text style={s.appNm}>{a.name}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.rows}>
          <Pressable style={s.row} onPress={copy}>
            <Text style={s.rowTx}>{copied ? t('Copied!') : t('Copy Link')}</Text>
            <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={20} color={colors.primary} />
          </Pressable>
        </View>

        <Pressable style={s.cancel} onPress={close}>
          <Text style={s.cancelText}>{t('Cancel')}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.4)' },
  card: { backgroundColor: '#f2f2f5', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 12, paddingTop: 10 },
  grip: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#c8c8cf', alignSelf: 'center', marginTop: 2, marginBottom: 12 },

  preview: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#fff', borderRadius: 16, padding: 14 },
  logo: { width: 50, height: 50, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pvT: { fontSize: 15, fontWeight: '700', color: colors.ink },
  pvS: { fontSize: 12, color: '#6b7a72', lineHeight: 16, marginTop: 2 },
  pvL: { fontSize: 11.5, color: colors.primary, fontWeight: '600', marginTop: 4 },

  // Note #3 — 4 share targets spread evenly across the sheet.
  apps: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 18, paddingBottom: 10, paddingHorizontal: 6 },
  app: { alignItems: 'center', gap: 7 },
  appIc: { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  appNm: { fontSize: 11, color: '#45524b' },

  rows: { marginTop: 14, backgroundColor: '#fff', borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 16 },
  rowTx: { fontSize: 15, fontWeight: '500', color: colors.ink },

  cancel: { marginTop: 10, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700', color: colors.ink },
});
