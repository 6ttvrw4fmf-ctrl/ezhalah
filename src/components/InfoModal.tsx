import { useEffect, useMemo, useState } from 'react';
import { I18nManager, Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { useResolvedTheme, useThemePalette } from '@/lib/appearance';
import { alpha0 } from '@/theme/palette';
import { colors, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useApp } from '@/store';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { PLATFORM_META } from '@/data/loaderPlatforms';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const IN = { duration: 240, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const OUT = { duration: 170, easing: Easing.in(Easing.cubic) };
// Reduced-motion variants: a plain cross-fade, scale pinned at 1 — feedback survives, vestibular
// motion does not (the same rule governs the content stagger below).
const IN_REDUCED = { duration: 160, easing: Easing.out(Easing.quad) };
const OUT_REDUCED = { duration: 120, easing: Easing.in(Easing.quad) };
const IS_WEB = Platform.OS === 'web';
// Smooth hover/press transitions for the close button (web only).
const WEB_SMOOTH = IS_WEB ? ({ transitionProperty: 'background-color, transform, box-shadow', transitionDuration: '150ms' } as any) : null;

// Dialog geometry. The close button is absolutely positioned over the card's PHYSICAL top-right,
// so anything laid out in that band has to give up its footprint or the button paints on top of it
// (2026-08-23: the Support heading «المساعدة/تواصل معنا» lost its first word under the ×).
// CLOSE_CLEAR is DERIVED from the button, never hand-tuned separately, so resizing/moving the
// button keeps the heading clear. scripts/verify-info-modal-header-clearance.ts pins the arithmetic.
const BODY_PAD = 24; // body horizontal padding — already buys the heading this much
const CLOSE_INSET = 14; // button offset from the card's top/right edges
const CLOSE_SIZE = 34; // button diameter
const CLOSE_GAP = 8; // minimum breathing room between the heading and the button
// Extra PHYSICAL-right padding a heading needs. `paddingRight` is physical in React Native and
// react-native-web alike (only the *Start/*End variants flip under RTL) — which is exactly what we
// want, because the button is pinned to the physical right in both LTR and RTL.
const CLOSE_CLEAR = CLOSE_INSET + CLOSE_SIZE + CLOSE_GAP - BODY_PAD;
// Vertical clearance for content that starts in the button's top band (the About hero): the RTL
// reading edge is the physical right — exactly where the × lives — so the first line must start
// BELOW the button, derived from the same constants.
const TOP_CLEAR = CLOSE_INSET + CLOSE_SIZE + CLOSE_GAP;

// (The 2026-08-24 two-panel desktop composition and its ABOUT_WIDE_MIN_W breakpoint were retired by
// the owner's 2026-08-29 redesign — one artwork-led column now serves every breakpoint.)

const EAGLE = require('../../assets/images/eagle-mark.png');
const HERO = require('../../assets/images/hero-bg.png');

// The only number «من نحن» shows. Derived from the shipped partner roster at compile time — never a
// hardcoded count that goes stale, and never a dynamic listings/cities figure we'd have to fake.
const PLATFORM_COUNT = PLATFORM_META.length;

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
  const reduced = useReducedMotion();

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, reduced ? IN_REDUCED : IN);
  }, [progress, reduced]);

  const cardStyle = useAnimatedStyle(
    () => ({
      opacity: progress.value,
      transform: [{ scale: reduced ? 1 : interpolate(progress.value, [0, 1], [0.92, 1]) }],
    }),
    [reduced],
  );
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const close = () => {
    progress.value = withTiming(0, reduced ? OUT_REDUCED : OUT, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  // «من نحن» (owner redesign 2026-08-29, supersedes the 2026-08-24 two-panel composition): ONE
  // artwork-led column serves every breakpoint — 640 wide on desktop, edge-inset on mobile. The
  // desktop map panel is gone; the Ezhalah artwork now leads the page itself.
  const availH = height - insets.top - insets.bottom - 48;
  const maxH = Math.min(availH, kind === 'about' ? 660 : 680);

  return (
    <View style={s.overlay}>
      {/* Blurred + softly darkened page behind the dialog — the popup is the single clear focus.
          (owner: keep the blur, increase it slightly, add a subtle dark overlay.) */}
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View style={[s.card, { maxWidth: Math.min(width - 32, kind === 'about' ? 640 : 560), maxHeight: maxH }, cardStyle]}>
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
          {kind === 'support' ? <SupportBody t={t} /> : <AboutBody t={t} reduced={reduced} />}
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

// ————————————————————————————————— «من نحن» ————————————————————————————————————————————————————
// Premium single-screen company card (owner 2026-08-23 — replaces the five-card scroll; compact
// copy approved, legal facts preserved, no dashes, no invented numbers).
//
// Desktop (≥768): one row — hero column (wordmark + thesis sentence + four verb-led value blocks)
// beside a 340px abstract Saudi map panel (street grid, parcels, two pinned listing abstractions,
// the hand-drawn skyline settling at its base under «إزهله وفالك طيب»), closed by a four-column
// small-print legal strip. Fits 800×580 with zero scroll (owner 2026-08-24: compact dialog, not a screen takeover).
// Mobile: the same story stacked — hero, value list, legal card, skyline footer — about one screen.
//
// Motion: the Sheet entrance is the container's only large motion. Inside, a single subtle stagger
// (web only, state + CSS transitions per the RNW idiom): hero 40ms → panel 80ms (fade only) →
// value cells 110/140/170/200ms → legal 230ms (fade only). Everything settles by ~430ms. Native
// renders instantly; reduced motion renders instantly AND the Sheet falls back to a plain fade.

type Tr = (s: string, v?: Record<string, string>) => string;

// One-shot reveal flag: flips after a double rAF so the base (hidden) styles paint first and the
// CSS transition actually runs. When `instant` (native, or reduced motion) it starts true.
// THE STAGGER IS DECORATION, VISIBILITY IS THE FUNCTION (repo rule, src/lib/afterAnimation.ts):
// browsers SUSPEND rAF in hidden/throttled tabs, so a plain timer also flips the flag — whichever
// fires first wins (setState is the latch). Without it the dialog opens permanently blank there.
function useShown(instant: boolean): boolean {
  const [shown, setShown] = useState(instant);
  useEffect(() => {
    if (instant) { setShown(true); return; }
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setShown(true)); });
    const fallback = setTimeout(() => setShown(true), 90); // fires even when rAF is frozen
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(fallback); };
  }, [instant]);
  return shown;
}

