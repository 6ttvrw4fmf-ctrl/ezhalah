// THE COOKIE CONSENT CARD — Perplexity-style, signed-out first-time web visitors (owner 2026-09-06).
//
// A compact card in the bottom corner (end side, so bottom-left in Arabic RTL / bottom-right in EN).
// Web-only, like GoogleOneTap and SignInCard — a cookie banner is a browser convention; native has no
// cookies. All lifecycle gates are the PURE `shouldShowCookieBanner` in lib/cookieConsent (barrier-
// executed in scripts/verify-cookie-consent-gating.ts):
//   appears   signed-out + web + no choice recorded yet, once the session restore settles (authChecked).
//   goes away "Allow all" → records 'all'; "Only necessary" → records 'necessary'; a SEARCH → 'all'
//             (owner's "left without choosing = allow all"). All three persist, so it is once-per-visitor.
//   never     for signed-in users, on native, or once a choice is stored (survives reloads).
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useApp } from '@/store';
import { useI18n } from '@/i18n';
import { colors, radius, font } from '@/theme/tokens';
import {
  shouldShowCookieBanner,
  getCookieConsent,
  setCookieConsent,
  type CookieConsent as Consent,
} from '@/lib/cookieConsent';

const COPY = {
  ar: {
    title: 'سياسة ملفات تعريف الارتباط',
    body:
      'تستخدم إزالة ملفات تعريف الارتباط (الكوكيز) والبكسل وحِزم SDK وواجهات API والتخزين المحلي ' +
      'وعمليات التكامل من خادم إلى خادم لضمان عمل التطبيق بالشكل الصحيح، وذلك لإبقائك مسجّلاً للدخول، ' +
      'وحفظ عمليات بحثك ومحادثاتك، وتشخيص الأعطال. وبإذنك، نستخدم هذه التقنيات أيضاً لفهم طريقة ' +
      'استخدام التطبيق وتحسين خدماتنا. لا تعرض إزالة إعلانات من أطراف خارجية، ولا تبيع بياناتك الشخصية.',
    all: 'السماح بالكل',
    necessary: 'الضروري فقط',
  },
  en: {
    title: 'Cookie Policy',
    body:
      'Ezhalah uses cookies, pixels, SDKs, APIs, local storage, and server-to-server integrations for ' +
      'the correct functioning of our app, including keeping you signed in, saving your searches and ' +
      'conversations, and diagnosing crashes. With your permission, we also use these technologies to ' +
      'understand how the app is used and to improve our services. Ezhalah does not serve third-party ' +
      'ads and does not sell your personal data.',
    all: 'Allow all',
    necessary: 'Only necessary',
  },
} as const;

export default function CookieConsent() {
  const { user, authChecked, searchCount } = useApp();
  const { isRTL } = useI18n();
  const [consent, setConsent] = useState<Consent | null>(() => getCookieConsent());

  const visible = shouldShowCookieBanner({
    isWeb: Platform.OS === 'web',
    authChecked,
    user,
    consent,
  });

  const choose = useCallback((c: Consent) => {
    setCookieConsent(c);
    setConsent(c);
  }, []);

  // A search dismisses the card and counts as ALLOW ALL (owner: "no selection = allow all").
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (searchCount > 0 && consent == null && authChecked && user == null) choose('all');
  }, [searchCount, consent, authChecked, user, choose]);

  if (!visible) return null;

  const c = isRTL ? COPY.ar : COPY.en;
  const textAlign = isRTL ? 'right' : 'left';

  return (
    <View
      // @ts-expect-error web-only DOM props on the RNW host node
      dataSet={{ testid: 'cookie-consent' }}
      style={[
        st.host,
        { right: 20 }, // owner: keep it on the far right in both languages
        Platform.OS === 'web' && ({
          position: 'fixed',
          boxShadow: '0 18px 44px -20px rgba(18, 37, 27, 0.35)',
          maxWidth: 'calc(100vw - 32px)',
        } as never),
      ]}
    >
      <View style={[st.headRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Image source={require('../../assets/images/cookies-green.png')} style={st.icon} contentFit="contain" />
        <Text style={[st.title, { textAlign }]}>{c.title}</Text>
      </View>

      <Text style={[st.body, { textAlign, writingDirection: isRTL ? 'rtl' : 'ltr' }]}>{c.body}</Text>

      <View style={[st.btnRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Pressable
          onPress={() => choose('all')}
          // @ts-expect-error web-only DOM props on the RNW host node
          dataSet={{ testid: 'cookie-allow-all' }}
          style={({ pressed }) => [st.btn, st.btnPrimary, pressed && st.pressed]}
        >
          <Text style={[st.btnText, st.btnPrimaryText]}>{c.all}</Text>
        </Pressable>
        <Pressable
          onPress={() => choose('necessary')}
          // @ts-expect-error web-only DOM props on the RNW host node
          dataSet={{ testid: 'cookie-only-necessary' }}
          style={({ pressed }) => [st.btn, st.btnGhost, pressed && st.pressed]}
        >
          <Text style={[st.btnText, st.btnGhostText]}>{c.necessary}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  // zIndex 38 — below the draggable SignInCard (40), so the movable sign-in card always sits ABOVE
  // this fixed consent card when they share the bottom-right corner (owner 2026-09-06). Still above
  // page content; below the Sidebar drawer (50) and every real overlay (ShareSheet 60, InfoModal 70,
  // AuthModal 200). A consent card must never cover a modal.
  host: {
    bottom: 20,
    width: 280,
    zIndex: 38,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  headRow: { alignItems: 'center', gap: 8 },
  icon: { height: 20, aspectRatio: 1.303 }, // "cookies" wordmark, green + transparent (blends, no box)
  title: { flex: 1, fontFamily: font.family.semibold, fontSize: 15, color: colors.ink },
  body: { marginTop: 10, fontFamily: font.family.regular, fontSize: 12.5, lineHeight: 19, color: colors.muted },
  btnRow: { marginTop: 16, gap: 8, justifyContent: 'flex-end' },
  btn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 11, borderWidth: 1 },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnGhost: { backgroundColor: colors.surface, borderColor: colors.line },
  btnText: { fontFamily: font.family.semibold, fontSize: 13 },
  btnPrimaryText: { color: colors.onFill },
  btnGhostText: { color: colors.ink },
  pressed: { opacity: 0.85 },
});
