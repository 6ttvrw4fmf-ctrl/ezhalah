import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, I18nManager, Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
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
import { useResolvedTheme, useThemePalette } from '@/lib/appearance';
import { colors, cardShadow } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { useApp } from '@/store';
import {
  MESSAGE_MAX, SUBJECT_MAX, forgetSupportDraft, recallSupportDraft, rememberSupportDraft,
  sendSupportMessage, validateSupportMessage, type SupportField,
} from '@/lib/support';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useAtLeast } from '@/lib/useAtLeast';
import { ABOUT_ART_BREAKPOINT, DOCK_BREAKPOINT } from '@/lib/responsive';
import { canDragAuthPopup } from '@/lib/authPopupBehavior';
import { attachCardDrag, clampOffsetOnScreen } from '@/lib/cardDrag';
import { LEGAL_DOCS, hasLegalDocs } from '@/data/legal';
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
const BODY_PAD = 28; // body horizontal padding — already buys the heading this much
const CLOSE_INSET = 16; // button offset from the card's top/right edges
const CLOSE_SIZE = 34; // button diameter
const CLOSE_GAP = 8; // minimum breathing room between the heading and the button
// Extra PHYSICAL-right padding a heading needs. `paddingRight` is physical in React Native and
// react-native-web alike (only the *Start/*End variants flip under RTL) — which is exactly what we
// want, because the button is pinned to the physical right in both LTR and RTL.
const CLOSE_CLEAR = CLOSE_INSET + CLOSE_SIZE + CLOSE_GAP - BODY_PAD;
// Vertical clearance for content that starts in the button's top band: the RTL reading edge is the
// physical right — exactly where the × lives — so a heading in that band starts BELOW the button's
// top, derived from the same constants. (Only dialogs that HAVE a × need it; «من نحن» has none.)
const TOP_CLEAR = CLOSE_INSET + CLOSE_SIZE + CLOSE_GAP;

// Widths (owner 2026-09-03, the Perplexity-proportion brief): wide, spacious, one simple floating
// card; height follows content, never a screen takeover.
const SUPPORT_MAX_W = 540;
const ABOUT_MAX_W = 760;
const LEGAL_MAX_W = 640;
const ABOUT_MAX_H = 700;

const EAGLE = require('../../assets/images/eagle-mark.png');
// «من نحن» artwork (owner 2026-08-30): the EXISTING Ezhalah eagle looking over the Kingdom's
// properties — assets/images/eagle-night.jpg, 900×1317 (portrait). Owner 2026-09-03: it lives in
// its OWN box now — never a background under text, never zoomed, cropped or stretched.
const ABOUT_ART = require('../../assets/images/eagle-night.jpg');
const ABOUT_ART_RATIO = 900 / 1317;

// The only number «من نحن» shows. Derived from the shipped partner roster at compile time — never a
// hardcoded count that goes stale, and never a dynamic listings/cities figure we'd have to fake.
const PLATFORM_COUNT = PLATFORM_META.length;

type Kind = 'support' | 'about' | 'legal';

// In-app popup that hosts the Support / About / Terms & Privacy content as a centered dialog over a
// blurred, dimmed page. Mounted at the app root (Shell) so it overlays every screen and works in
// both the mobile drawer and the docked web sidebar. Driven by the global `modal` state:
// 'privacy' is the legal dialog opened on its privacy tab (the login popup's link).
export default function InfoModal() {
  const { modal, closeModal } = useApp();
  if (!modal) return null;
  const kind: Kind = modal === 'privacy' ? 'legal' : modal;
  return <Sheet kind={kind} legalTab={modal === 'privacy' ? 'privacy' : 'terms'} onClose={closeModal} />;
}

