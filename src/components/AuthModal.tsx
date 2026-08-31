import { useEffect, useRef, useState } from 'react';
import { Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, cardShadow } from '@/theme/tokens';
import { Spinner } from '@/components/ui';
import { useApp, type AuthUser } from '@/store';
import { useI18n, t } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useAtLeast } from '@/lib/useAtLeast';
import { DOCK_BREAKPOINT } from '@/lib/responsive';
import { canDragAuthPopup, clampAuthPopupOffset, AUTH_POPUP_POS_KEY } from '@/lib/authPopupBehavior';
import { attachCardDrag } from '@/lib/cardDrag';
import {
  isBackendLive,
  sendPhoneOtp,
  verifyPhoneOtp,
  signInWithProvider,
  authenticateWithFaceId,
} from '@/lib/auth';
import { COUNTRIES, type Country } from '@/data/countries';

// react-native-web does NOT support the `direction` style property (it logs "Invalid style property
// of 'direction'"). To keep the +966 phone row physically LTR even under Arabic/RTL, set the DOM
// `dir` attribute directly via a callback ref instead of a style. (Mirrors the helper in index.tsx.)
const setLtr = (node: any) => {
  if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', 'ltr');
};

const LOGO = require('../../assets/images/ezhalah-logo.png');
type Step = 'main' | 'google' | 'apple' | 'appleface' | 'otp';

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
    // OFFSET MODE: the machinery (lib/cardDrag.ts — shared with the small SignInCard) paints an
    // offset from wherever flex centering rests the card. The clamp derives the UNTRANSLATED base
    // rect per call — live rect minus the currently painted offset — so viewport resizes and
    // content growth (error rows, the country list) are always measured fresh, never cached stale.
    const painted = () => {
      const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(node.style.transform || '');
      return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
    };
    return attachCardDrag(node, grip, {
      posKey: AUTH_POPUP_POS_KEY,
      clamp: (p) => {
        const r = node.getBoundingClientRect();
        const o = painted();
        return clampAuthPopupOffset(
          p,
          { left: r.left - o.x, top: r.top - o.y, width: r.width, height: r.height },
          { w: innerWidth, h: innerHeight },
        );
      },
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
              {/* Desktop grab strip — a designated header region that picks the whole card up. It
                  overlays the grabber pill + eagle area only (never the form), and the close X sits
                  ABOVE it in the stack so closing never begins a drag. Mobile/native: not rendered. */}
              {drag && (
                <View
                  ref={gripRef}
                  // @ts-expect-error web-only DOM props on the RNW host node
                  dataSet={{ testid: 'auth-popup-drag-handle' }}
                  style={[s.grip, { cursor: 'grab', touchAction: 'none', userSelect: 'none' } as never]}
                >
                  <View style={s.gripPill} />
                </View>
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
// THE ONE AUTH UI (owner 2026-08-29): every step of sign-in — Google, Apple, phone+WhatsApp OTP,
// and the preview-only fallbacks — in a single component with two presentations. The centered
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
  const cp = !!compact;
  const [cc, setCc] = useState<Country>(COUNTRIES[0]);
  const [ccOpen, setCcOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<Step>('main');
  const [otp, setOtp] = useState('');
  const [faceDone, setFaceDone] = useState(false);
  const [hideEmail, setHideEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [oauthErr, setOauthErr] = useState('');
  const otpRef = useRef<TextInput>(null);

  const e164 = cc.code + phone;
  const prefixPartial = cc.prefixes.some((p) => phone.startsWith(p) || p.startsWith(phone));
  const prefixOk = cc.prefixes.some((p) => phone.startsWith(p));
  const valid = prefixOk && phone.length === cc.len;
  const phoneError =
    phone.length === 0
      ? ''
      : !prefixPartial || (phone.length === cc.len && !prefixOk)
        ? t('{country} numbers must start with {hint}', { country: t(cc.name), hint: t(cc.hint) })
        : phone.length < cc.len
          ? t('Enter {n} digits', { n: cc.len })
          : '';

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

  // Phone OTP: once 6 digits are entered, verify against the backend (or accept in preview).
  // Unchanged from the old route.
  useEffect(() => {
    if (step !== 'otp' || otp.length !== 6) return;
    let alive = true;
    setBusy(true);
    setOtpError('');
    const timer = setTimeout(async () => {
      const { user, error } = await verifyPhoneOtp(e164, otp);
      if (!alive) return;
      setBusy(false);
      if (user) done(user);
      else {
        setOtp('');
        setOtpError(t(error ?? 'The code you entered is incorrect.'));
      }
    }, 750);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, otp]);

  const onContinuePhone = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const res = await sendPhoneOtp(e164);
    setBusy(false);
    if (res.ok) {
      setOtp('');
      setOtpError('');
      setStep('otp');
    } else {
      setOtpError(t(res.error ?? 'Something went wrong. Please try again.'));
    }
  };

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
    if (ccOpen) return setCcOpen(false);
    if (step === 'main') return onRequestClose();
    if (step === 'appleface') return setStep('apple');
    setStep('main');
    setOtp('');
  };
  // Hand the live back() to the host so its ground-press steps back exactly like the in-card
  // control. Assigned every render — cheap, and always current.
  if (backRef) backRef.current = back;

  const appleEmail = hideEmail ? 'hide-my-email@privaterelay.appleid.com' : 'apple-user@icloud.com';

  return (
    <>
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
                  name={step === 'main' && !ccOpen ? 'close' : isRTL ? 'chevron-forward' : 'chevron-back'}
                  size={20}
                  color={colors.ink}
                />
              </Pressable>
              <RNImage source={LOGO} style={[s.popEagle, cp && c.popEagle]} resizeMode="contain" />
              {/* ── main ───────────────────────────────────────────────── */}
              {step === 'main' && (
                <>
                  <Text style={[s.formHead, cp && c.formHead]}>{t('Sign in or create your account')}</Text>
                  <Text style={[s.agree, cp && c.agree]}>{t("By continuing you agree to Ezhalah's Terms & Privacy Policy.")}</Text>

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

                  <View style={[s.orRow, cp && c.orRow]}>
                    <View style={s.orLine} />
                    <Text style={s.orText}>{t('or')}</Text>
                    <View style={s.orLine} />
                  </View>

                  <View ref={setLtr} style={s.phoneRow}>
                    <View style={[s.cc, cp && c.cc]}>
                      <Text style={s.ccFlag}>{cc.flag}</Text>
                      <Text style={s.ccText}>{cc.code}</Text>
                    </View>
                    <TextInput
                      style={[s.phoneInput, cp && c.phoneInput]}
                      placeholder={t('Phone number')}
                      placeholderTextColor={colors.muted}
                      textAlign="left"
                      keyboardType="number-pad"
                      value={phone}
                      maxLength={cc.len}
                      onChangeText={(v) => setPhone((v.match(/\d/g) ?? []).join('').slice(0, cc.len))}
                    />
                  </View>

                  {ccOpen && (
                    <>
                      <Pressable style={s.scrim} onPress={() => setCcOpen(false)} />
                      <View style={s.ccList}>
                        {COUNTRIES.map((c) => {
                          const sel = c.code === cc.code;
                          return (
                            <Pressable
                              key={c.code}
                              style={[s.ccItem, sel && s.ccItemSel]}
                              onPress={() => {
                                setCc(c);
                                setCcOpen(false);
                                setPhone('');
                              }}
                            >
                              <Text style={s.ccFlag}>{c.flag}</Text>
                              <Text style={[s.ccItemName, sel && { color: colors.dark, fontWeight: '600' }]}>{t(c.name)}</Text>
                              <Text style={[s.ccItemCode, sel && { color: colors.primary }]}>{c.code}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  )}

                  {!!(phoneError || otpError) && <Text style={s.err}>{phoneError || otpError}</Text>}

                  <Pressable style={[s.continue, cp && c.continueBtn, (!valid || busy) && s.continueOff]} disabled={!valid || busy} onPress={onContinuePhone}>
                    {busy ? <Spinner tint="#fff" /> : <Text style={[s.continueText, cp && c.continueText]}>{t('Continue')}</Text>}
                  </Pressable>
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
              {step === 'otp' && (
                <View style={s.otpWrap}>
                  <View style={[s.waBadge, cp && c.waBadge]}>
                    <Ionicons name="logo-whatsapp" size={30} color="#fff" />
                  </View>
                  <Text style={[s.otpTitle, cp && c.otpTitle]}>{t('Enter the code')}</Text>
                  <Text style={[s.otpSub, cp && c.otpSub]}>
                    {t('We sent a 6-digit code on WhatsApp to')}{'\n'}
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{cc.code} {phone}</Text>
                  </Text>

                  <Pressable style={[s.otpBoxes, cp && c.otpBoxes]} onPress={() => otpRef.current?.focus()}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <View key={i} style={[s.otpBox, cp && c.otpBox, otp.length === i && s.otpBoxActive]}>
                        <Text style={[s.otpDigit, cp && c.otpDigit]}>{otp[i] ?? ''}</Text>
                      </View>
                    ))}
                    <TextInput
                      ref={otpRef}
                      style={s.otpHidden}
                      keyboardType="number-pad"
                      autoFocus
                      value={otp}
                      onChangeText={(v) => setOtp((v.match(/\d/g) ?? []).join('').slice(0, 6))}
                    />
                  </Pressable>

                  {!!otpError && <Text style={[s.err, { textAlign: 'center' }]}>{otpError}</Text>}
                  {busy && (
                    <View style={s.verify}>
                      <Spinner />
                      <Text style={s.verifyText}>{t('Verifying…')}</Text>
                    </View>
                  )}
                  <Pressable style={s.resend} hitSlop={8} onPress={() => sendPhoneOtp(e164)}>
                    <Ionicons name="logo-whatsapp" size={15} color={colors.whatsApp} />
                    <Text style={s.resendText}>{t('Resend code on WhatsApp')}</Text>
                  </Pressable>
                </View>
              )}
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
  formHead: { fontSize: 15.5, lineHeight: 22, marginBottom: 4, letterSpacing: 0 },
  agree: { fontSize: 10.5, lineHeight: 15, marginBottom: 12, paddingHorizontal: 0 },
  oauth: { height: 40, borderRadius: 11, marginTop: 8, gap: 7 },
  oauthText: { fontSize: 12.5 },
  orRow: { marginVertical: 7 },
  cc: { height: 44, paddingHorizontal: 9, borderRadius: 11, gap: 4 },
  // fontSize restated (same web-16 rule as the base style) so the iOS-zoom barrier's parser sees
  // it on every referenced style of this input — the compact card never shrinks it below 16.
  phoneInput: { height: 44, paddingHorizontal: 10, borderRadius: 11, fontSize: Platform.OS === 'web' ? 16 : 15 },
  continueBtn: { height: 44, borderRadius: 11, marginTop: 8 },
  continueText: { fontSize: 13.5 },
  otpBoxes: { gap: 4, marginTop: 14 },
  otpBox: { width: 26, height: 40, borderRadius: 8 },
  otpDigit: { fontSize: 16 },
  otpTitle: { fontSize: 16, marginTop: 12 },
  otpSub: { fontSize: 11.5, lineHeight: 17, marginTop: 6 },
  waBadge: { width: 42, height: 42, borderRadius: 12 },
});

const s = StyleSheet.create({
  // zIndex 200 — deliberately above every other root-level overlay in this app (Sidebar 40-50,
  // ShareSheet 60, InfoModal 70, IntroVideo 100), so the sign-in popup always wins the stack even if
  // one of those happens to be open at the same time.
  root: { position: OVERLAY_POSITION, top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(23, 37, 30, 0.18)' },
  scrollHost: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  // Fills the viewport and centers the card; pressing the empty ground closes the popup. Mobile: the
  // popWrap's 100%-width-with-a-cap below already keeps a safe margin on narrow screens without a
  // second breakpoint.
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  popWrap: { width: '100%', maxWidth: 400 },
  // LARGER on desktop (owner 2026-08-28: "larger and more prominent") — the card grows to 470 with
  // a touch more breathing room and a deeper resting shadow. Mobile keeps the owner-approved 400
  // cap and styling exactly as specified 2026-08-15.
  popWrapWide: { maxWidth: 470 },
  popWide: { paddingTop: 40, paddingBottom: 34, paddingHorizontal: 32, shadowOpacity: 0.26, shadowRadius: 44 },
  // The grab strip: an invisible header region (grabber pill + eagle area) that drags the card.
  // zIndex 4 keeps it UNDER the close X (zIndex 5) where the two overlap.
  grip: { position: 'absolute', top: 0, left: 0, right: 0, height: 96, zIndex: 4, alignItems: 'center' },
  // The visible affordance: an iOS-sheet grabber pill in the brand's dark green, quiet but legible
  // ("intentionally draggable" — the card announces the gesture instead of hiding it).
  gripPill: { marginTop: 12, width: 44, height: 5, borderRadius: 3, backgroundColor: 'rgba(29, 74, 55, 0.22)' },
  pop: {
    backgroundColor: colors.surface,
    borderRadius: 26,
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
  popEagle: { alignSelf: 'center', width: 92, height: 74, marginBottom: 12 },
  // Desktop: the mark grows with the card so the larger popup reads as designed, not stretched.
  popEagleWide: { width: 104, height: 84, marginTop: 6 },

  formHead: { fontSize: 26, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 10, lineHeight: 38, letterSpacing: -0.3 },
  agree: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginBottom: 22, lineHeight: 18, paddingHorizontal: 8 },

  oauth: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52, borderRadius: 14, marginTop: 11 },
  google: { backgroundColor: colors.dark },
  apple: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine },
  oauthText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  oauthErr: { fontSize: 12, color: colors.danger, textAlign: 'center', marginTop: 6 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { fontSize: 12, color: colors.muted },

  phoneRow: { flexDirection: 'row', gap: 8 },
  cc: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 52, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.surface },
  ccFlag: { fontSize: 18 },
  ccText: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  // fontSize >= 16 on web: under 16px mobile Safari zooms on focus and never zooms back (barrier:
  // scripts/verify-input-font-no-ios-zoom.ts). Height is fixed at 52 so the box does not reflow.
  // minWidth: 0 travels WITH the 16px bump: WebKit gives an <input> `min-width: auto` (its
  // intrinsic min-content width), so a larger font in a flex row overflows the row instead of
  // shrinking — measured 7.8px past the sheet before this was added. Same pairing as index.tsx's
  // sizeInput/rangeInput, which already carry the note.
  phoneInput: { flex: 1, minWidth: 0, height: 52, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.fieldLine, fontSize: Platform.OS === 'web' ? 16 : 15, color: colors.ink, backgroundColor: colors.surface, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },

  scrim: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000 },
  ccList: { marginTop: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 13, padding: 6, ...cardShadow },
  ccItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 9 },
  ccItemSel: { backgroundColor: colors.tint },
  ccItemName: { flex: 1, fontSize: 13.5, color: colors.ink },
  ccItemCode: { fontSize: 13.5, color: colors.muted, fontWeight: '600' },

  err: { fontSize: 11.5, color: colors.danger, fontWeight: '500', marginTop: 8, marginHorizontal: 2, lineHeight: 16 },
  continue: { backgroundColor: colors.dark, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  continueOff: { opacity: 0.45 },
  continueText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },

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
  otpWrap: { alignItems: 'center', marginTop: 24 },
  waBadge: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.whatsApp, alignItems: 'center', justifyContent: 'center' },
  otpTitle: { fontSize: 20, fontWeight: '700', color: colors.ink, marginTop: 16 },
  otpSub: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  otpBoxes: { flexDirection: 'row', gap: 9, marginTop: 24 },
  otpBox: { width: 44, height: 54, borderRadius: 12, borderWidth: 1.5, borderColor: colors.fieldLine, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  otpBoxActive: { borderColor: colors.primary },
  otpDigit: { fontSize: 22, fontWeight: '700', color: colors.ink },
  // Invisible, but iOS still zooms to the FOCUSED element's font-size — and this one autoFocuses, so
  // without an explicit 16 it inherits react-native-web's 14px default and zooms the OTP screen.
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1, fontSize: 16 },
  verify: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 18 },
  verifyText: { fontSize: 13, color: colors.body },
  resend: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 22 },
  resendText: { fontSize: 13, fontWeight: '600', color: colors.dark },
});