// Staggered entrance wrapper. `fadeOnly` for large/background surfaces (the map panel, small print)
// which must not slide — only content blocks get the 8px rise.
function Reveal({ shown, animate, delay, fadeOnly, style, children }: {
  shown: boolean; animate: boolean; delay: number; fadeOnly?: boolean; style?: any; children: React.ReactNode;
}) {
  const webTransition = animate
    ? ({ transitionProperty: 'opacity, transform', transitionDuration: '200ms', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)', transitionDelay: `${delay}ms` } as any)
    : null;
  return (
    <View style={[style, animate && (fadeOnly ? a.revFadeOnly : a.rev), animate && shown && a.revIn, webTransition]}>
      {children}
    </View>
  );
}

function AboutBody({ t, reduced }: { t: Tr; reduced: boolean }) {
  // Literal palette for gradients/surfaces — gradient colors are parsed, var() breaks.
  const pal = useThemePalette();
  const dark = useResolvedTheme() === 'dark';
  const animate = IS_WEB && !reduced;
  const shown = useShown(!animate);
  const rev = { shown, animate };
  const a = useMemo(() => makeAbout(pal, dark), [pal, dark]);

  const values: { icon: keyof typeof Ionicons.glyphMap; label: string; line: string }[] = [
    { icon: 'albums-outline', label: t('We gather'), line: t('Property listings from the licensed platforms in the Kingdom, in one place.') },
    { icon: 'grid-outline', label: t('We organize'), line: t('One organized screen that makes comparing fast and easy.') },
    { icon: 'sparkles-outline', label: t('We help'), line: t('AI-powered search instead of browsing dozens of sites.') },
    { icon: 'open-outline', label: t('We point you to the source'), line: t('We take you to the listing so you contact its original platform directly.') },
  ];
  const legal: { icon: keyof typeof Ionicons.glyphMap; label: string; text: string }[] = [
    { icon: 'compass-outline', label: t('Our role'), text: t('Ezhalah is a search platform only. We do not own, list, sell, or rent properties, and we run no transactions and take no commission.') },
    { icon: 'document-text-outline', label: t('Listing licensing'), text: t('Every listing is published by its source platform and remains subject to its licensing. Ezhalah does not issue or own listings.') },
    { icon: 'alert-circle-outline', label: t('Disclaimer'), text: t('Listings come from external platforms and we do not verify them. Confirm the details with the original platform before any decision.') },
    { icon: 'lock-closed-outline', label: t('Data & privacy'), text: t('We collect only what the service needs, and we do not sell user data.') },
  ];

  return (
    <View>
      {/* ── The artwork IS the hero (owner 2026-08-29): the hand-drawn Saudi skyline bleeds the
          card's full width and melts downward into the surface through a gradient — part of the
          composition, never an image in a box. The lockup rises out of its lower band; TOP_CLEAR
          keeps everything under the floating ×. ── */}
      <Reveal {...rev} delay={40} fadeOnly style={a.heroArt}>
        <RNImage source={HERO} style={a.heroImg} resizeMode="cover" />
        <LinearGradient colors={[alpha0(pal.paper), pal.paper]} locations={[0.15, 0.96]} style={StyleSheet.absoluteFill} />
        <View style={a.heroInner}>
          <Text style={a.eyebrow}>{t('About Us')}</Text>
          <View style={a.lockup}>
            <RNImage source={EAGLE} style={a.eagle} resizeMode="contain" />
            <Text style={a.wordmark}>{t('Ezhalah')}</Text>
            <View style={a.wordDot} />
          </View>
        </View>
      </Reveal>

      <View style={a.body}>
        <Reveal {...rev} delay={90}>
          <Text style={a.heroLine}>{t('Smarter property search, bringing the Saudi market together in one place.')}</Text>
        </Reveal>

        {/* One quiet stat — the number leads, the sentence explains. */}
        <Reveal {...rev} delay={130} style={a.statBand}>
          <Text style={a.statNum}>+{String(PLATFORM_COUNT)}</Text>
          <Text style={a.statLabel}>{t('Real-estate platforms, searched as one.')}</Text>
        </Reveal>

        {/* The four verbs as a 2×2 of soft cards — short, scannable, never a wall of text. */}
        <View style={a.vGrid}>
          {values.map((v, i) => (
            <Reveal key={v.label} {...rev} delay={170 + i * 30} style={a.vCard}>
              <View style={a.vIcon}><Ionicons name={v.icon} size={15} color={pal.primary} /></View>
              <Text style={a.vLabel}>{v.label}</Text>
              <Text style={a.vLine}>{v.line}</Text>
            </Reveal>
          ))}
        </View>

        {/* Trust — present, readable, designed: one quiet card, four icon-led rows. */}
        <Reveal {...rev} delay={310} fadeOnly style={a.trustCard}>
          <Text style={a.trustTitle}>{t('Trust & transparency')}</Text>
          {legal.map((l) => (
            <View key={l.label} style={a.trustRow}>
              <View style={a.trustIcon}><Ionicons name={l.icon} size={13} color={pal.primary} /></View>
              <Text style={a.trustText}>
                <Text style={a.trustLead}>{l.label + ': '}</Text>
                {l.text}
              </Text>
            </View>
          ))}
        </Reveal>

        <Reveal {...rev} delay={360} fadeOnly style={a.footer}>
          <Text style={a.brandLine}>{t('Ezhalah, and may your luck be good.')}</Text>
        </Reveal>
      </View>
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
  // overflow hidden lets the map panel / skyline footer bleed edge-to-edge inside the corners.
  card: { width: '100%', backgroundColor: colors.paper, borderRadius: 24, overflow: 'hidden', ...cardShadow, shadowOpacity: 0.26, shadowRadius: 32 },
  // Circular close pinned to the PHYSICAL top-right (RN `right` is physical — RTL never flips it).
  xBtn: {
    // Physical top-right under BOTH directions: RTL (forced app-wide for Arabic) flips `right:` to
    // the physical left, so the physical right is spelled `left:` there. (owner 2026-08-29)
    position: 'absolute', top: CLOSE_INSET, ...(I18nManager.isRTL ? { left: CLOSE_INSET } : { right: CLOSE_INSET }), zIndex: 5,
    width: CLOSE_SIZE, height: CLOSE_SIZE, borderRadius: CLOSE_SIZE / 2,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: 'rgba(20,40,30,1)', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
    ...(IS_WEB ? ({ cursor: 'pointer' } as any) : {}),
  },
  xBtnHover: { backgroundColor: colors.surface2, transform: [{ scale: 1.06 }] },
  scroll: { paddingTop: 0, paddingBottom: 0 },
  scrollFill: { flexGrow: 1 },
  bodyPad: { paddingHorizontal: BODY_PAD, paddingTop: 26, paddingBottom: 8 },

  // ——— Support (shares the upgraded shell) ———
  // paddingRight keeps the heading out from under the close button (see CLOSE_CLEAR).
  h: { fontSize: 23, fontWeight: '700', color: colors.ink, marginBottom: 16, paddingTop: 4, paddingRight: CLOSE_CLEAR },
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

// «من نحن» styles. Arabic typography rules: NO letterSpacing anywhere (Latin tracking mangles
// Arabic script), weights carry the hierarchy, body leading stays generous (~1.7).
// Palette-driven About styles (owner redesign 2026-08-29): the dialog now themes fully — dark mode
// gets a real dark composition, not a light card in a dark app. No letterSpacing anywhere (Latin
// tracking mangles Arabic script — pinned by verify-about-premium-contract).
function makeAbout(pal: Record<string, string>, dark: boolean) {
  return StyleSheet.create({
    // The artwork hero: full-bleed at the card's top, melting into the surface. paddingTop derives
    // from TOP_CLEAR so the lockup can never collide with the floating × (same arithmetic contract
    // as before — verify-info-modal-header-clearance pins it).
    heroArt: { height: TOP_CLEAR + 128, overflow: 'hidden', justifyContent: 'flex-end' },
    heroImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: dark ? 0.22 : 0.55 },
    heroInner: { paddingHorizontal: 24, paddingTop: TOP_CLEAR, paddingBottom: 2 },
    eyebrow: { fontSize: 12, lineHeight: 18, fontWeight: '700', color: pal.muted, marginBottom: 6 },
    lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    eagle: { width: 30, height: 30, opacity: 0.9 },
    wordmark: { fontSize: 36, lineHeight: 44, fontWeight: '800', color: pal.ink },
    wordDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: pal.accentLeaf ?? pal.primary, alignSelf: 'flex-end', marginBottom: 8 },

    body: { paddingHorizontal: 24, paddingBottom: 18 },
    heroLine: { fontSize: 16.5, lineHeight: 27, fontWeight: '500', color: pal.body, marginTop: 8 },

    statBand: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: pal.line },
    statNum: { fontSize: 30, lineHeight: 34, fontWeight: '800', color: pal.primary, fontVariant: ['tabular-nums'] },
    statLabel: { flex: 1, fontSize: 13.5, lineHeight: 20, fontWeight: '600', color: pal.ink },

    vGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
    vCard: { flexGrow: 1, flexBasis: '44%', minWidth: 200, backgroundColor: dark ? pal.surface : pal.tint, borderRadius: 16, borderWidth: 1, borderColor: dark ? pal.line : pal.tintLine, padding: 14 },
    vIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: dark ? pal.tint : pal.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    vLabel: { fontSize: 14.5, lineHeight: 21, fontWeight: '800', color: pal.ink },
    vLine: { fontSize: 12.5, lineHeight: 20, fontWeight: '400', color: pal.body, marginTop: 4 },

    trustCard: { backgroundColor: pal.surface, borderRadius: 16, borderWidth: 1, borderColor: pal.line, padding: 16, marginTop: 18, gap: 12 },
    trustTitle: { fontSize: 13.5, lineHeight: 20, fontWeight: '800', color: pal.dark ?? pal.ink },
    trustRow: { flexDirection: 'row', gap: 10 },
    trustIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: pal.tint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    trustText: { flex: 1, fontSize: 12, lineHeight: 19, fontWeight: '400', color: pal.body },
    trustLead: { fontWeight: '800', color: pal.dark ?? pal.ink },

    footer: { alignItems: 'center', marginTop: 18 },
    brandLine: { fontSize: 13, fontWeight: '700', color: pal.dark ?? pal.ink },
  });
}

// ——— stagger (web only) ———
const a = StyleSheet.create({
  rev: { opacity: 0, transform: [{ translateY: 8 }] },
  revFadeOnly: { opacity: 0 },
  revIn: { opacity: 1, transform: [{ translateY: 0 }] },
});