function Sheet({ kind, legalTab, onClose }: { kind: Kind; legalTab: 'terms' | 'privacy'; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const about = kind === 'about';
  // «من نحن» has NO close button (owner 2026-09-03): the backdrop closes it, and its header is the
  // drag grip. Support and the legal reader keep the × — they are forms and long reads.
  const hasClose = kind !== 'about';

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, reduced ? IN_REDUCED : IN);
  }, [progress, reduced]);

  // Scale pinned at 1 on WEB, not just under reduced motion (iOS focus-zoom, 2026-09-05): this card
  // holds the support form's TextInputs, and iOS Safari decides zoom-on-focus from the EFFECTIVE
  // text size at focus time. A 0.94-scale entrance renders the 16px inputs at 15.04px for the whole
  // entrance window — and users tap the field they opened the form to fill immediately, inside that
  // window — so Safari zoomed the page and never zoomed back (owner report, with screenshot). The
  // fade keeps the feedback; only the scale had to go. verify-input-font-no-ios-zoom.ts §3 pins this.
  const cardStyle = useAnimatedStyle(
    () => ({
      opacity: progress.value,
      transform: [{ scale: reduced || IS_WEB ? 1 : interpolate(progress.value, [0, 1], [0.94, 1]) }],
    }),
    [reduced],
  );
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const close = () => {
    progress.value = withTiming(0, reduced ? OUT_REDUCED : OUT, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  // DESKTOP DRAG for «من نحن» (owner 2026-09-03): the same owner-loved machinery the sign-in popup
  // uses (lib/cardDrag.ts) — 1:1 pointer tracking from the header grip, rubber-band at the viewport
  // edges, a critically damped settle. The offset is painted on the HOST wrapper, a different node
  // from the reanimated card, so the entrance fade+scale and the drag never fight over one
  // transform. No position memory: every open starts perfectly centered; only a move changes it.
  const docked = useAtLeast(DOCK_BREAKPOINT);
  const drag = about && canDragAuthPopup({ isWeb: IS_WEB, docked });
  // Side-by-side art box vs stacked — an SSR-safe flag (useAtLeast), never a raw width compare.
  const wide = useAtLeast(ABOUT_ART_BREAKPOINT);
  const hostRef = useRef<View | null>(null);
  const gripRef = useRef<View | null>(null);
  useEffect(() => {
    if (!drag) return;
    const node = hostRef.current as unknown as HTMLElement | null;
    const grip = gripRef.current as unknown as HTMLElement | null;
    if (!node || !grip) return;
    return attachCardDrag(node, grip, { clamp: clampOffsetOnScreen(node) });
  }, [drag]);

  const availH = height - insets.top - insets.bottom - 48;
  const maxH = Math.min(availH, about ? ABOUT_MAX_H : 720);
  const maxW = about ? ABOUT_MAX_W : kind === 'legal' ? LEGAL_MAX_W : SUPPORT_MAX_W;

  return (
    <View style={[s.overlay, kind === 'legal' && s.overlayTop]}>
      {/* Blurred + softly darkened page behind the dialog — the page stays visible, the card is
          the single sharp layer. */}
      <AnimatedPressable style={[s.backdrop, backdropStyle]} onPress={close} />
      <View ref={hostRef} style={[s.cardHost, { maxWidth: Math.min(width - 32, maxW) }]}>
        <Animated.View style={[s.card, { maxHeight: maxH }, cardStyle]}>
          {/* Close — a quiet control pinned INSIDE the card's PHYSICAL top-right corner (owner
              2026-09-03: part of the modal, small, neutral, clear hover, comfortable hit area). */}
          {/* testID because the ACCESSIBILITY LABEL IS NOT UNIQUE on this screen: AuthModal carries
              its own `accessibilityLabel={t('Close')}` (measured 2026-09-03 at 1440px: two «إغلاق»
              buttons), so a label-based locator can pick a pointer-blocked × and quietly SKIP. */}
          {hasClose && (
            <Pressable
              onPress={close}
              hitSlop={8}
              testID="info-modal-close"
              accessibilityRole="button"
              accessibilityLabel={t('Close')}
              style={({ hovered, pressed }: any) => [s.xBtn, WEB_SMOOTH, (hovered || pressed) && s.xBtnHover]}
            >
              {({ hovered, pressed }: any) => (
                <Ionicons name="close" size={20} color={hovered || pressed ? colors.ink : colors.muted} />
              )}
            </Pressable>
          )}
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {kind === 'support' ? <SupportBody t={t} />
              : kind === 'about' ? <AboutBody t={t} reduced={reduced} gripRef={gripRef} drag={drag} wide={wide} />
              : <LegalBody t={t} initial={legalTab} />}
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}

// ————————————————————————————————— «المساعدة / تواصل معنا» ———————————————————————————————————
// Owner 2026-09-03 (the Perplexity-proportion brief): one clean white card, wider, every section
// with room to breathe — title band, the support form, then partnerships and the response promise
// as quieter secondary sections. VISUAL ONLY — same strings, same fields, same actions, same icons.
function SupportBody({ t }: { t: (s: string, v?: Record<string, string>) => string }) {
  return (
    <View>
      {/* Style `h` keeps its CLOSE_CLEAR physical-right padding so the title can never slide under
          the floating × (verify-info-modal-header-clearance pins that arithmetic). */}
      <View style={s.head}>
        <Text style={s.h}>{t('Support')}</Text>
      </View>

      <View style={s.bodyPad}>
        <SupportForm t={t} />
        {/* Partnerships stay an ADDRESS, not a form: those threads are commercial, they come from
            outside the app as often as inside it, and they are not what «تواصل مع الدعم» is for.
            A hairline separates it from the form — a secondary contact option, not part of it. */}
        <View style={s.sep} />
        <SupCard
          icon="business-outline"
          email="partners@ezhalah.com"
          desc={t('Business inquiries, partnerships, media requests, and general information.')}
        />
        <View style={s.rt}>
          <View style={s.rtHead}>
            <Ionicons name="time-outline" size={15} color={colors.primary} />
            <Text style={s.rtH}>{t('Response Time')}</Text>
          </View>
          <RtRow text={t('Typical response time: {h}.', { h: t('72 hours') })} />
          <RtRow text={t('Some inquiries may take up to {d}.', { d: t('1 week') })} />
        </View>
      </View>
    </View>
  );
}

// The in-app support message (owner 2026-09-02): "build an in-app support message form... that
// reaches support@". Four states and no fifth: idle → sending → sent, or error with the draft still
// on screen so «حاول مرة أخرى» resends exactly what the user wrote. Nothing is cleared on failure —
// losing someone's typed problem report is the one outcome this form must never produce.
function SupportForm({ t }: { t: (s: string, v?: Record<string, string>) => string }) {
  const { locale } = useI18n();
  const { user } = useApp();
  // Closing this dialog UNMOUNTS the form, and its backdrop closes on a tap — so an in-progress
  // draft is restored from the session-scoped cache rather than starting empty. See the long note
  // in lib/supportDraft.ts for the measured loss and why the cache is memory, never disk.
  // Lazy initialisers: `recallSupportDraft()` must run on MOUNT, not on every render.
  const [email, setEmail] = useState(
    // Signed-in users authenticate with Google/Apple, so `sub` IS their email — prefill it rather
    // than making them type an address we already know. Signed-out users type their own. A recalled
    // address wins: the user may have deliberately typed a different one before being interrupted.
    () => recallSupportDraft()?.email || (user?.sub && user.sub.includes('@') ? user.sub : ''),
  );
  const [subject, setSubject] = useState(() => recallSupportDraft()?.subject ?? '');
  const [message, setMessage] = useState(() => recallSupportDraft()?.message ?? '');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [touched, setTouched] = useState(false);
  // Which field has the caret — a clear focus ring is part of the 2026-09-03 input brief.
  const [focus, setFocus] = useState<SupportField | null>(null);
  // WHY the send failed, not just THAT it did. A rate limit and a dead connection are different
  // events with different advice, and telling someone to "check your connection" when the server
  // said 429 sends them to fix a network that is working, then offers a retry that cannot succeed
  // until the hour rolls over — PART 5 shape 12, an error state whose recovery path does not work.
  // `sendSupportMessage` has always distinguished the two; this form used to throw the answer away.
  const [failure, setFailure] = useState<'rate_limited' | 'failed'>('failed');

  const draft = { subject, message, email };
  const missing: SupportField | null = validateSupportMessage(draft);
  const sending = state === 'sending';

  // Every keystroke, so whatever is on screen is what comes back — including a draft too short to
  // send, which is exactly the half-written state a stray backdrop tap catches.
  useEffect(() => { rememberSupportDraft({ subject, message, email }); }, [subject, message, email]);

  async function send() {
    setTouched(true);
    if (missing || sending) return;
    setState('sending');
    const r = await sendSupportMessage(draft, locale === 'en' ? 'en' : 'ar');
    if (r.ok) {
      // Unconditional, and before the setState: if the dialog was dismissed mid-flight this
      // component is already unmounted, and a delivered message must not come back as a draft.
      forgetSupportDraft();
      setState('sent');
      return;
    }
    setFailure(r.reason === 'rate_limited' ? 'rate_limited' : 'failed');
    setState('error');
  }

  if (state === 'sent') {
    return (
      <View style={s.sentCard}>
        <View style={s.sentIc}><Ionicons name="checkmark" size={22} color={colors.onFill} /></View>
        <Text style={s.sentH}>{t('Your message reached us')}</Text>
        {/* Truthful by construction: the message is stored the moment this renders. It promises a
            REPLY to their address — never that an email has already been sent anywhere. */}
        <Text style={s.sentTx}>{t("We'll reply to {email}.", { email })}</Text>
        <Pressable
          onPress={() => { setSubject(''); setMessage(''); setTouched(false); setState('idle'); }}
          style={s.againBtn}
          accessibilityRole="button"
        >
          <Text style={s.againTx}>{t('Send another message')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={s.form}>
      <View style={s.formHead}>
        <View style={s.cardIc}><Ionicons name="headset-outline" size={19} color={colors.primary} /></View>
        <View style={s.supBody}>
          <Text style={s.mail}>{t('Contact support')}</Text>
          <Text style={s.desc}>{t('Questions about your account, searches, or technical issues.')}</Text>
        </View>
      </View>

      <Field label={t('Subject')} invalid={touched && missing === 'subject'} focused={focus === 'subject'}>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          onFocus={() => setFocus('subject')}
          onBlur={() => setFocus(null)}
          editable={!sending}
          maxLength={SUBJECT_MAX}
          placeholder={t('What is this about?')}
          placeholderTextColor={colors.muted}
          style={s.input}
        />
      </Field>

      <Field label={t('Message')} invalid={touched && missing === 'message'} focused={focus === 'message'}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          onFocus={() => setFocus('message')}
          onBlur={() => setFocus(null)}
          editable={!sending}
          maxLength={MESSAGE_MAX}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          placeholder={t('Tell us what happened.')}
          placeholderTextColor={colors.muted}
          style={[s.input, s.area]}
        />
      </Field>

      <Field label={t('Your email')} invalid={touched && missing === 'email'} focused={focus === 'email'}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          onFocus={() => setFocus('email')}
          onBlur={() => setFocus(null)}
          editable={!sending}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="name@example.com"
          placeholderTextColor={colors.muted}
          style={[s.input, s.inputLtr]}
        />
      </Field>

      {state === 'error' ? (
        <View style={s.errRow}>
          <Ionicons name={failure === 'rate_limited' ? 'time-outline' : 'alert-circle-outline'} size={15} color={colors.danger} />
          <Text style={s.errTx}>
            {failure === 'rate_limited'
              ? t('You have sent several messages already. Please wait about an hour before sending another.')
              : t("Couldn't send your message. Check your connection and try again.")}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={send}
        disabled={sending}
        style={({ hovered, pressed }: any) => [s.sendBtn, WEB_SMOOTH, (hovered || pressed) && !sending && s.sendBtnHover, sending && s.sendBtnBusy]}
        accessibilityRole="button"
        accessibilityState={{ disabled: sending }}
      >
        {sending ? (
          <ActivityIndicator size="small" color={colors.onFill} />
        ) : (
          <Ionicons name="paper-plane-outline" size={16} color={colors.onFill} />
        )}
        <Text style={s.sendTx}>{sending ? t('Sending…') : state === 'error' ? t('Try again') : t('Send')}</Text>
      </Pressable>
    </View>
  );
}

function Field({ label, invalid, focused, children }: { label: string; invalid: boolean; focused: boolean; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={[s.fieldBox, WEB_SMOOTH, focused && s.fieldBoxFocus, invalid && s.fieldBoxBad]}>{children}</View>
    </View>
  );
}

// ————————————————————————————————— «من نحن» ————————————————————————————————————————————————————
// Owner 2026-09-03 (design correction): NOT text written over a large background image. A clean
// surface with an intentional structure — header (eyebrow + lockup), the artwork in its OWN box,
// the thesis sentence, «+29» as a real statistic, the four verbs as a 2×2 of feature cards, the
// trust card, the brand line. Every string, icon and fact from the previous composition survives;
// only the composition changed. Desktop (≥640): the art box sits beside the intro column (the
// image is portrait, so beside — never stretched across — is the honest placement). Mobile: the
// same story stacked, the art box centered.
//
// Motion: the Sheet entrance is the container's only large motion. Inside, a single subtle stagger
// (web only, state + CSS transitions per the RNW idiom) that settles by ~430ms. Native renders
// instantly; reduced motion renders instantly AND the Sheet falls back to a plain fade.

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

// Staggered entrance wrapper. `fadeOnly` for large surfaces (the art box, small print) which must
// not slide — only content blocks get the 8px rise.
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

function AboutBody({ t, reduced, gripRef, drag, wide }: {
  t: Tr; reduced: boolean; gripRef: React.MutableRefObject<View | null>; drag: boolean; wide: boolean;
}) {
  // Literal palette for the themed surfaces (the About sheet is a factory, see makeAbout).
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

  // The intro column: eyebrow + lockup are the drag grip (desktop) — the "safe upper area" — then
  // the thesis sentence and the one statistic. On desktop the art box sits beside this column.
  const intro = (
    <View style={a.introCol}>
      <View ref={gripRef} style={[a.head, drag && ({ cursor: 'grab', touchAction: 'none', userSelect: 'none' } as any)]}>
        <Reveal {...rev} delay={40}>
          <Text style={a.eyebrow}>{t('About Us')}</Text>
          <View style={a.lockup}>
            <RNImage source={EAGLE} style={a.eagle} resizeMode="contain" />
            <Text style={a.wordmark}>{t('Ezhalah')}</Text>
            <View style={a.wordDot} />
          </View>
        </Reveal>
      </View>
      <Reveal {...rev} delay={90}>
        <Text style={a.heroLine}>{t('Smarter property search, bringing the Saudi market together in one place.')}</Text>
      </Reveal>
      {/* One quiet statistic — the number leads, the sentence explains. */}
      <Reveal {...rev} delay={130} style={a.statBand}>
        <Text style={a.statNum}>+{String(PLATFORM_COUNT)}</Text>
        <Text style={a.statLabel}>{t('Real-estate platforms, searched as one.')}</Text>
      </Reveal>
    </View>
  );

  // The artwork in its own box: the real image, its real aspect ratio, contained — never a
  // wallpaper, never a crop, no text on top. (verify-about-premium-contract pins this.)
  const art = (
    <Reveal {...rev} delay={70} fadeOnly style={[a.artBox, wide ? a.artBoxWide : a.artBoxNarrow]}>
      <RNImage source={ABOUT_ART} style={a.artImg} resizeMode="contain" />
    </Reveal>
  );

  return (
    <View style={a.body}>
      {wide ? (
        <View style={a.topRow}>
          {intro}
          {art}
        </View>
      ) : (
        <>
          {intro}
          {art}
        </>
      )}

      {/* The four verbs as a 2×2 of feature cards — short, scannable, never a wall of text. */}
      <View style={a.vGrid}>
        {values.map((v, i) => (
          <Reveal key={v.label} {...rev} delay={170 + i * 30} style={a.vCard}>
            <View style={a.vIcon}><Ionicons name={v.icon} size={16} color={pal.primary} /></View>
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
  );
}

// ————————————————————————————————— «الشروط والخصوصية» ——————————————————————————————————————
// A reading dialog with two tabs. The TEXT is the owner's (src/data/legal.ts) — nothing here is
// invented, and the dialog is unreachable until both documents exist (hasLegalDocs gates the
// account-menu row and the login popup's link).
function LegalBody({ t, initial }: { t: Tr; initial: 'terms' | 'privacy' }) {
  const [tab, setTab] = useState<'terms' | 'privacy'>(initial);
  const docs = hasLegalDocs() ? LEGAL_DOCS[tab] : [];
  const tabs: { key: 'terms' | 'privacy'; label: string }[] = [
    { key: 'terms', label: t('Terms of Use') },
    { key: 'privacy', label: t('Privacy Policy') },
  ];
  return (
    <View>
      <View style={s.head}>
        <View style={s.legalLockup}>
          <RNImage source={EAGLE} style={s.legalEagle} resizeMode="contain" />
          <Text style={[s.h, s.legalTitle]}>{t('Terms & Privacy')}</Text>
        </View>
      </View>
      <View style={s.bodyPad}>
        <View style={s.seg} accessibilityRole="tablist">
          {tabs.map((x) => (
            <Pressable
              key={x.key}
              onPress={() => setTab(x.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === x.key }}
              style={({ hovered, pressed }: any) => [s.segBtn, WEB_SMOOTH, tab === x.key && s.segBtnOn, (hovered || pressed) && tab !== x.key && s.segBtnHover]}
            >
              <Text style={[s.segTx, tab === x.key && s.segTxOn]}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
        {/* The legal text names the contact address as the {{CONTACT_EMAIL}} token, substituted here
            — never as a literal in src/data/legal.ts — so verify-info-routes-single-source.ts's
            "no second @ezhalah.com copy anywhere in src/" rule stays true of the DATA layer too,
            not just the other UI surfaces it was written for. This IS the canonical address for
            both: partners@ (Terms) for business/support-shaped inquiries, admin@ (Privacy, owner
            2026-09-04) for data-rights/PDPL requests — a normal split, not a drift risk, since both
            literals still live only here. */}
        {docs.map((p, i) => (
          <Text key={i} style={s.legalP}>
            {p.replace('{{CONTACT_EMAIL}}', tab === 'privacy' ? 'admin@ezhalah.com' : 'partners@ezhalah.com')}
          </Text>
        ))}
      </View>
    </View>
  );
}

// One channel = one RTL row: a distinct glyph names the audience, the address is the hero line
// (kept LTR internally — it's latin), the purpose sentence sits beneath.
function SupCard({ icon, email, desc }: { icon: keyof typeof Ionicons.glyphMap; email: string; desc: string }) {
  return (
    <View style={s.supCard}>
      <View style={s.cardIc}><Ionicons name={icon} size={19} color={colors.primary} /></View>
      <View style={s.supBody}>
        <Text style={s.mail}>{email}</Text>
        <Text style={s.desc}>{desc}</Text>
      </View>
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
  // The legal reader can be opened FROM the sign-in popup (zIndex 200), so it must sit above it.
  overlayTop: { zIndex: 210 },
  // Dim + a real blur (web) so the dialog is unmistakably the focus; the page stays visible behind.
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.5)',
    ...(IS_WEB ? ({ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } as any) : {}),
  },
  // The drag paints its translate on this host; the reanimated card inside keeps its own transform.
  cardHost: { width: '100%' },
  // One simple floating card: white surface, soft corners, a hairline edge, one quiet shadow.
  card: {
    width: '100%', backgroundColor: colors.surface, borderRadius: 22, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.line,
    ...cardShadow, shadowColor: '#0b140f', shadowOpacity: 0.18, shadowRadius: 40, shadowOffset: { width: 0, height: 18 },
  },
  // Close, pinned to the PHYSICAL top-right (RN `right` is physical — RTL never flips it): a
  // quiet neutral glyph at rest, a soft fill on hover, hitSlop widening the target to ≥ 44.
  xBtn: {
    // Physical top-right under BOTH directions: RTL (forced app-wide for Arabic) flips `right:` to
    // the physical left, so the physical right is spelled `left:` there. (owner 2026-08-29)
    position: 'absolute', top: CLOSE_INSET, ...(I18nManager.isRTL ? { left: CLOSE_INSET } : { right: CLOSE_INSET }), zIndex: 5,
    width: CLOSE_SIZE, height: CLOSE_SIZE, borderRadius: CLOSE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    ...(IS_WEB ? ({ cursor: 'pointer' } as any) : {}),
  },
  xBtnHover: { backgroundColor: colors.surface2 },
  scroll: { paddingTop: 0, paddingBottom: 0 },
  bodyPad: { paddingHorizontal: BODY_PAD, paddingTop: 4, paddingBottom: BODY_PAD },

  // ——— title band (Support + legal) ———
  // The heading starts BELOW the ×'s top band (TOP_CLEAR-derived padding) and, being RTL, keeps
  // CLOSE_CLEAR of physical-right room so its first word can never sit under the button.
  head: { paddingHorizontal: BODY_PAD, paddingTop: TOP_CLEAR - CLOSE_GAP - 2, paddingBottom: 10 },
  // paddingRight keeps the heading out from under the close button (see CLOSE_CLEAR).
  h: { fontSize: 22, lineHeight: 30, fontWeight: '800', color: colors.ink, textAlign: 'right', writingDirection: 'auto' as any, paddingRight: CLOSE_CLEAR },
  sep: { height: 1, backgroundColor: colors.line, marginTop: 24, marginBottom: 20 },
  // The legal reader's title row adds the eagle mark ahead of «الشروط والخصوصية». Under RTL that
  // icon becomes the row's LEADING (rightmost) element — the exact slot verify-info-modal-header-
  // clearance.ts exists because a heading once painted under the × there. So CLOSE_CLEAR moves to
  // the ROW, not the text: `h`'s own paddingRight (still asserted by that barrier, untouched) is
  // cancelled back to 0 on this specific usage so the clearance is never reserved twice.
  legalLockup: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: CLOSE_CLEAR },
  legalEagle: { width: 20, height: 20 },
  legalTitle: { paddingRight: 0, flexShrink: 1 },

  // ——— «تواصل مع الدعم» form (owner 2026-09-02; spacing/inputs 2026-09-03) ———
  // The form is the card's main content now — no box-inside-a-box; sections separate by space.
  form: { marginTop: 8 },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22 },
  supBody: { flex: 1, minWidth: 0 },
  cardIc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  mail: { fontSize: 15.5, fontWeight: '800', color: colors.ink, textAlign: 'right', writingDirection: 'ltr' as any },
  desc: { fontSize: 13, color: colors.muted, textAlign: 'right', marginTop: 3, lineHeight: 20 },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: colors.body, textAlign: 'right', marginBottom: 8 },
  // Inputs: one height, one radius, a subtle edge, a clear focus ring (brand green), RTL text.
  fieldBox: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.fieldLine, paddingHorizontal: 14 },
  fieldBoxFocus: { borderColor: colors.primary, ...(IS_WEB ? ({ boxShadow: '0 0 0 3px rgba(47,114,71,0.16)' } as any) : {}) },
  fieldBoxBad: { borderColor: colors.danger },
  input: {
    // 16px on web is not a design choice: under 16 iOS Safari zooms the page on focus and never
    // zooms back. (verify-input-font-no-ios-zoom caught this form at 14.)
    fontSize: IS_WEB ? 16 : 14, color: colors.ink, textAlign: 'right', paddingVertical: 12, minHeight: 48,
    ...(IS_WEB ? ({ outlineStyle: 'none' } as any) : {}),
  },
  inputLtr: { textAlign: 'left', writingDirection: 'ltr' as any },
  area: { minHeight: 132, paddingTop: 12, lineHeight: 22 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
  errTx: { flex: 1, fontSize: 12.5, color: colors.danger, textAlign: 'right', lineHeight: 18 },
  // Send: full width, the brand green, the same radius as the inputs, spaced from the email field.
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 12, height: 50, marginTop: 6,
    ...(IS_WEB ? ({ cursor: 'pointer' } as any) : {}),
  },
  sendBtnHover: { backgroundColor: colors.dark },
  sendBtnBusy: { opacity: 0.75 },
  sendTx: { fontSize: 15, fontWeight: '800', color: colors.onFill },
  sentCard: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 18 },
  sentIc: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  sentH: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sentTx: { fontSize: 13.5, color: colors.body, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  againBtn: { marginTop: 16, paddingVertical: 8, paddingHorizontal: 14, ...(IS_WEB ? ({ cursor: 'pointer' } as any) : {}) },
  againTx: { fontSize: 13.5, fontWeight: '700', color: colors.primary },

  // ——— secondary contact + response promise ———
  supCard: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4, marginBottom: 18 },
  rt: { backgroundColor: colors.tint, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  rtHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  rtH: { fontSize: 13.5, fontWeight: '800', color: colors.ink, textAlign: 'right' },
  rtRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  rtText: { flex: 1, fontSize: 13, color: colors.body, lineHeight: 20, textAlign: 'right' },

  // ——— legal reader ———
  seg: { flexDirection: 'row', backgroundColor: colors.segTrack, borderRadius: 12, padding: 4, gap: 4, marginBottom: 20 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 40, borderRadius: 9, ...(IS_WEB ? ({ cursor: 'pointer' } as any) : {}) },
  segBtnOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  segBtnHover: { backgroundColor: colors.surface2 },
  segTx: { fontSize: 13.5, fontWeight: '700', color: colors.muted },
  segTxOn: { color: colors.ink },
  legalP: { fontSize: 14.5, lineHeight: 26, color: colors.body, textAlign: 'right', marginBottom: 14 },
});

// «من نحن» styles. Arabic typography rules: NO letterSpacing anywhere (Latin tracking mangles
// Arabic script), weights carry the hierarchy, body leading stays generous (~1.7).
// Palette-driven About styles: the dialog themes fully — dark mode gets a real dark composition,
// not a light card in a dark app. (pinned by verify-about-premium-contract)
function makeAbout(pal: Record<string, string>, dark: boolean) {
  return StyleSheet.create({
    body: { paddingHorizontal: BODY_PAD + 4, paddingTop: BODY_PAD, paddingBottom: BODY_PAD },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
    introCol: { flex: 1, minWidth: 0 },
    head: { paddingBottom: 6 },
    eyebrow: { fontSize: 12.5, lineHeight: 18, fontWeight: '700', color: pal.muted, marginBottom: 8 },
    lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    eagle: { width: 30, height: 30, opacity: 0.9 },
    wordmark: { fontSize: 34, lineHeight: 42, fontWeight: '800', color: pal.ink },
    wordDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: pal.accentLeaf ?? pal.primary, alignSelf: 'flex-end', marginBottom: 8 },
    heroLine: { fontSize: 16.5, lineHeight: 27, fontWeight: '500', color: pal.body, marginTop: 12 },

    // The artwork's own box: rounded, hairline edge, a quiet ground, the image CONTAINED at its
    // real aspect ratio (900×1317). Desktop: a fixed-width portrait card beside the intro; mobile:
    // a centered portrait card. No opacity, no gradient, nothing painted on top.
    artBox: { borderRadius: 16, borderWidth: 1, borderColor: pal.line, backgroundColor: dark ? pal.surface2 : pal.tint, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    artBoxWide: { width: 212, aspectRatio: ABOUT_ART_RATIO, marginTop: 4 },
    artBoxNarrow: { alignSelf: 'center', width: '60%', maxWidth: 220, aspectRatio: ABOUT_ART_RATIO, marginTop: 20 },
    artImg: { width: '100%', height: '100%' },

    // The statistic: the number leads at display size, the sentence explains, hairlines frame it.
    statBand: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20, paddingVertical: 14, borderTopWidth: 1, borderBottomWidth: 1, borderColor: pal.line },
    statNum: { fontSize: 36, lineHeight: 42, fontWeight: '800', color: pal.primary, fontVariant: ['tabular-nums'] },
    statLabel: { flex: 1, fontSize: 14, lineHeight: 21, fontWeight: '600', color: pal.ink },

    // Feature cards: real cards — padding, an icon well, a title, a line — light and simple.
    vGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
    vCard: { flexGrow: 1, flexBasis: '44%', minWidth: 200, backgroundColor: dark ? pal.surface2 : pal.tint, borderRadius: 14, borderWidth: 1, borderColor: dark ? pal.line : pal.tintLine, padding: 16 },
    vIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: dark ? pal.tint : pal.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    vLabel: { fontSize: 15, lineHeight: 22, fontWeight: '800', color: pal.ink },
    vLine: { fontSize: 13, lineHeight: 20, fontWeight: '400', color: pal.body, marginTop: 4 },

    trustCard: { backgroundColor: dark ? pal.surface2 : pal.surface, borderRadius: 14, borderWidth: 1, borderColor: pal.line, padding: 16, marginTop: 20, gap: 12 },
    trustTitle: { fontSize: 13.5, lineHeight: 20, fontWeight: '800', color: pal.dark ?? pal.ink },
    trustRow: { flexDirection: 'row', gap: 10 },
    trustIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: pal.tint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    trustText: { flex: 1, fontSize: 12.5, lineHeight: 20, fontWeight: '400', color: pal.body },
    trustLead: { fontWeight: '800', color: pal.dark ?? pal.ink },

    footer: { alignItems: 'center', marginTop: 20 },
    brandLine: { fontSize: 13, fontWeight: '700', color: pal.dark ?? pal.ink },
  });
}

// ——— stagger (web only) ———
const a = StyleSheet.create({
  rev: { opacity: 0, transform: [{ translateY: 8 }] },
  revFadeOnly: { opacity: 0 },
  revIn: { opacity: 1, transform: [{ translateY: 0 }] },
});
