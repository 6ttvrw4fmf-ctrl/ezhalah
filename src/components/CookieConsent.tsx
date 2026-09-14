// THE COOKIE CONSENT CARD — signed-out web visitors, EVERY visit (owner 2026-09-06, extended 2026-09-13).
//
// A compact card in the bottom corner (end side, so bottom-left in Arabic RTL / bottom-right in EN).
// SIGNED-IN USERS NEVER SEE THIS CARD (the pure gate requires `user == null`), on native there are
// no cookies to consent to. Every gate lives in the pure `shouldShowCookieBanner` in lib/cookieConsent
// (barrier-executed in scripts/verify-cookie-consent-gating.ts):
//   appears   signed-out + web, once the session restore settles (authChecked). Appears on EVERY
//             page load — the in-memory `consent` state resets to null on mount, so a refresh brings
//             the card back (owner 2026-09-13). This matches SignInCard's own in-memory dismissal.
//   goes away Three ways, all recording 'all' or 'necessary' in localStorage so `analyticsAllowed()`
//             keeps the visitor's preference across visits:
//              (1) "Allow all" → 'all' with a fade+slide-down exit animation (owner 2026-09-13)
//              (2) "Only necessary" → 'necessary', same exit animation
//              (3) ANY tap outside the card (city dropdown, filter button, «بحث», sidebar…) → 'all'
//                  (owner 2026-09-13: "when he taps on the button in the filter it goes away, and
//                   when it goes away, it means that he agrees").
//   never     for signed-in users, on native. The tap-outside listener is gated on `visible`, which
//             is itself gated on `user == null` — a signed-in user's app is completely untouched.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useApp } from '@/store';
import { useI18n } from '@/i18n';
import { useAtLeast } from '@/lib/useAtLeast';
import { DOCK_BREAKPOINT } from '@/lib/responsive';
import { colors, radius, font } from '@/theme/tokens';
import {
  shouldShowCookieBanner,
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
  // SESSION-ONLY, deliberately not seeded from getCookieConsent() (owner 2026-09-13, permanent):
  // the cookie card must appear on EVERY signed-out visit and disappear only when the visitor signs
  // in, mirroring SignInCard's own dismissal (which is also meant to return). Reading the persisted
  // choice at mount would hide the card on the second visit — the very thing the owner asked to stop.
  // localStorage is still WRITTEN by choose() so `analyticsAllowed()` keeps the user's real
  // preference across visits; only the SHOW gate here is per-pageload, and the reload naturally
  // resets `consent` back to null so the card comes up again.
  const [consent, setConsent] = useState<Consent | null>(null);
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

  // ANY tap on the app (city/district field, «بحث» button, category pill, sidebar, anything at
  // all outside the card itself) counts as consent — owner rule 2026-09-13: "when he taps on the
  // button in the filter it goes away, and when it goes away, it means that he agrees". The
  // listener attaches only while `visible` is true, which is only true for signed-out web visitors —
  // a signed-in user's app is completely untouched. Capture phase → runs before the target's own
  // click handler, so the same tap still fires the filter/search/sign-in action; the card just
  // disappears. `once` is intentionally NOT set: a tap on the card's OWN body (not a button) must
  // return early WITHOUT consuming the one-shot, or a subsequent tap outside would find no listener
  // to dismiss it. Removal is handled by the effect's own cleanup when `visible` flips to false.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onDocClick = (e: Event) => {
      const card = document.querySelector('[data-testid="cookie-consent"]');
      // A click on the card itself is handled by its own onPress — never treat it as an outside tap.
      if (card && e.target instanceof Node && card.contains(e.target)) return;
      choose('all');
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [visible, choose]);

  // EXIT ANIMATION — owner 2026-09-13: "I want to feel like an animation when I click «السماح بالكل»".
  // A soft 220 ms fade+slide-down when the card goes away (from a button tap OR a tap outside),
  // then unmount. `mounted` lingers a beat past `visible` so the exit is visible; `anim` drives
  // opacity 1→0 and translateY 0→12. useNativeDriver=false on web (RNW rAF-drives it there anyway).
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, anim]);

  if (!mounted) return null;

  const c = isRTL ? COPY.ar : COPY.en;
  const textAlign = isRTL ? 'right' : 'left';

  return (
    <Animated.View
      // @ts-expect-error web-only DOM props on the RNW host node
      dataSet={{ testid: 'cookie-consent' }}
      style={[
        st.host,
        {
          opacity: anim,
          transform: [{
            translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
          }],
        },
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
    </Animated.View>
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
