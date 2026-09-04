import { useEffect, useRef, useState } from 'react';
import { Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow } from '@/theme/tokens';
import { Spinner } from '@/components/ui';
import { useApp, type AuthUser } from '@/store';
import { useI18n, t } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useAtLeast } from '@/lib/useAtLeast';
import { DOCK_BREAKPOINT } from '@/lib/responsive';
import { canDragAuthPopup } from '@/lib/authPopupBehavior';
import { attachCardDrag, clampOffsetOnScreen } from '@/lib/cardDrag';
import { hasLegalDocs } from '@/data/legal';
import {
  isBackendLive,
  signInWithProvider,
  authenticateWithFaceId,
} from '@/lib/auth';

const LOGO = require('../../assets/images/ezhalah-logo.png');
type Step = 'main' | 'google' | 'apple' | 'appleface';

// Open/close animation (owner spec, 2026-08-15): overlay fade ~200-250ms, popup fades in while
// scaling ~0.96→1 with a small ~8-12px rise, smooth ease-out, no bounce/spring/spin. Close reverses
// the same values over ~150-200ms. ONE shared progress value drives both the backdrop opacity and
// the card's opacity/scale/translate so they move together, not staggered.
const IN = { duration: 220, easing: Easing.out(Easing.cubic) };
const OUT = { duration: 180, easing: Easing.in(Easing.cubic) };

// position:'fixed' on web pins the overlay to the VIEWPORT — immune to the Filter page's own scroll
// position, document height, or which panel/sidebar/card happens to be nearby (owner 2026-08-15:
// "centered... regardless of scroll position... not relative to the Filter card, sidebar, page
// content, or document height"). RN's own `position` type only allows 'absolute'/'relative'; native
// has no independent document scroll to worry about, so only web needs the different value — cast
// past the stricter RN type for that one platform.
const OVERLAY_POSITION = (Platform.OS === 'web' ? 'fixed' : 'absolute') as any;

// True in-place overlay (owner 2026-08-15: "I want the authentication popup to appear directly in
// the center of the screen, above the existing Filter interface... do NOT navigate the user to a
// separate-looking authentication page"). Mounted once at the app root (Shell, _layout.tsx) next to
// InfoModal, driven by store.tsx's authOpen/openAuth/closeAuth — the exact same pattern InfoModal
// already uses for Support/About. The Filter page (or whatever screen the user is actually on) is
// NEVER navigated away from or unmounted, so it stays visible, interactive-looking, and its state
// (selections, scroll position) is untouched the whole time.
//
// ROOT CAUSE this replaces: the old /auth ROUTE used `presentation:'modal'`, and Expo Router
// unmounts the previous screen behind a modal on web (see the removed code's own comment on this,
// and settings.tsx's identical note) — there was no real page left to show, which is why every prior
// attempt needed some kind of fake stand-in behind the popup (a decorative sketch, then a static
// filter lookalike) and never actually satisfied "the Filter page is still there." Route navigation
// was the wrong tool for a dialog; this is a plain overlay component instead.
//
// The only surviving trace of the old route is a tiny stub at src/app/auth.tsx, kept solely as the
// OAuth redirect landing target (Google/Apple/Supabase redirect back to a real URL) — it bounces
// straight to '/' or '/agent' and is never UI a real user sees.
export default function AuthModal() {
  const { authOpen, closeAuth, signIn } = useApp();
  if (!authOpen) return null;
  return <Sheet onClose={closeAuth} onSignedIn={signIn} />;
}

