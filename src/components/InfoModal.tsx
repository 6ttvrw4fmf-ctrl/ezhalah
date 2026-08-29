import { useEffect, useState } from 'react';
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

// The About dialog widens into a two-panel composition on desktop (hero + map panel side by side);
// Support keeps the classic 560 column. The floor is 900, NOT the app's 768 desktop breakpoint:
// at 768 the 340px map panel squeezes the hero to ~300px — value cells collapse to one column and
// the legal strip clips (measured on tablet portrait, 2026-08-23). Below 900 the stacked flow is
// simply the better composition.
const ABOUT_WIDE_MIN_W = 900;

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

  // «من نحن» on desktop is a single-screen composition (800×580, zero scroll); everything else
  // keeps the classic 560×680 column.
  const aboutWide = kind === 'about' && width >= ABOUT_WIDE_MIN_W;
  const availH = height - insets.top - insets.bottom - 48;
  const maxH = Math.min(availH, kind === 'about' ? (aboutWide ? 580 : 620) : 680);

  return (
    <View style={s.overlay}>
      {/* Blurred + softly darkened page behind the dialog — the popup is the single clear focus.
          (owner: keep the blur, increase it slightly, add a subtle dark overlay.) */}
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <Animated.View style={[s.card, { maxWidth: Math.min(width - 32, aboutWide ? 800 : 560), maxHeight: maxH }, cardStyle]}>
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
        <ScrollView contentContainerStyle={[s.scroll, aboutWide && s.scrollFill]} showsVerticalScrollIndicator={false}>
          {kind === 'support' ? <SupportBody t={t} /> : <AboutBody t={t} desktop={aboutWide} reduced={reduced} />}
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

function AboutBody({ t, desktop, reduced }: { t: Tr; desktop: boolean; reduced: boolean }) {
  // Literal palette for the LinearGradients below — gradient colors are parsed, var() breaks.
  const pal = useThemePalette();
  const animate = IS_WEB && !reduced;
  const shown = useShown(!animate);
  const rev = { shown, animate };

  const values: { label: string; line: string; chip?: string }[] = [
    { label: t('We gather'), line: t('Property listings from the licensed platforms in the Kingdom, in one place.'), chip: t('+{n} platforms', { n: String(PLATFORM_COUNT) }) },
    { label: t('We organize'), line: t('One organized screen that makes comparing fast and easy.') },
    { label: t('We help'), line: t('AI-powered search instead of browsing dozens of sites.') },
    { label: t('We point you to the source'), line: t('We take you to the listing so you contact its original platform directly.') },
  ];
  const legal: { label: string; text: string }[] = [
    { label: t('Our role'), text: t('Ezhalah is a search platform only. We do not own, list, sell, or rent properties, and we run no transactions and take no commission.') },
    { label: t('Listing licensing'), text: t('Every listing is published by its source platform and remains subject to its licensing. Ezhalah does not issue or own listings.') },
    { label: t('Disclaimer'), text: t('Listings come from external platforms and we do not verify them. Confirm the details with the original platform before any decision.') },
    { label: t('Data & privacy'), text: t('We collect only what the service needs, and we do not sell user data.') },
  ];

  const hero = (
    <Reveal {...rev} delay={40}>
      <Text style={[a.eyebrow, desktop ? a.eyebrowGapD : a.eyebrowGapM]}>{t('About Us')}</Text>
      {/* Reading-order row: eagle → wordmark → the bright-green full stop (the only saturated
          accent on the text side). Auto-mirrors: first child = physical right in Arabic. */}
      <View style={[a.lockup, desktop ? a.lockupGapD : a.lockupGapM]}>
        <RNImage source={EAGLE} style={desktop ? a.eagle : a.eagleM} resizeMode="contain" />
        <Text style={desktop ? a.wordmark : a.wordmarkM}>{t('Ezhalah')}</Text>
        <View style={desktop ? a.wordDot : a.wordDotM} />
      </View>
      <Text style={desktop ? [a.heroLine, a.heroLineGapD] : a.heroLineM}>
        {t('Smarter property search, bringing the Saudi market together in one place.')}
      </Text>
    </Reveal>
  );

  const cells = values.map((v, i) => (
    <Reveal key={v.label} {...rev} delay={110 + i * 30} style={desktop ? a.valueCell : undefined}>
      <View style={a.valueLabelRow}>
        <View style={a.valueMarker} />
        <Text style={desktop ? a.valueLabel : a.valueLabelM}>{v.label}</Text>
        {v.chip ? (
          <View style={a.statChip}>
            <Text style={a.statChipText}>{v.chip}</Text>
          </View>
        ) : null}
      </View>
      <Text style={desktop ? a.valueLine : a.valueLineM}>{v.line}</Text>
    </Reveal>
  ));

  if (desktop) {
    return (
      <View style={a.aboutRoot}>
        <View style={a.aboutMain}>
          <View style={a.heroCol}>
            {hero}
            <View style={a.valueGrid}>{cells}</View>
          </View>
          <Reveal {...rev} delay={80} fadeOnly style={a.panel}>
            <VisualPanel t={t} />
          </Reveal>
        </View>
        {/* The colophon: four columns of small print. Present and scannable, never hidden. */}
        <Reveal {...rev} delay={230} fadeOnly style={a.legalStrip}>
          {legal.map((l) => (
            <View key={l.label} style={a.legalCol}>
              <Text style={a.legalLabel}>{l.label}</Text>
              <Text style={a.legalText}>{l.text}</Text>
            </View>
          ))}
        </Reveal>
      </View>
    );
  }

  return (
    <>
      <View style={a.bodyPadM}>
        {hero}
        <View style={a.valueListM}>{cells}</View>
      </View>
      <Reveal {...rev} delay={230} fadeOnly style={a.legalCardM}>
        {legal.map((l) => (
          <Text key={l.label} style={a.legalTextM}>
            <Text style={a.legalLeadM}>{l.label + ': '}</Text>
            {l.text}
          </Text>
        ))}
      </Reveal>
      {/* The hand-drawn skyline closes the sheet with the brand line — the current beloved footer,
          kept verbatim as the mobile visual. */}
      <Reveal {...rev} delay={230} fadeOnly style={a.footerM}>
        <RNImage source={HERO} style={a.footerArtM} resizeMode="cover" />
        <LinearGradient colors={[pal.paper, alpha0(pal.paper)]} locations={[0, 0.75]} style={StyleSheet.absoluteFill} />
        <Text style={a.brandLineM}>{t('Ezhalah, and may your luck be good.')}</Text>
      </Reveal>
    </>
  );
}

// The desktop signature: an abstract Saudi map — faint street grid over a light wash, two arterial
// diagonals, two tinted parcels, two listing abstractions pinned to markers, one saturated location
// pin, and the hand-drawn skyline rising out of the wash at the base. Deliberately still: no
// ambient motion, nothing interactive. Coordinates are physical (the panel is its own canvas).
function VisualPanel({ t }: { t: Tr }) {
  // Literal palette pairs for the wash — gradients can't digest var() theme tokens.
  const dark = useResolvedTheme() === 'dark';
  const wash: [string, string] = dark ? ['#141d17', '#17231c'] : ['#f6faf7', '#ecf5ef'];
  const melt: [string, string] = dark ? ['rgba(23,35,28,1)', 'rgba(23,35,28,0)'] : ['rgba(236,245,239,1)', 'rgba(236,245,239,0)'];
  return (
    <>
      <LinearGradient colors={wash} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      {Array.from({ length: 6 }, (_, i) => (
        <View key={'v' + i} style={[a.gridV, { left: 20 + i * 50 }]} />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <View key={'h' + i} style={[a.gridH, { top: 24 + i * 50 }]} />
      ))}
      <View style={[a.diagonal, { left: 90, top: -60, transform: [{ rotate: '18deg' }] }]} />
      <View style={[a.diagonal, { left: 230, top: -80, transform: [{ rotate: '-24deg' }] }]} />
      <View style={[a.parcel, { left: 38, top: 96, width: 64, height: 46 }]} />
      <View style={[a.parcel, { left: 216, top: 236, width: 52, height: 64 }]} />
      <View style={[a.marker, { left: 150, top: 130 }]} />
      <View style={[a.connector, { left: 153.5, top: 138 }]} />
      <MiniCard left={96} top={150} width={132} bars={[64, 88, 46]} />
      <View style={[a.marker, { left: 246, top: 218 }]} />
      <View style={[a.connector, { left: 249.5, top: 226 }]} />
      <MiniCard left={190} top={238} width={116} bars={[56, 78]} />
      <View style={a.pin}>
        <Ionicons name="location-sharp" size={13} color="#ffffff" />
      </View>
      <RNImage source={HERO} style={a.skyline} resizeMode="cover" />
      <LinearGradient colors={melt} locations={[0, 0.7]} style={a.skylineMelt} />
      <Text style={a.brandLine}>{t('Ezhalah, and may your luck be good.')}</Text>
    </>
  );
}

// A listing ABSTRACTION: a green dot and gray bars. Bars only — never fake prices, districts, or
// any listing-like text; fabricated data anywhere in this product is banned.
function MiniCard({ left, top, width, bars }: { left: number; top: number; width: number; bars: number[] }) {
  const [first, ...rest] = bars;
  return (
    <View style={[a.miniCard, { left, top, width }]}>
      <View style={a.miniCardTopRow}>
        <View style={a.miniDot} />
        <View style={[a.barDark, { width: first }]} />
      </View>
      {rest.map((w, i) => (
        <View key={i} style={[a.barLight, { width: w }]} />
      ))}
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
    position: 'absolute', top: CLOSE_INSET, right: CLOSE_INSET, zIndex: 5,
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
const a = StyleSheet.create({
  // ——— shared ———
  aboutRoot: { flex: 1 },
  eyebrow: { fontSize: 12, lineHeight: 18, fontWeight: '700', color: colors.muted },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eagle: { width: 30, height: 30, opacity: 0.9 },
  wordmark: { fontSize: 38, lineHeight: 46, fontWeight: '800', color: colors.ink },
  wordDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.accentLeaf, alignSelf: 'flex-end', marginBottom: 8 },
  heroLine: { fontSize: 17, lineHeight: 28, fontWeight: '500', color: colors.body },
  valueMarker: { width: 6, height: 6, borderRadius: 2, backgroundColor: colors.primary },
  valueLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  valueLabel: { fontSize: 14.5, lineHeight: 22, fontWeight: '800', color: colors.ink },
  valueLine: { fontSize: 13, lineHeight: 22, fontWeight: '400', color: colors.body, marginTop: 6 },
  statChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.tintLine, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, marginHorizontal: 8 },
  statChipText: { fontSize: 12, lineHeight: 16, fontWeight: '800', color: colors.dark },
  brandLine: { position: 'absolute', bottom: 16, left: 0, right: 0, textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.dark },

  // ——— desktop ———
  aboutMain: { flexDirection: 'row', flex: 1, minHeight: 0 },
  // TOP_CLEAR (not plain padding) so the hero's first line — whose RTL reading edge is the physical
  // right, under the × — always starts below the button.
  heroCol: { flex: 1, justifyContent: 'center', paddingHorizontal: 36, paddingTop: TOP_CLEAR, paddingBottom: 32 },
  eyebrowGapD: { marginBottom: 8 },
  lockupGapD: { marginBottom: 14 },
  heroLineGapD: { marginBottom: 20 },
  valueGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 18 },
  valueCell: { width: '46%', minWidth: 170 },

  // ——— visual panel (desktop only) ———
  panel: { width: 320, alignSelf: 'stretch', overflow: 'hidden' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(47,114,71,0.07)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(47,114,71,0.07)' },
  diagonal: { position: 'absolute', width: 1.5, height: 700, backgroundColor: 'rgba(47,114,71,0.10)' },
  parcel: { position: 'absolute', backgroundColor: 'rgba(223,240,228,0.55)', borderRadius: 6 },
  marker: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  connector: { position: 'absolute', width: 1, height: 12, backgroundColor: '#bcd9c6' },
  miniCard: { position: 'absolute', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.tintLine, padding: 10, shadowColor: 'rgba(20,40,30,1)', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  miniCardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  barDark: { height: 6, borderRadius: 3, backgroundColor: '#dfe7e2' },
  barLight: { height: 6, borderRadius: 3, backgroundColor: '#ecf1ee', marginTop: 6 },
  pin: { position: 'absolute', left: 60, top: 252, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: 'rgba(20,40,30,1)', shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  skyline: { position: 'absolute', left: 0, right: 0, bottom: 28, height: 120, opacity: 0.35 },
  skylineMelt: { position: 'absolute', left: 0, right: 0, bottom: 88, height: 60 },

  // ——— legal (desktop strip) ———
  legalStrip: { borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12, flexDirection: 'row', columnGap: 20 },
  legalCol: { flex: 1 },
  legalLabel: { fontSize: 11.5, lineHeight: 16, fontWeight: '800', color: colors.dark, marginBottom: 6 },
  legalText: { fontSize: 11.5, lineHeight: 19, fontWeight: '400', color: colors.body },

  // ——— mobile ———
  bodyPadM: { paddingHorizontal: 22, paddingTop: TOP_CLEAR },
  wordmarkM: { fontSize: 34, lineHeight: 42, fontWeight: '800', color: colors.ink },
  wordDotM: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accentLeaf, alignSelf: 'flex-end', marginBottom: 7 },
  eagleM: { width: 26, height: 26, opacity: 0.9 },
  eyebrowGapM: { marginBottom: 8 },
  lockupGapM: { marginBottom: 12 },
  heroLineM: { fontSize: 16, lineHeight: 26, fontWeight: '500', color: colors.body, marginBottom: 22 },
  valueListM: { gap: 16, marginBottom: 24 },
  valueLabelM: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: colors.ink },
  valueLineM: { fontSize: 13, lineHeight: 22, fontWeight: '400', color: colors.body, marginTop: 4 },
  legalCardM: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.fieldLine, paddingHorizontal: 16, paddingVertical: 14, gap: 10, marginHorizontal: 22, marginBottom: 8 },
  legalTextM: { fontSize: 11.5, lineHeight: 19, fontWeight: '400', color: colors.body },
  legalLeadM: { fontWeight: '800', color: colors.dark },
  footerM: { height: 96, justifyContent: 'flex-end', alignItems: 'center', overflow: 'hidden', marginTop: 8 },
  footerArtM: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', opacity: 0.35 },
  brandLineM: { fontSize: 13, fontWeight: '700', color: colors.dark, marginBottom: 14 },

  // ——— stagger (web only) ———
  rev: { opacity: 0, transform: [{ translateY: 8 }] },
  revFadeOnly: { opacity: 0 },
  revIn: { opacity: 1, transform: [{ translateY: 0 }] },
});
