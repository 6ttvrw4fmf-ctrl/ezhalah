import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Image as RNImage, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius } from '@/theme/tokens';
import { alpha0 } from '@/theme/palette';
import { getAppearance, setAppearance, useThemePalette, type Appearance } from '@/lib/appearance';
import { useApp } from '@/store';
import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { runAfterAnimation } from '@/lib/afterAnimation';
import { DOCK_BREAKPOINT } from '@/lib/responsive';
import { COUNTRIES, type Country } from '@/data/countries';
import { sendPhoneOtp, verifyPhoneOtp } from '@/lib/auth';
import { pickName, buildSyncedName, scriptOf, initialsOf } from '@/lib/nameSync';

// The account menu (owner redesign 2026-08-28) — REPLACES the old centered Settings modal.
// A compact panel anchored to the sidebar's profile row (desktop) / a bottom sheet (mobile), in the
// ChatGPT/Perplexity interaction family but in Ezhalah's own skin. Root: profile header (the eagle
// night artwork — the one bold element; everything else stays quiet hairline rows), then المظهر /
// اللغة / المساعدة / إدارة الحساب, then تسجيل الخروج. المظهر and إدارة الحساب open NESTED views
// inside the same panel (slide + fade, RTL-aware). No parallel settings system: every action calls
// the SAME store/auth functions the old Settings screen called — signOut, deleteAccount, updateUser,
// openModal('support') — and the delete flow keeps its server-first semantics verbatim
// (scripts/verify-account-deletion.ts pins them here now).

const PANEL_W = 316;
const EAGLE = require('../../assets/images/eagle-night.jpg');

// Structure is LTR-pinned like the whole sidebar (icons/chevrons keep physical positions in both
// languages); text still flows in its own language. (Same convention as Sidebar.tsx LTR_PIN.)
const LTR_PIN = { direction: 'ltr' as const };
const WEB_SMOOTH = Platform.OS === 'web' ? ({ transitionProperty: 'background-color', transitionDuration: '150ms' } as any) : null;

type MenuView = 'root' | 'appearance' | 'account';

