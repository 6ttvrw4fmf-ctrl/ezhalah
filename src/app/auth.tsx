import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Animated, Easing, Image as RNImage, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import { Spinner } from '@/components/ui';
import HeroBackground from '@/components/HeroBackground';
import { useApp, type AuthUser } from '@/store';
import { useI18n, t } from '@/i18n';
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

const MAX_W = 460;
const LOGO = require('../../assets/images/ezhalah-logo.png');
type Step = 'main' | 'google' | 'apple' | 'appleface' | 'otp';

export default function Auth() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isRTL } = useI18n();
  const { signIn, user } = useApp();
  // True once an in-screen flow (phone/preview) called done() — so the redirect-return
  // effect below doesn't double-navigate on top of it.
  const selfHandled = useRef(false);
  // Entrance: the sheet content (and its X) rises + fades + scales into place on open, so the sign-in
  // screen glides in like a proper sheet instead of a flat hard fade. (user request.)
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 440,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [entrance]);
  const entranceStyle = {
    opacity: entrance,
    transform: [
      { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
      { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.975, 1] }) },
    ],
  };

  // Eagle logo "blink": a subtle two-blink on open — opacity briefly dips then restores, twice,
  // shortly after the page settles. Runs ONCE (not a loop) so it's a gentle wink, never distracting.
  // (user request: subtle blink animation on the eagle logo when the login page opens.)
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const dip = () =>
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.25, duration: 95, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(blink, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      ]);
    const anim = Animated.sequence([Animated.delay(650), dip(), Animated.delay(140), dip()]);
    anim.start();
    return () => anim.stop();
  }, [blink]);

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
    selfHandled.current = true;
    signIn(u);
    router.back();
  };

  // Returning from an external OAuth redirect (Google/Apple): the browser reloads onto
  // /auth and the store adopts the Supabase session, so `user` becomes set without any
  // in-screen flow running. When that happens, take the user into the app — otherwise the
  // login screen would just sit there even though sign-in succeeded.
  useEffect(() => {
    if (user && !selfHandled.current) {
      selfHandled.current = true;
      // If a message was parked at the gate before this OAuth round-trip, land back in the chat so it
      // replays — otherwise the user would lose what they wrote. Read storage directly to dodge the
      // race where `user` resolves before the store rehydrates pendingMessage after a page reload.
      AsyncStorage.getItem('pendingMessage')
        .then((pm) => router.replace(pm ? '/agent' : '/'))
        .catch(() => router.replace('/'));
    }
  }, [user, router]);

  // Apple Face ID: mirror the prototype's scan→verified beat, but on a native build we
  // actually invoke the device biometric (expo-local-authentication) and bail if it fails.
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

  // Google: real OAuth when a backend is configured; the rendered chooser is the
  // preview-only design fallback (Google's own sheet takes over in production).
  const onGoogle = async (fallback: AuthUser) => {
    const r = await signInWithProvider('google');
    if (r.redirected) return; // store adopts the session via onAuthStateChange
    if (r.user) return done(r.user);
    done(fallback);
  };

  const onAppleContinue = async () => {
    // Live backend → real Apple OAuth (mirrors Google). On the web Apple's own sheet/redirect takes
    // over; the store adopts the session on return. NEVER fall back to a fake "Apple User" sign-in —
    // if Apple isn't enabled in Supabase yet (or fails), surface a clear message instead.
    if (isBackendLive) {
      if (Platform.OS === 'web') {
        const r = await signInWithProvider('apple');
        if (r.redirected) return;
        if (r.user) return done(r.user);
      }
      // Web error, or native (native Apple sign-in needs an iOS build + the App ID capability — not
      // wired yet): tell the user, don't fake it.
      setStep('main');
      setOauthErr(t('Apple sign-in isn’t available right now. Please try another method.'));
      return;
    }
    // No backend (design preview only): the prototype's Face ID beat.
    setStep('appleface');
  };

  const back = () => {
    if (ccOpen) return setCcOpen(false);
    // Close the sign-in sheet. Use back() when there's somewhere to return to; otherwise fall back to
    // Home so the X always closes the screen even on a direct/deep-link open. (user request: fix the X.)
    if (step === 'main') return router.canGoBack() ? router.back() : router.replace('/');
    if (step === 'appleface') return setStep('apple');
    setStep('main');
    setOtp('');
  };

  const appleEmail = hideEmail ? 'hide-my-email@privaterelay.appleid.com' : 'apple-user@icloud.com';

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* The Saudi falcon + map sketch sits behind the whole sign-in screen so Google/Apple/phone
          float over the brand scenery instead of flat paper. (user request — attached image.) Kept
          prominent (high opacity, fade only at the very bottom) so the falcon + map clearly read. */}
      <HeroBackground imageOpacity={0.95} fadeStart={0.94} fadeEnd={1} />
      <Animated.View style={[{ flex: 1 }, entranceStyle]}>
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={back} style={s.iconBtn} hitSlop={8}>
          <Ionicons
            name={step === 'main' && !ccOpen ? 'close' : isRTL ? 'chevron-forward' : 'chevron-back'}
            size={22}
            color={colors.ink}
          />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.center} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.col}>
          {/* ── main ───────────────────────────────────────────────── */}
          {step === 'main' && (
            <>
              <View style={s.brandWrap}>
                <Animated.View style={[s.logoRing, { opacity: blink }]}>
                  <RNImage source={LOGO} style={s.logoImg} resizeMode="cover" />
                </Animated.View>
                <Text style={s.heroTitle}>{t('Looking for a property? Ezhalah.')}</Text>
                <Text style={s.heroSub}>
                  {t('Ezhalah brings property listings from the various Saudi real-estate platforms together in one place.')}
                </Text>
              </View>

              <Pressable
                style={[s.oauth, s.google]}
                onPress={() =>
                  // Live backend → redirect straight to the real Google sheet.
                  // No backend (preview) → show the design-only account chooser.
                  isBackendLive
                    ? onGoogle({ method: 'google', initials: 'U', name: 'User', sub: 'user@gmail.com' })
                    : setStep('google')
                }
              >
                <Ionicons name="logo-google" size={18} color="#ea4335" />
                <Text style={s.oauthText}>{t('Continue with Google')}</Text>
              </Pressable>
              <Pressable
                style={[s.oauth, s.apple]}
                onPress={() => {
                  setOauthErr('');
                  // Live backend → straight to the real Apple sheet (like Google). Preview → the
                  // design-only consent mock.
                  isBackendLive ? onAppleContinue() : setStep('apple');
                }}
              >
                <Ionicons name="logo-apple" size={20} color="#fff" />
                <Text style={[s.oauthText, { color: '#fff' }]}>{t('Continue with Apple')}</Text>
              </Pressable>
              {!!oauthErr && <Text style={s.oauthErr}>{oauthErr}</Text>}

              <View style={s.orRow}>
                <View style={s.orLine} />
                <Text style={s.orText}>{t('or')}</Text>
                <View style={s.orLine} />
              </View>

              <View ref={setLtr} style={s.phoneRow}>
                {/* Saudi only (+966) — fixed dial code, no country dropdown. (user request.) */}
                <View style={s.cc}>
                  <Text style={s.ccFlag}>{cc.flag}</Text>
                  <Text style={s.ccText}>{cc.code}</Text>
                </View>
                {/* The phone number is always entered/shown left-to-right with Western digits, and
                    typing it must NEVER swap the page language: it strips to digits only and never
                    touches detectLocale/setLocale. Forcing the field LTR keeps "+966 5XXXXXXXX"
                    reading naturally even while the rest of the page stays Arabic/RTL. */}
                <TextInput
                  style={s.phoneInput}
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

              <Pressable style={[s.continue, (!valid || busy) && s.continueOff]} disabled={!valid || busy} onPress={onContinuePhone}>
                {busy ? <Spinner tint="#fff" /> : <Text style={s.continueText}>{t('Continue')}</Text>}
              </Pressable>
              <Text style={s.fine}>{t("By continuing you agree to Ezhalah's Terms & Privacy Policy.")}</Text>
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
                  <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={16} color="#b6beb9" />
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
              <View style={s.waBadge}>
                <Ionicons name="logo-whatsapp" size={30} color="#fff" />
              </View>
              <Text style={s.otpTitle}>{t('Enter the code')}</Text>
              <Text style={s.otpSub}>
                {t('We sent a 6-digit code on WhatsApp to')}{'\n'}
                <Text style={{ fontWeight: '700', color: colors.ink }}>{cc.code} {phone}</Text>
              </Text>

              <Pressable style={s.otpBoxes} onPress={() => otpRef.current?.focus()}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={[s.otpBox, otp.length === i && s.otpBoxActive]}>
                    <Text style={s.otpDigit}>{otp[i] ?? ''}</Text>
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
        </View>
      </ScrollView>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  // A clear, tappable circular close button (was a bare floating glyph that read as broken). (user request.)
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  // Content flows from the TOP (justifyContent flex-start) so the page scrolls freely instead of
  // locking vertically-centered — the user can scroll the sign-in screen naturally. flexGrow keeps it
  // filling the viewport when the content is short. (user request: "let the user scroll, don't make
  // it stick.") Extra top/bottom padding gives breathing room.
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 24, paddingTop: 40, paddingBottom: 48 },
  col: { width: '100%', maxWidth: MAX_W },

  // Centered hero: logo, then title, then subtitle — generous, balanced spacing on both desktop &
  // mobile. The whole block is centered via the parent `center` style + alignItems center here.
  brandWrap: { alignItems: 'center', alignSelf: 'center', marginBottom: 30, marginTop: 8, width: '100%' },
  // The eagle mark sits in a soft green ring with a tinted halo + shadow so it reads as a deliberate
  // logo, not a floating square. Slightly larger (78) for presence; perfectly centered.
  logoRing: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 3, borderColor: '#ffffff', ...cardShadow,
  },
  logoImg: { width: '100%', height: '100%' },
  heroTitle: { fontSize: 23, fontWeight: '800', color: colors.ink, marginTop: 20, textAlign: 'center', letterSpacing: -0.2, paddingHorizontal: 12 },
  heroSub: { fontSize: 13.5, color: '#5d6f64', textAlign: 'center', marginTop: 10, paddingHorizontal: 18, lineHeight: 21, maxWidth: 340 },

  oauth: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 50, borderRadius: 13, marginTop: 11 },
  google: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dfe3e0' },
  apple: { backgroundColor: '#111' },
  oauthText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  oauthErr: { fontSize: 12, color: '#c0392b', textAlign: 'center', marginTop: 6 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { fontSize: 12, color: '#9aa6a0' },

  phoneRow: { flexDirection: 'row', gap: 8 },
  cc: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 50, paddingHorizontal: 12, borderRadius: 13, borderWidth: 1, borderColor: '#dfe3e0', backgroundColor: '#fff' },
  ccFlag: { fontSize: 18 },
  ccText: { fontSize: 14.5, fontWeight: '600', color: colors.ink },
  phoneInput: { flex: 1, height: 50, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: '#dfe3e0', fontSize: 15, color: colors.ink, backgroundColor: '#fff', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },

  scrim: { position: 'absolute', top: -1000, left: -1000, right: -1000, bottom: -1000 },
  ccList: { marginTop: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 13, padding: 6, ...cardShadow },
  ccItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 9 },
  ccItemSel: { backgroundColor: '#eef6f0' },
  ccItemName: { flex: 1, fontSize: 13.5, color: colors.ink },
  ccItemCode: { fontSize: 13.5, color: colors.muted, fontWeight: '600' },

  err: { fontSize: 11.5, color: '#c0392b', fontWeight: '500', marginTop: 8, marginHorizontal: 2, lineHeight: 16 },
  continue: { backgroundColor: colors.dark, height: 50, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  continueOff: { opacity: 0.4 },
  continueText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },
  fine: { fontSize: 10.5, color: '#9aa6a0', textAlign: 'center', marginTop: 14, paddingHorizontal: 12, lineHeight: 15 },

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
  otpBox: { width: 44, height: 54, borderRadius: 12, borderWidth: 1.5, borderColor: '#dfe3e0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  otpBoxActive: { borderColor: colors.primary },
  otpDigit: { fontSize: 22, fontWeight: '700', color: colors.ink },
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  verify: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 18 },
  verifyText: { fontSize: 13, color: '#5d6f64' },
  resend: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 22 },
  resendText: { fontSize: 13, fontWeight: '600', color: colors.dark },
});