function Sheet({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: (u: AuthUser) => void }) {
  const { isRTL } = useI18n();
  const reducedMotion = useReducedMotion();
  const closingRef = useRef(false);

  // DESKTOP DRAG (owner 2026-08-28): on desktop web the popup can be picked up by its header and
  // moved anywhere on-screen — replacing the old SignInDock side card, whose motion this inherits.
  // The gate is the pure canDragAuthPopup (barrier-executed): mobile web and native never get any
  // of this — they keep the plain centered modal below.
  //
  // MOTION (Apple, WWDC 2018 «Designing Fluid Interfaces»): the drag tracks the pointer 1:1 from
  // the grab offset via Pointer Events with capture, keeps a short velocity history, rubber-bands
  // past the clamp bounds instead of hard-stopping, and on release projects the throw and settles
  // on a spring seeded with the release velocity (damping 1.0 / response 0.4 — Apple's own
  // "move/reposition" pair). The translate is painted straight onto the WRAPPER node (popWrap), a
  // different element from the reanimated card, so the entrance fade+scale and the drag never
  // fight over one transform. Drag lives ONLY on the header grab strip so every button and input
  // in the card body stays plainly clickable; the close X floats ABOVE the strip (zIndex) and is
  // not the strip's child, so pressing it never starts a drag.
  const docked = useAtLeast(DOCK_BREAKPOINT);
  const drag = canDragAuthPopup({ isWeb: Platform.OS === 'web', docked });
  const popRef = useRef<View | null>(null);
  const gripRef = useRef<View | null>(null);

  useEffect(() => {
    if (!drag) return;
    const node = popRef.current as unknown as HTMLElement | null;
    const grip = gripRef.current as unknown as HTMLElement | null;
    if (!node || !grip) return;
    // OFFSET MODE (lib/cardDrag.ts — shared with the small SignInCard and «من نحن»): the painted
    // translate is an offset from wherever flex centering rests the card; clampOffsetOnScreen
    // measures the live geometry per call. NO position memory (owner 2026-09-03): every open starts
    // perfectly centered — only a move changes where the card is, and only for that open.
    return attachCardDrag(node, grip, {
      clamp: clampOffsetOnScreen(node),
    });
  }, [drag]);

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = reducedMotion ? 1 : withTiming(1, IN);
  }, [progress, reducedMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: interpolate(progress.value, [0, 1], [0.96, 1]) },
      { translateY: interpolate(progress.value, [0, 1], [10, 0]) },
    ],
  }));

  // Reverse the same fade+scale out, THEN actually unmount — never cut a half-animated popup.
  // Reduced motion skips straight to the end state both ways (owner: "respect reduced-motion").
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (reducedMotion) { onClose(); return; }
    progress.value = withTiming(0, OUT, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  };

  // The form registers its own back() here so a press on the empty ground steps back exactly the
  // way the in-card control does (country list → main → close), preserving the original semantics
  // now that the step state lives inside AuthForm.
  const backRef = useRef<() => void>(close);

  return (
    <View style={s.root}>
      {/* Subtle dark/grey veil across the whole viewport (owner: "not so aggressive the Filter
          disappears") — the Filter page underneath is never re-rendered, replaced, or unmounted;
          this is purely a translucent paint on top of it. */}
      <Animated.View style={[s.backdrop, backdropStyle]} pointerEvents="none" />
      <ScrollView style={s.scrollHost} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* The outer Pressable fills the viewport — a press on the empty ground closes the popup.
            The inner Pressable swallows presses so touching the card itself never dismisses it. */}
        <Pressable style={s.center} onPress={() => backRef.current()}>
          <Pressable
            ref={popRef as never}
            // @ts-expect-error web-only DOM props on the RNW host node
            dataSet={{ testid: 'auth-popup' }}
            style={[s.popWrap, drag && s.popWrapWide]}
            onPress={() => {}}
          >
            <Animated.View style={[s.pop, drag && s.popWide, cardStyle]}>
              {/* Desktop grab strip — a designated header region (the logo band) that picks the
                  whole card up. It never overlaps the heading, the privacy link or the buttons, so
                  every interactive element stays plainly clickable; the cursor alone announces the
                  gesture (owner 2026-09-03: no visible handle). Mobile/native: not rendered. */}
              {drag && (
                <View
                  ref={gripRef}
                  // @ts-expect-error web-only DOM props on the RNW host node
                  dataSet={{ testid: 'auth-popup-drag-handle' }}
                  style={[s.grip, { cursor: 'grab', touchAction: 'none', userSelect: 'none' } as never]}
                />
              )}
              <AuthForm onRequestClose={close} onSignedIn={onSignedIn} backRef={backRef} />
            </Animated.View>
          </Pressable>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE AUTH UI (owner 2026-08-29): every step of sign-in — Google, Apple, and the preview-only