export default function AccountMenu() {
  const router = useRouter();
  const { width: winW, height: winH } = useWindowDimensions();
  const { locale, isRTL, t } = useI18n();
  const {
    user, updateUser, signOut, deleteAccount, openModal,
    accountMenuOpen, accountMenuAnchor, closeAccountMenu,
  } = useApp();
  const reduced = useReducedMotion();
  const pal = useThemePalette();
  const docked = winW >= DOCK_BREAKPOINT;

  const [view, setView] = useState<MenuView>('root');
  const [appearance, setAppearanceState] = useState<Appearance>('system');

  // ── open/close animation — anchored scale+rise on desktop, sheet slide on mobile ─────────────
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!accountMenuOpen) return;
    setView('root');
    setAppearanceState(getAppearance());
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: reduced ? 120 : 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [accountMenuOpen, enter, reduced]);

  const close = useCallback(() => {
    // Exit along the same path it entered (spatial consistency), then unmount via the store.
    // runAfterAnimation, NEVER a bare .start(cb): on RN-web the completion callback is rAF-driven
    // and silently never fires under throttling — the exact repo-wide hand-off rule (PR#341/#346),
    // and the reason Escape appeared "dead" in the first browser pass of this menu.
    runAfterAnimation(
      (onFinished) =>
        Animated.timing(enter, {
          toValue: 0,
          duration: reduced ? 90 : 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }).start(onFinished),
      () => closeAccountMenu(),
      reduced ? 140 : 200,
    );
  }, [enter, reduced, closeAccountMenu]);

  // Escape closes (owner requirement) — web only, active only while open.
  useEffect(() => {
    if (!accountMenuOpen || Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [accountMenuOpen, close]);

  // ── nested-view transition: fade+slide the content, animate the panel height to the new view ──
  const slide = useRef(new Animated.Value(1)).current;
  const goView = (v: MenuView) => {
    if (reduced) { setView(v); return; }
    // Same hand-off rule as close(): the view SWAP must not depend on the fade-out's callback.
    runAfterAnimation(
      (onFinished) => Animated.timing(slide, { toValue: 0, duration: 90, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start(onFinished),
      () => {
        setView(v);
        Animated.timing(slide, { toValue: 1, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
      },
      130,
    );
  };
  // Sub-views slide in from the chevron side and back out the way they came; RTL mirrors it.
  const dir = (view === 'root' ? 1 : -1) * (isRTL ? -1 : 1);
  const slideStyle = {
    opacity: slide,
    transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [10 * dir, 0] }) }],
  };

  // ── account state (ported verbatim from the old Settings screen — same store calls) ───────────
  const m = user?.method ?? 'phone';
  const shownName = pickName(user, locale);
  const [name, setName] = useState(shownName);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [phOpen, setPhOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Set only when the server refused/failed the delete — the user is never told their account is
  // gone when it isn't. (owner report 2026-08-17.)
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const nameChanged = name.trim().length > 0 && name.trim() !== shownName;

  useEffect(() => {
    if (!editing) setName(pickName(user, locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, user?.name, user?.nameEn, user?.nameAr]);

  const persistName = (v: string) => {
    const sc = scriptOf(v);
    const immediate = sc === 'ar' ? { name: v, nameAr: v } : { name: v, nameEn: v };
    updateUser({ ...immediate, initials: initialsOf(v) });
    buildSyncedName(v).then((synced) => updateUser({ ...synced, initials: initialsOf(v) }));
  };
  const saveName = () => {
    const v = name.trim();
    if (v && v !== shownName) {
      persistName(v);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
    } else if (!v) setName(shownName);
    setEditing(false);
  };

  const onLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setTimeout(() => { signOut(); setConfirmLogout(false); setLoggingOut(false); closeAccountMenu(); router.replace('/'); }, 1200);
  };

  // Server-first delete: only a CONFIRMED delete wipes the device and leaves this menu; a failure
  // keeps the user signed in and says so plainly. (owner report 2026-08-17.)
  const onDeleteAccount = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const ok = await deleteAccount();
    if (!ok) {
      setDeleting(false);
      setDeleteError(t("Couldn't delete your account. Check your connection and try again."));
      return;
    }
    closeAccountMenu();
    router.replace('/');
  };

  if (!accountMenuOpen || !user) return null;

  const appearanceLabel = appearance === 'light' ? t('Light') : appearance === 'dark' ? t('Dark') : t('System');
  const chevron = 'chevron-forward';

  const Row = ({
    icon, label, value, onPress, nested, danger, testID,
  }: {
    icon: any; label: string; value?: string; onPress: () => void; nested?: boolean; danger?: boolean; testID?: string;
  }) => (
    <Pressable
      testID={testID}
      style={({ hovered, pressed }: any) => [s.row, WEB_SMOOTH, (hovered || pressed) && s.rowHover]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.ink} />
      <Text style={[s.rowLabel, danger && { color: colors.danger }]} numberOfLines={1}>{label}</Text>
      <View style={{ flex: 1 }} />
      {!!value && <Text style={s.rowValue} numberOfLines={1}>{value}</Text>}
      {nested && <Ionicons name={chevron} size={14} color={colors.muted} />}
    </Pressable>
  );

  const BackHeader = ({ title }: { title: string }) => (
    <Pressable
      testID="account-menu-back"
      style={({ hovered, pressed }: any) => [s.backRow, WEB_SMOOTH, (hovered || pressed) && s.rowHover]}
      onPress={() => goView('root')}
    >
      <Ionicons name="chevron-back" size={16} color={colors.muted} />
      <Text style={s.backTitle}>{title}</Text>
    </Pressable>
  );

  const Radio = ({ icon, label, on, onPress, testID }: { icon: any; label: string; on: boolean; onPress: () => void; testID?: string }) => (
    <Pressable
      testID={testID}
      style={({ hovered, pressed }: any) => [s.row, WEB_SMOOTH, (hovered || pressed) && s.rowHover]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={17} color={on ? colors.primary : colors.ink} />
      <Text style={[s.rowLabel, on && { color: colors.primary, fontWeight: '700' }]}>{label}</Text>
      <View style={{ flex: 1 }} />
      {on && <Ionicons name="checkmark" size={16} color={colors.primary} />}
    </Pressable>
  );

  const rootView = (
    <>
      {/* The eagle over Saudi Arabia at night — the panel's one bold element. Already a night scene,
          so it fuses with the dark theme and reads as a framed midnight vista in light. */}
      <View style={s.art}>
        <RNImage source={EAGLE} style={s.artImg} resizeMode="cover" />
        <LinearGradient colors={[alpha0(pal.surface), pal.surface]} locations={[0.45, 1]} style={StyleSheet.absoluteFill} />
      </View>
      <View style={s.profile}>
        <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(pickName(user, locale))}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.profileName} numberOfLines={1}>{pickName(user, locale)}</Text>
          {!!user.sub && <Text style={s.profileSub} numberOfLines={1}>{user.sub}</Text>}
        </View>
      </View>
      <View style={s.sep} />
      <Row testID="account-menu-appearance" icon="contrast-outline" label={t('Appearance')} value={appearanceLabel} nested onPress={() => goView('appearance')} />
      {/* Arabic-only product (owner decision, reconfirmed 2026-08-28): the row states the language
          as plain fact — no submenu, no disabled English option pretending to be a choice. */}
      <View style={s.row} testID="account-menu-language">
        <Ionicons name="globe-outline" size={17} color={colors.ink} />
        <Text style={s.rowLabel}>{t('Language')}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.rowValue}>العربية</Text>
      </View>
      <Row testID="account-menu-help" icon="help-circle-outline" label={t('Help')} onPress={() => { close(); setTimeout(() => openModal('support'), 60); }} />
      <Row testID="account-menu-account" icon="person-circle-outline" label={t('Manage account')} nested onPress={() => goView('account')} />
      <View style={s.sep} />
      <Row testID="account-menu-signout" icon="log-out-outline" label={t('Log out')} onPress={() => setConfirmLogout(true)} />
    </>
  );

  const appearanceView = (
    <>
      <BackHeader title={t('Appearance')} />
      {(
        [
          { v: 'system' as const, icon: 'phone-portrait-outline', label: t('System') },
          { v: 'light' as const, icon: 'sunny-outline', label: t('Light') },
          { v: 'dark' as const, icon: 'moon-outline', label: t('Dark') },
        ]
      ).map((o) => (
        <Radio
          key={o.v}
          testID={`appearance-${o.v}`}
          icon={o.icon}
          label={o.label}
          on={appearance === o.v}
          onPress={() => {
            // Applies INSTANTLY (CSS variables flip on the html attribute) and persists per device.
            setAppearance(o.v);
            setAppearanceState(o.v);
          }}
        />
      ))}
      <Text style={s.hint}>{t('System follows your device setting.')}</Text>
    </>
  );

  const accountView = (
    <>
      <BackHeader title={t('Manage account')} />
      {/* Display name — tap to edit inline; explicit Save appears once it actually changed. */}
      <Pressable style={[s.field, editing && s.fieldEditing]} onPress={() => { if (!editing) setEditing(true); }} disabled={editing}>
        <View style={s.fieldHead}>
          <Text style={s.fieldK}>{t('Display Name')}</Text>
          {justSaved && (
            <View style={s.savedTag}>
              <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
              <Text style={s.savedTx}>{t('Name saved')}</Text>
            </View>
          )}
        </View>
        {editing ? (
          <>
            <TextInput
              style={s.input}
              value={name}
              autoFocus
              placeholder={t('Display Name')}
              placeholderTextColor={colors.muted}
              onChangeText={setName}
              onSubmitEditing={saveName}
              returnKeyType="done"
            />
            {nameChanged && (
              <Pressable style={s.saveBtn} onPress={saveName} hitSlop={6}>
                <Ionicons name="checkmark" size={14} color={colors.onFill} />
                <Text style={s.saveBtnText}>{t('Save')}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Text style={s.fieldV} numberOfLines={1}>{name || shownName}</Text>
        )}
      </Pressable>

      {m === 'phone' ? (
        <View style={s.field}>
          <View style={s.fieldHead}>
            <Text style={s.fieldK}>{t('Phone Number')}</Text>
            <Pressable onPress={() => setPhOpen(true)} hitSlop={6}>
              <Text style={s.changeTx}>{t('Change')}</Text>
            </Pressable>
          </View>
          <Text style={s.fieldV}>{user.sub || '+966 5XX XXX XXX'}</Text>
        </View>
      ) : (
        <View style={s.field}>
          <View style={s.fieldHead}>
            <Text style={s.fieldK}>{m === 'apple' ? t('Apple Account') : t('Google Account')}</Text>
            <Text style={s.lockedTx}>{t("Can't be changed")}</Text>
          </View>
          <Text style={s.fieldV} numberOfLines={1}>{user.sub}</Text>
        </View>
      )}

      <View style={s.field}>
        <View style={s.fieldHead}>
          <Text style={s.fieldK}>{t('Logged in device')}</Text>
          <Text style={s.lockedTx}>{t('This device')}</Text>
        </View>
        <Text style={s.fieldV}>{m === 'google' ? t('Android / Chrome') : t('iPhone')}</Text>
      </View>

      {/* Destructive action lives here, quiet by design (owner: accessible, never dominant). */}
      <View style={s.sep} />
      <Row testID="account-menu-delete" icon="trash-outline" label={t('Delete my account')} danger onPress={() => setConfirmDelete(true)} />
    </>
  );

  const content = (
    <Animated.View style={slideStyle}>
      {view === 'root' ? rootView : view === 'appearance' ? appearanceView : accountView}
    </Animated.View>
  );

  // Desktop: anchored above the profile row, growing from its bottom edge. Mobile: bottom sheet.
  const anchored = docked && accountMenuAnchor;
  const panelStyle = anchored
    ? {
        position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
        left: Math.max(8, Math.min(accountMenuAnchor.x, winW - PANEL_W - 8)),
        bottom: Math.max(8, winH - accountMenuAnchor.y + 8),
        width: PANEL_W,
        ...(Platform.OS === 'web' ? ({ transformOrigin: 'left bottom' } as any) : null),
      }
    : ({ position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute', left: 8, right: 8, bottom: 8, maxWidth: 440, alignSelf: 'center', marginHorizontal: 'auto' } as any);

  const panelAnim = reduced
    ? { opacity: enter }
    : anchored
      ? { opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }, { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }
      : { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] };

  return (
    <View style={s.root} pointerEvents="box-none">
      {/* Desktop: a transparent click-catcher (a parallel panel, not a modal task — no dimming).
          Mobile sheet: a real scrim. Either way, clicking outside closes. */}
      <Pressable testID="account-menu-scrim" style={[s.scrim, !anchored && { backgroundColor: colors.scrim }]} onPress={close} />
      <Animated.View testID="account-menu-panel" style={[s.panel, panelStyle, panelAnim, LTR_PIN]}>
        <ScrollView style={{ maxHeight: winH - 96 }} contentContainerStyle={s.panelPad} showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      </Animated.View>

      {/* Log out confirm — same green/neutral pattern the old Settings used. */}
      <Modal visible={confirmLogout} transparent animationType="fade" onRequestClose={() => { if (!loggingOut) setConfirmLogout(false); }}>
        <View style={s.modalRoot}>
          <Pressable style={s.modalBack} onPress={() => { if (!loggingOut) setConfirmLogout(false); }} />
          <View style={s.modalCard}>
            <View style={s.logoutIc}><Ionicons name="log-out-outline" size={22} color={colors.primary} /></View>
            <Text style={s.delT}>{t('Log out?')}</Text>
            <Text style={s.delS}>{t('Are you sure you want to log out?')}</Text>
            <Pressable style={[s.logoutConfirm, loggingOut && { opacity: 0.9 }]} onPress={onLogout} disabled={loggingOut}>
              {loggingOut ? (
                <View style={s.busyRow}>
                  <ActivityIndicator size="small" color={colors.onFill} />
                  <Text style={s.confirmTx}>{t('Signing out…')}</Text>
                </View>
              ) : (
                <Text style={s.confirmTx}>{t('Log out')}</Text>
              )}
            </Pressable>
            <Pressable style={s.delCancel} onPress={() => setConfirmLogout(false)} disabled={loggingOut}>
              <Text style={s.delCancelText}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Delete confirm — server-first, failure surfaced in place, never a silent navigate-away. */}
      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => { if (!deleting) setConfirmDelete(false); }}>
        <View style={s.modalRoot}>
          <Pressable style={s.modalBack} onPress={() => { if (!deleting) setConfirmDelete(false); }} />
          <View style={s.modalCard}>
            <View style={s.delIc}><Ionicons name="trash-outline" size={22} color={colors.danger} /></View>
            <Text style={s.delT}>{t('Delete your account?')}</Text>
            <Text style={s.delS}>{t("This permanently removes your account, saved searches, and chat history. This can't be undone.")}</Text>
            {(m === 'google' || m === 'apple') && (
              <Text style={s.delNote}>
                {t("Note: to change your {provider} account, you'll need to delete this account and sign up again with the new one.", { provider: m === 'google' ? 'Google' : 'Apple' })}
              </Text>
            )}
            <Pressable style={[s.delConfirm, deleting && { opacity: 0.9 }]} onPress={onDeleteAccount} disabled={deleting}>
              {deleting ? (
                <View style={s.busyRow}>
                  <ActivityIndicator size="small" color={colors.onFill} />
                  <Text style={s.confirmTx}>{t('Deleting account…')}</Text>
                </View>
              ) : (
                <Text style={s.confirmTx}>{t('Delete my account')}</Text>
              )}
            </Pressable>
            {deleteError ? <Text style={s.delError}>{deleteError}</Text> : null}
            <Pressable style={s.delCancel} onPress={() => { setDeleteError(null); setConfirmDelete(false); }} disabled={deleting}>
              <Text style={s.delCancelText}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {phOpen && (
        <ChangePhone
          isRTL={isRTL}
          onDone={(newSub) => { updateUser({ sub: newSub }); setPhOpen(false); }}
          onClose={() => setPhOpen(false)}
        />
      )}
    </View>
  );
}

// ── Change phone number (enter → WhatsApp OTP) — moved verbatim from the old Settings screen ────
function ChangePhone({ isRTL, onDone, onClose }: { isRTL: boolean; onDone: (sub: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState<'enter' | 'otp'>('enter');
  const [cc] = useState<Country>(COUNTRIES[0]);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const otpRef = useRef<TextInput>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const e164 = cc.code + phone;
  const prefixOk = cc.prefixes.some((p) => phone.startsWith(p));
  const valid = prefixOk && phone.length === cc.len;
  const liveErr = phone.length === 0 || valid ? '' : t('{country} numbers must start with {hint}', { country: t(cc.name), hint: t(cc.hint) });

  const sendCode = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const r = await sendPhoneOtp(e164);
    setBusy(false);
    if (r.ok) { setOtp(''); setErr(''); setStep('otp'); }
    else setErr(t(r.error ?? 'Something went wrong. Please try again.'));
  };

  const onOtp = async (val: string) => {
    setOtp(val);
    if (val.length === 6) {
      setBusy(true);
      const { user, error } = await verifyPhoneOtp(e164, val);
      setBusy(false);
      if (user) onDone(cc.code + ' ' + phone);
      else { setOtp(''); setErr(t(error ?? 'The code you entered is incorrect.')); }
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalRoot}>
        <Pressable style={s.modalBack} onPress={onClose} />
        <View style={s.modalCard}>
          {step === 'enter' ? (
            <>
              <Text style={s.delT}>{t('Change phone number')}</Text>
              <Text style={s.delS}>{t("Enter your new number, we'll send a verification code on WhatsApp.")}</Text>
              <View style={s.phField}>
                <View style={s.phCc}>
                  <Text style={{ fontSize: 18 }}>{cc.flag}</Text>
                  <Text style={s.phCcText}>{cc.code}</Text>
                </View>
                <TextInput
                  style={s.phInput}
                  autoFocus
                  keyboardType="number-pad"
                  textAlign={isRTL ? 'right' : 'left'}
                  placeholder={t('Phone number')}
                  placeholderTextColor={colors.muted}
                  value={phone}
                  maxLength={cc.len}
                  onChangeText={(v) => setPhone((v.match(/\d/g) ?? []).join('').slice(0, cc.len))}
                />
              </View>
              {!!(liveErr || err) && <Text style={s.phErr}>{liveErr || err}</Text>}
              <Pressable style={[s.delConfirmOk, (!valid || busy) && { opacity: 0.4 }]} disabled={!valid || busy} onPress={sendCode}>
                <Text style={s.confirmTx}>{t('Send code')}</Text>
              </Pressable>
              <Pressable style={s.delCancel} onPress={onClose}>
                <Text style={s.delCancelText}>{t('Cancel')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.waIc}><Ionicons name="logo-whatsapp" size={26} color={colors.onFill} /></View>
              <Text style={s.delT}>{t('Enter the code')}</Text>
              <Text style={s.delS}>
                {t('We sent a 6-digit code on WhatsApp to')}{'\n'}
                <Text style={{ fontWeight: '700', color: colors.ink }}>{cc.code} {phone}</Text>
              </Text>
              <Pressable style={s.otpBoxes} onPress={() => otpRef.current?.focus()}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <View key={i} style={[s.otpBox, otp.length === i && s.otpBoxActive]}>
                    <Text style={s.otpDigit}>{otp[i] ?? ''}</Text>
                  </View>
                ))}
                <TextInput ref={otpRef} style={s.otpHidden} keyboardType="number-pad" autoFocus value={otp} onChangeText={(v) => onOtp((v.match(/\d/g) ?? []).join('').slice(0, 6))} />
              </Pressable>
              {!!err && <Text style={[s.phErr, { textAlign: 'center' }]}>{err}</Text>}
              <Pressable style={s.delCancel} onPress={() => { setStep('enter'); setOtp(''); setErr(''); }}>
                <Text style={s.delCancelText}>{t('Back')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, ...(Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any) : null), zIndex: 60 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  panel: {
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.fieldLine,
    overflow: 'hidden',
    shadowColor: '#0b140f', shadowOpacity: 0.24, shadowRadius: 28, shadowOffset: { width: 0, height: 16 }, elevation: 18,
  },
  panelPad: { paddingBottom: 8 },

  art: { height: 92, width: '100%' },
  artImg: { width: '100%', height: '100%' },
  profile: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingBottom: 10, marginTop: -18 },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  avatarText: { color: colors.onFill, fontSize: 16, fontWeight: '700' },
  profileName: { fontSize: 14.5, fontWeight: '700', color: colors.ink, textAlign: 'left' },
  profileSub: { fontSize: 11.5, color: colors.muted, marginTop: 1, textAlign: 'left' },

  sep: { height: 1, backgroundColor: colors.line, marginVertical: 6, marginHorizontal: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 6, borderRadius: 10 },
  rowHover: { backgroundColor: colors.surface2 },
  rowLabel: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  rowValue: { fontSize: 12, color: colors.muted, fontWeight: '600' },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, marginHorizontal: 6, marginTop: 4, borderRadius: 10 },
  backTitle: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  hint: { fontSize: 11, color: colors.muted, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8, lineHeight: 16 },

  field: { paddingHorizontal: 20, paddingVertical: 9 },
  fieldEditing: {},
  fieldHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fieldK: { fontSize: 11.5, color: colors.muted },
  fieldV: { fontSize: 13.5, fontWeight: '600', color: colors.ink, marginTop: 2 },
  changeTx: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  lockedTx: { fontSize: 11, color: colors.muted },
  savedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  savedTx: { fontSize: 11, fontWeight: '600', color: colors.primary },
  // >= 16 on web or mobile Safari zooms on focus and never restores (scripts/verify-input-font-no-ios-zoom.ts).
  input: { fontSize: Platform.OS === 'web' ? 16 : 15, fontWeight: '600', color: colors.ink, marginTop: 3, borderBottomWidth: 1, borderBottomColor: colors.primary, paddingVertical: 2, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.selFill, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 14, marginTop: 10 },
  saveBtnText: { color: colors.onFill, fontSize: 12.5, fontWeight: '700' },

  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, ...(Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any) : null) },
  modalBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: colors.surface, borderRadius: 22, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 12 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  delIc: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.dangerBg, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  logoutIc: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  waIc: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.whatsApp, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  delT: { fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  delS: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  delNote: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 17, backgroundColor: colors.surface2, borderRadius: 10, padding: 10 },
  delError: { fontSize: 12.5, color: colors.danger, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  delConfirm: { width: '100%', backgroundColor: '#c0392b', borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  delConfirmOk: { width: '100%', backgroundColor: colors.dark, borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  confirmTx: { color: colors.onFill, fontSize: 15, fontWeight: '600' },
  delCancel: { width: '100%', paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  delCancelText: { fontSize: 14, fontWeight: '500', color: colors.muted },
  logoutConfirm: { width: '100%', backgroundColor: colors.selFill, borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 18 },

  phField: { flexDirection: 'row', gap: 8, marginTop: 18, width: '100%' },
  phCc: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.fieldLine, backgroundColor: colors.surface },
  phCcText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  phInput: { flex: 1, minWidth: 0, height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.fieldLine, fontSize: Platform.OS === 'web' ? 16 : 15, color: colors.ink, backgroundColor: colors.surface, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  phErr: { fontSize: 11.5, color: colors.danger, marginTop: 8, alignSelf: 'flex-start' },
  otpBoxes: { flexDirection: 'row', gap: 8, marginTop: 18 },
  otpBox: { width: 38, height: 48, borderRadius: 11, borderWidth: 1.5, borderColor: colors.fieldLine, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  otpBoxActive: { borderColor: colors.primary },
  otpDigit: { fontSize: 20, fontWeight: '700', color: colors.ink },
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1, fontSize: 16 },
});
