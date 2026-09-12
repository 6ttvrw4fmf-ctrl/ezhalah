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
import { useAtLeast } from '@/lib/useAtLeast';
import { DOCK_BREAKPOINT } from '@/lib/responsive';
import { colors, radius, font } from '@/theme/tokens';
import {
  shouldShowCookieBanner,
  getCookieConsent,
  setCookieConsent,
  type CookieConsent as Consent,
} from '@/lib/cookieConsent';
import { useForeignPromptInsets, dockedEdgeOffset } from '@/lib/bottomPromptInset';

const COPY = {
  ar: {
    title: 'سياسة ملفات تعريف الارتباط',
    // Owner 2026-09-11: replaced with the same wording now in the Privacy Policy §9 (src/data/
    // legal.ts) — one voice for cookies/tracking across the guest pop-up and the policy doc. Also
    // fixes a standing typo: the old copy said «إزالة» (removal) twice where it meant «إزهله».
    body:
      'تستخدم إزهله ملفات تعريف الارتباط وتقنيات مثل SDK وواجهات API والتخزين المؤقت لتشغيل المنصة ' +
      'بشكل صحيح، والحفاظ على تسجيل الدخول، وحفظ تفضيلاتك، وتشخيص الأعطال وتحسين الخدمة. كما نقيس ' +
      'عمليات البحث والنقرات والزيارات التي ترسلها إزهله إلى المنصات العقارية، وقد نشارك معها ' +
      'إحصاءات مجمعة عن حجم الزيارات دون مشاركة بيانات تحدد هويتك. لا نبيع بياناتك الشخصية ولا ' +
      'نستخدمها لعرض إعلانات من أطراف خارجية.',
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
  // IS THERE ROOM BESIDE THE APP, OR ARE WE ON TOP OF IT? (owner decision 2026-09-11, #152)
  // The same question — and the same breakpoint — SignInCard already asks to decide whether its
  // floating card may exist at all. At/above it the app docks a sidebar and the filter card sits
  // centred with a free right margin, which is the layout this card's 280 px corner form was
  // measured against (1440/1512, gap > 0). Below it there is no free margin, so a corner card is
  // simply a card ON the app: it becomes a full-width bottom SHEET instead, and the root reserves
  // its height (lib/bottomPromptInset.ts) so «بحث», the composer and every other control lay out
  // ABOVE it rather than under it. Routed through useAtLeast() like every width-gated flag, so the
  // first client render still reproduces the server's (React #418 — see lib/responsive.ts).
  const beside = useAtLeast(DOCK_BREAKPOINT);
  const [consent, setConsent] = useState<Consent | null>(() => getCookieConsent());
  // The band a THIRD-PARTY docked prompt (Google/Apple One Tap) has reserved — never the combined
  // usePromptInsets(), which now also counts this very card's own rect (ops_incident #152 made this
  // card a member of DOCKED_PROMPT_SELECTOR) and would fold the card's reservation back into itself.
  // {0,0} on native, and whenever nothing foreign is docked — so this changes nothing on the path
  // that was already correct. (ops_incident #163: this card's OWN element never moved out of a
  // foreign prompt's way before — the root's reservation protects everything ELSE, not this card.)
  const foreignInset = useForeignPromptInsets();

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
        // DESKTOP: the owner's corner card — far right in both languages, 280 wide, beside the app.
        // NARROW: a docked sheet across the bottom, and every part of that is load-bearing rather
        // than cosmetic. It must SPAN (left and right pinned, no `width`) or bottomPromptInset()
        // reads it as a card sitting beside the app and reserves nothing; and it must be FLUSH
        // (`bottom: 0`) or it is not docked at all — the tolerance there is 2 px, so the old
        // `bottom: 20` card was, correctly, just something floating in the page. Measured at
        // 390×844: 390 of 390 wide, reserving 190 px, with «بحث» laying out above it.
        //
        // BOTH branches fold in `dockedEdgeOffset(base, foreignInset.bottom)` (ops_incident #163):
        // a THIRD-PARTY prompt (One Tap) docks on the SAME edge independently of this card's own
        // `beside` state, and #152's repair only ever taught the ROOT to reserve space for this
        // card — nothing previously taught this card to get out of a FOREIGN prompt's way. With
        // nothing foreign docked, dockedEdgeOffset(base, 0) === base, so neither branch moves.
        beside
          ? { right: 20, bottom: dockedEdgeOffset(20, foreignInset.bottom), width: 280, borderRadius: radius.card }
          : { left: 0, right: 0, bottom: dockedEdgeOffset(0, foreignInset.bottom),
              borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
        Platform.OS === 'web' && ({
          position: 'fixed',
          boxShadow: '0 18px 44px -20px rgba(18, 37, 27, 0.35)',
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
    // GEOMETRY IS SET PER-FORM, NOT HERE (2026-09-11, ops_incident #152; edge offset extended for
    // #163). The corner card is 280 wide at bottom:dockedEdgeOffset(20,…); the docked sheet pins
    // left AND right, sits at bottom:dockedEdgeOffset(0,…), and carries no width — otherwise it
    // neither spans nor counts as docked, and the root reserves nothing.
    zIndex: 38,
    backgroundColor: colors.surface,
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