// fallbacks. Phone/WhatsApp OTP was REMOVED on owner ruling 2026-09-01 ("Google and Apple, that's it");
// scripts/verify-no-phone-auth.ts keeps it out — in a single component with two presentations. The centered
// modal (Sheet above) renders it full-size; the small draggable SignInCard renders it `compact`.
// Only STYLES differ between the two; state, handlers, providers and copy are this one code path,
// so there is never a second auth system to drift.
export function AuthForm({ onRequestClose, onSignedIn, compact, backRef }: {
  onRequestClose: () => void;
  onSignedIn: (u: AuthUser) => void;
  compact?: boolean;
  backRef?: { current: () => void };
}) {
  const { isRTL } = useI18n();
  const { openModal } = useApp();
  const cp = !!compact;
  // «الشروط والخصوصية» is a link ONLY once the owner's legal text exists (src/data/legal.ts); until
  // then it is emphasized plain text — never a link to nothing.
  const legalLive = hasLegalDocs();
  const [step, setStep] = useState<Step>('main');
  const [faceDone, setFaceDone] = useState(false);
  const [hideEmail, setHideEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [oauthErr, setOauthErr] = useState('');

  const done = (u: AuthUser) => {
    onSignedIn(u);
    onRequestClose();
  };

  // Apple Face ID: mirror the prototype's scan→verified beat, but on a native build we actually
  // invoke the device biometric (expo-local-authentication) and bail if it fails. Unchanged from the
  // old route.
  useEffect(() => {
    if (step !== 'appleface') return;
    setFaceDone(false);
    let alive = true;
    const t1 = setTimeout(() => alive && setFaceDone(true), 1500);
    const t2 = setTimeout(() => {
      if (!alive) return;
      done({
        method: 'apple',
        initials: 'AA',
        name: 'Apple User',
        sub: hideEmail ? 'hide-my-email@privaterelay.appleid.com' : 'apple-user@icloud.com',
      });
    }, 2300);
    authenticateWithFaceId().then((r) => {
      if (alive && !r.ok) {
        clearTimeout(t1);
        clearTimeout(t2);
        setStep('apple');
      }
    });
    return () => {
      alive = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Google: real OAuth when a backend is configured; the rendered chooser is the preview-only design
  // fallback (Google's own sheet takes over in production). Unchanged from the old route.
  const onGoogle = async (fallback: AuthUser) => {
    const r = await signInWithProvider('google');
    if (r.redirected) return; // store adopts the session via onAuthStateChange; the OAuth redirect
    // lands on the tiny /auth stub, which bounces back to '/' or '/agent' already signed in.
    if (r.user) return done(r.user);
    done(fallback);
  };

  const onAppleContinue = async () => {
    // Live backend → real Apple OAuth (mirrors Google). NEVER fall back to a fake "Apple User"
    // sign-in — if Apple isn't enabled in Supabase yet (or fails), surface a clear message instead.
    if (isBackendLive) {
      if (Platform.OS === 'web') {
        const r = await signInWithProvider('apple');
        if (r.redirected) return;
        if (r.user) return done(r.user);
      }
      setStep('main');
      setOauthErr(t('Apple sign-in isn’t available right now. Please try another method.'));
      return;
    }
    // No backend (design preview only): the prototype's Face ID beat.
    setStep('appleface');
  };

  const back = () => {
    if (step === 'main') return onRequestClose();
    if (step === 'appleface') return setStep('apple');
    setStep('main');
  };
  // Hand the live back() to the host so its ground-press steps back exactly like the in-card
  // control. Assigned every render — cheap, and always current.
  if (backRef) backRef.current = back;

  const appleEmail = hideEmail ? 'hide-my-email@privaterelay.appleid.com' : 'apple-user@icloud.com';

  return (
    <>
              {/* The centered modal has NO × on its main step (owner 2026-09-03): a press on the
                  ground closes it. The compact SignInCard keeps its × — that is how the card is
                  dismissed — and the preview-only inner steps keep their back chevron. */}
              {(cp || step !== 'main') && (
                <Pressable
                  onPress={back}
                  style={[s.popClose, cp && c.popClose]}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('Close')}
                  // @ts-expect-error web-only DOM props on the RNW host node
                  dataSet={{ testid: 'auth-popup-close' }}
                >
                  <Ionicons
                    name={step === 'main' ? 'close' : isRTL ? 'chevron-forward' : 'chevron-back'}
                    size={20}
                    color={colors.ink}
                  />
                </Pressable>
              )}
              <RNImage source={LOGO} style={[s.popEagle, cp && c.popEagle]} resizeMode="contain" />
              {/* ── main ───────────────────────────────────────────────── */}
              {step === 'main' && (
                <>
                  <Text style={[s.formHead, cp && c.formHead]}>{t('Sign in or create your free account')}</Text>
                  <Text style={[s.formSub, cp && c.formSub]}>{t('Sign in to unlock more of Ezhalah.')}</Text>
                  <Text style={[s.agree, cp && c.agree]}>
                    {t('By continuing, you agree to our')}{' '}
                    {legalLive ? (
                      <Text
                        style={[s.agreeLink, s.agreeLinkLive]}
                        accessibilityRole="link"
                        onPress={() => openModal('legal')}
                        // @ts-expect-error web-only DOM props on the RNW host node
                        dataSet={{ testid: 'auth-privacy-link' }}
                      >
                        {t('Terms & Privacy')}
                      </Text>
                    ) : (
                      <Text style={s.agreeLink}>{t('Terms & Privacy')}</Text>
                    )}
                  </Text>

                  <Pressable
                    style={[s.oauth, cp && c.oauth, s.google]}
                    onPress={() =>
                      isBackendLive
                        ? onGoogle({ method: 'google', initials: 'U', name: 'User', sub: 'user@gmail.com' })
                        : setStep('google')
                    }
                  >
                    <Ionicons name="logo-google" size={18} color="#fff" />
                    <Text style={[s.oauthText, cp && c.oauthText, { color: '#fff' }]}>{t('Continue with Google')}</Text>
                  </Pressable>
                  <Pressable
                    style={[s.oauth, cp && c.oauth, s.apple]}
                    onPress={() => {
                      setOauthErr('');
                      isBackendLive ? onAppleContinue() : setStep('apple');
                    }}
                  >
                    <Ionicons name="logo-apple" size={20} color={colors.ink} />
                    <Text style={[s.oauthText, cp && c.oauthText]}>{t('Continue with Apple')}</Text>
                  </Pressable>
                  {!!oauthErr && <Text style={s.oauthErr}>{oauthErr}</Text>}
                </>
              )}

              {/* ── Google account chooser ─────────────────────────────── */}
              {step === 'google' && (
                <View style={s.gauth}>
                  <View style={s.gauthBar}>
                    <Ionicons name="logo-google" size={18} color="#4285f4" />
                    <Text style={s.gauthBarText}>{t('Sign in with Google')}</Text>
                  </View>
                  <View style={s.gauthApp}>
                    <RNImage source={LOGO} style={s.gauthAppLogo} resizeMode="cover" />
                    <Text style={s.gauthTitle}>{t('Choose an account')}</Text>
                    <Text style={s.gauthSub}>
                      {t('to continue to')} <Text style={{ fontWeight: '600', color: '#202124' }}>{t('Ezhalah')}</Text>
                    </Text>
                  </View>
                  <View style={s.gauthList}>
                    <Pressable style={s.gacct} onPress={() => onGoogle({ method: 'google', initials: 'A', name: 'Ahmed Al-Saud', sub: 'ahmed.alsaud@gmail.com' })}>
                      <View style={s.gav}><Text style={s.gavText}>A</Text></View>
                      <View>
                        <Text style={s.gacctName}>Ahmed Al-Saud</Text>
                        <Text style={s.gacctEmail}>ahmed.alsaud@gmail.com</Text>
                      </View>
                    </Pressable>
                    <Pressable style={s.gacct} onPress={() => onGoogle({ method: 'google', initials: 'S', name: 'Sara M.', sub: 'sara.m@gmail.com' })}>
                      <View style={[s.gav, { backgroundColor: '#d93025' }]}><Text style={s.gavText}>S</Text></View>
                      <View>
                        <Text style={s.gacctName}>Sara M.</Text>
                        <Text style={s.gacctEmail}>sara.m@gmail.com</Text>
                      </View>
                    </Pressable>
                    <Pressable style={[s.gacct, { paddingVertical: 15 }]} onPress={() => onGoogle({ method: 'google', initials: 'U', name: 'User', sub: 'user@gmail.com' })}>
                      <View style={[s.gav, s.gavPlus]}><Ionicons name="person-add-outline" size={18} color="#5f6368" /></View>
                      <Text style={s.gacctName}>{t('Use another account')}</Text>
                    </Pressable>
                  </View>
                  <Text style={s.gauthFine}>{t('To continue, Google will share your name, email address, and profile picture with Ezhalah.')}</Text>
                </View>
              )}

              {/* ── Apple consent sheet ────────────────────────────────── */}
              {step === 'apple' && (
                <View style={s.appleWrap}>
                  <View style={s.appleCard}>
                    <View style={s.appleLogo}>
                      <Ionicons name="logo-apple" size={34} color="#000" />
                    </View>
                    <Text style={s.appleH}>
                      {t('Sign in to')} <Text style={{ fontWeight: '700' }}>{t('Ezhalah')}</Text> {t('with your Apple Account')}
                    </Text>
                    <View style={s.appleAcct}>
                      <View style={s.appleAv}><Text style={s.appleAvText}>AA</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.appleAcctName}>Ahmed Al-Saud</Text>
                        <Text style={s.appleAcctEmail} numberOfLines={1}>{appleEmail}</Text>
                      </View>
                      <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.muted} />
                    </View>
                    <Pressable style={s.appleEmail} onPress={() => setHideEmail((h) => !h)}>
                      <View style={s.appleEmailL}>
                        <View style={s.appleEmailIc}><Ionicons name="mail-outline" size={18} color={colors.ink} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.appleEmailT}>{hideEmail ? t('Hide My Email') : t('Share My Email')}</Text>
                          <Text style={s.appleEmailS} numberOfLines={1}>{hideEmail ? t("Ezhalah won't see your address") : 'apple-user@icloud.com'}</Text>
                        </View>
                      </View>
                      <View style={[s.toggle, hideEmail && s.toggleOn]}>
                        <View style={[s.knob, hideEmail && s.knobOn]} />
                      </View>
                    </Pressable>
                    <Pressable style={s.appleContinue} onPress={onAppleContinue}>
                      <Text style={s.appleContinueText}>{t('Continue')}</Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* ── Apple Face ID ──────────────────────────────────────── */}
              {step === 'appleface' && (
                <View style={s.faceWrap}>
                  <View style={[s.faceIc, faceDone && s.faceIcDone]}>
                    <Ionicons name={faceDone ? 'checkmark' : 'scan-outline'} size={44} color="#fff" />
                  </View>
                  <Text style={s.faceT}>{t('Face ID')}</Text>
                  <Text style={s.faceS}>{faceDone ? t('Verified') : t('Confirm to sign in to Ezhalah')}</Text>
                </View>
              )}

              {/* ── WhatsApp OTP ───────────────────────────────────────── */}
    </>
  );
}

// COMPACT overlays for the small SignInCard presentation (owner 2026-08-29: "full login,
// shrunk"). Sizes only — colors/copy/logic are the shared form above. The phoneInput font size is
// deliberately NOT overridden (16 on web — the iOS-zoom barrier's rule applies to the shared
// style). The preview-only google/apple/appleface steps keep full-size styles: with a live
// backend those steps are never reached (real OAuth redirects take over).
const c = StyleSheet.create({
  popClose: { top: 8, end: 8, width: 26, height: 26, borderRadius: 13 },
  popEagle: { width: 52, height: 42, marginTop: 10, marginBottom: 6 },
  formHead: { fontSize: 15.5, lineHeight: 22, marginBottom: 2 },
  formSub: { fontSize: 11.5, lineHeight: 16, marginBottom: 4 },
  agree: { fontSize: 10.5, lineHeight: 15, marginBottom: 12, paddingHorizontal: 0 },
  oauth: { height: 40, borderRadius: 11, marginTop: 8, gap: 7 },
  oauthText: { fontSize: 12.5 },
});

const s = StyleSheet.create({
  // zIndex 200 — deliberately above every other root-level overlay in this app (Sidebar 40-50,
  // ShareSheet 60, InfoModal 70, IntroVideo 100), so the sign-in popup always wins the stack even if
  // one of those happens to be open at the same time.
  root: { position: OVERLAY_POSITION, top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 },
  // Dim + blur (web): the page stays visible and softened behind; the card is the one sharp layer.
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.42)',
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' } as any) : {}),
  },
  scrollHost: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  // Fills the viewport and centers the card; pressing the empty ground closes the popup. Mobile: the
  // popWrap's 100%-width-with-a-cap below already keeps a safe margin on narrow screens without a
  // second breakpoint.
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  popWrap: { width: '100%', maxWidth: 400 },
  // LARGER on desktop (owner 2026-09-03, the Perplexity-proportion brief): 500 wide, more internal
  // padding, more space between every element. Mobile keeps the 400 cap with safe edge margins.
  popWrapWide: { maxWidth: 500 },
  popWide: { paddingTop: 40, paddingBottom: 36, paddingHorizontal: 36, shadowOpacity: 0.24, shadowRadius: 44 },
  // The grab strip: an invisible header region (the logo band) that drags the card. It ends above
  // the heading so the text, the privacy link and the buttons never start a drag.
  grip: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, zIndex: 4 },
  pop: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingTop: 34,
    paddingBottom: 30,
    paddingHorizontal: 26,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#12251b',
    shadowOpacity: 0.22,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  // X (or back-chevron on inner steps) pinned in the card corner — RTL-aware via `end`.
  popClose: {
    position: 'absolute', top: 14, end: 14, zIndex: 5,
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2,
  },
  // The bare dark-green eagle mark. No separate fly-in/bounce/wink — the whole card (including this)
  // fades+scales in together as ONE motion (owner 2026-08-15: "no bouncing, spinning, excessive
  // movement, or flashy animation" — a back-eased overshoot + blink sequence doesn't qualify).
  popEagle: { alignSelf: 'center', width: 100, height: 80, marginBottom: 14 },

  // Arabic typography: weights carry the hierarchy — no Latin letter-spacing on Arabic script.
  formHead: { fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 6, lineHeight: 34 },
  formSub: { fontSize: 14.5, color: colors.body, textAlign: 'center', marginBottom: 10, lineHeight: 22 },
  // Owner 2026-09-04: the agreement line reads as its own, separate block below the intro — not
  // packed against the subline. marginTop 14 (on top of formSub's own marginBottom 10) opens a
  // ~24px gap, matching the gap already below this line before the OAuth buttons.
  agree: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 14, marginBottom: 24, lineHeight: 18, paddingHorizontal: 8 },
  agreeLink: { color: colors.ink, fontWeight: '600' },
  agreeLinkLive: { textDecorationLine: 'underline' },

  oauth: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 14, marginTop: 12 },
  google: { backgroundColor: colors.dark },
  apple: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine },
  oauthText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  oauthErr: { fontSize: 12, color: colors.danger, textAlign: 'center', marginTop: 6 },


  // fontSize >= 16 on web: under 16px mobile Safari zooms on focus and never zooms back (barrier:
  // scripts/verify-input-font-no-ios-zoom.ts). Height is fixed at 52 so the box does not reflow.
  // minWidth: 0 travels WITH the 16px bump: WebKit gives an <input> `min-width: auto` (its
  // intrinsic min-content width), so a larger font in a flex row overflows the row instead of
  // shrinking — measured 7.8px past the sheet before this was added. Same pairing as index.tsx's
  // sizeInput/rangeInput, which already carry the note.



  // Google
  gauth: { marginTop: 20 },
  gauthBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: '#ececec' },
  gauthBarText: { fontSize: 14, fontWeight: '500', color: '#3c4043' },
  gauthApp: { alignItems: 'center', paddingVertical: 22 },
  gauthAppLogo: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  gauthTitle: { fontSize: 22, fontWeight: '400', color: '#202124' },
  gauthSub: { fontSize: 14, color: '#5f6368', marginTop: 4 },
  gauthList: { paddingVertical: 4 },
  gacct: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 8 },
  gav: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a73e8', alignItems: 'center', justifyContent: 'center' },
  gavText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  gavPlus: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#dadce0' },
  gacctName: { fontSize: 14, fontWeight: '500', color: '#202124' },
  gacctEmail: { fontSize: 12.5, color: '#5f6368' },
  gauthFine: { fontSize: 11, color: '#5f6368', lineHeight: 16, paddingTop: 18, marginTop: 8, borderTopWidth: 1, borderTopColor: '#ececec' },

  // Apple
  appleWrap: { justifyContent: 'center', marginTop: 10 },
  appleCard: { backgroundColor: '#fff', borderRadius: 22, padding: 22, paddingTop: 26, ...cardShadow },
  appleLogo: { alignItems: 'center' },
  appleH: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.ink, marginVertical: 14, marginHorizontal: 4, lineHeight: 22 },
  appleAcct: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f4f4f6', borderRadius: 14, padding: 13 },
  appleAv: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  appleAvText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  appleAcctName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  appleAcctEmail: { fontSize: 12, color: colors.muted },
  appleEmail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#f4f4f6', borderRadius: 14, padding: 13, marginTop: 10 },
  appleEmailL: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  appleEmailIc: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#e8eae9', alignItems: 'center', justifyContent: 'center' },
  appleEmailT: { fontSize: 14, fontWeight: '600', color: colors.ink },
  appleEmailS: { fontSize: 12, color: colors.muted },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: '#d3d6d4', justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.primary },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', marginLeft: 3, ...cardShadow },
  knobOn: { marginLeft: 21 },
  appleContinue: { backgroundColor: '#000', height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  appleContinueText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Face ID
  faceWrap: { alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 14 },
  faceIc: { width: 86, height: 86, borderRadius: 24, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  faceIcDone: { backgroundColor: colors.primary },
  faceT: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 4 },
  faceS: { fontSize: 13.5, color: colors.muted },

  // OTP
  // Invisible, but iOS still zooms to the FOCUSED element's font-size — and this one autoFocuses, so
  // without an explicit 16 it inherits react-native-web's 14px default and zooms the OTP screen.
});
