import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors as lightColors, radius } from '@/theme/tokens';
import { useTheme, type ThemeMode } from '@/theme/theme';
import { useApp } from '@/store';

import { useI18n } from '@/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { pickName, buildSyncedName, scriptOf, initialsOf } from '@/lib/nameSync';
import { COUNTRIES, type Country } from '@/data/countries';
import { persistDisplayName, sendPhoneOtp, verifyPhoneOtp } from '@/lib/auth';

// ── THE SIDEBAR-ANCHORED ACCOUNT MENU (owner 2026-08-28) ─────────────────────────────────────────
// Replaces the centered Settings modal (src/app/settings.tsx, removed the same day). A COMPACT
// panel that grows out of the profile row at the bottom of the sidebar — the ChatGPT/Perplexity
// account-menu concept in Ezhalah's own green identity. Everything the old modal hosted lives here:
//
//   root       المظهر · اللغة · المساعدة · إدارة الحساب · تسجيل الخروج  (+ profile header)
//   appearance النظام / فاتح / داكن — applied immediately via ThemeProvider, persisted
//   language   العربية (active). English listed but disabled — the product is Arabic-only
//              (i18n setLocale guards `l !== 'ar'`); the row still calls setLocale so the day
//              that guard lifts, this menu works unchanged.
//   account    display-name inline edit · phone change (WhatsApp OTP) / locked Google-Apple row ·
//              logged-in device · delete account (destructive, kept at the bottom of the account
//              area — never visually dominant at the menu root)
//   signout /  in-panel confirmations with the same loading beats and the same store calls the
//   delete     old modal used (signOut(), deleteAccount() — server-first, PR #725).
//
// Interaction contract (owner revision 2026-08-28, same day): the QUICK views — root, Appearance,
// Language — open anchored above the profile row (never centered); outside-click and Escape close
// them. The HEAVY experiences — إدارة الحساب, its delete flow, and the تسجيل الخروج confirmation —
// are NOT confined to the sidebar: they open as full centered popups over the whole app, on a
// dimmed+blurred backdrop, via a real RN <Modal>. EVERY surface here pins `direction: 'rtl'`
// explicitly (owner 2026-08-29: one coherent right-first Arabic hierarchy — title, labels, values,
// actions all start from the right; only latin values like emails/phone digits keep internal LTR),
// so neither the sidebar's LTR structural pin nor the document's state can half-flip it. The sidebar is only the
// LAUNCHER for them. ONE state machine drives both containers — the view value alone decides which
// container renders, so no logic is duplicated. Sub-views slide in the drill direction, reduced
// motion collapses every move to a fade. Unmount hand-offs are TIMER-driven, never animation
// callbacks (repo rule — rAF freezes in hidden tabs; see src/lib/afterAnimation.ts).

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const ENTER_MS = 190;
const EXIT_MS = 140;
const VIEW_MS = 170;

type MenuView = 'root' | 'appearance' | 'language' | 'account' | 'signout' | 'delete';

export default function AccountMenu({
  visible,
  onClose,
  onHelp,
}: {
  visible: boolean;
  onClose: () => void;
  /** Opens the existing Support popup (the sidebar owns the drawer-close choreography). */
  onHelp: () => void;
}) {
  const router = useRouter();
  const { height: winH } = useWindowDimensions();
  const { t, locale } = useI18n();
  const { user, updateUser, signOut, deleteAccount } = useApp();
  const { mode, setMode, resolved, colors: C } = useTheme();
  const reduced = useReducedMotion();
  const s = useMemo(() => makeStyles(C, resolved === 'dark'), [C, resolved]);

  // Mount while visible; on close, play the exit and unmount on a TIMER (the animation is
  // decoration — the unmount must happen even with rAF frozen).
  const [shown, setShown] = useState(visible);
  const [view, setView] = useState<MenuView>('root');
  const enter = useSharedValue(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (visible) {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setShown(true);
      setView('root');
      enter.value = reduced ? 1 : 0;
      enter.value = withTiming(1, { duration: reduced ? 0 : ENTER_MS, easing: EASE_OUT });
      return;
    }
    enter.value = withTiming(0, { duration: reduced ? 0 : EXIT_MS, easing: Easing.in(Easing.cubic) });
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setShown(false); }, reduced ? 0 : EXIT_MS + 20);
    return () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduced]);

  // The panel grows out of the profile row beneath it: fade + a small rise + a scale from ~0.97,
  // which reads as "unfolding from the trigger" (spatial anchoring), not a centered popup.
  const panelAnim = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * 10 },
      { scale: 0.97 + enter.value * 0.03 },
    ],
  }));

  // Escape — capture phase, registered only while open. Anchored views close the menu; the
  // centered popups CANCEL their own step instead (the safest action, owner rule): the delete
  // confirmation steps back to the account popup rather than vanishing the whole surface, and the
  // logout confirmation / account popup simply close. Never deletes, never signs out.
  const viewRef = useRef<MenuView>('root');
  viewRef.current = view;
  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (viewRef.current === 'delete') { go('account', -1); return; }
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, onClose]);

  // Sub-view slide: push enters from the trailing side, pop from the leading side.
  const dirRef = useRef<1 | -1>(1);
  const viewEnter = useSharedValue(1);
  const go = (v: MenuView, dir: 1 | -1) => {
    dirRef.current = dir;
    setView(v);
    viewEnter.value = reduced ? 1 : 0;
    viewEnter.value = withTiming(1, { duration: reduced ? 0 : VIEW_MS, easing: EASE_OUT });
  };
  const viewAnim = useAnimatedStyle(() => ({
    opacity: viewEnter.value,
    transform: [{ translateX: (1 - viewEnter.value) * 12 * dirRef.current }],
  }));

  // ── Account state (moved from settings.tsx — same semantics) ───────────────────────────────────
  const m = user?.method ?? 'phone';
  const shownName = pickName(user, locale);
  const [name, setName] = useState(shownName);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [phOpen, setPhOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    // Refresh-proof (owner 2026-08-29): the store patch above is in-memory only — the auth
    // backend's user_metadata is what mapSupabaseUser rebuilds from on the next load.
    persistDisplayName(v);
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
  // Closing the menu with an edit still open must not lose the change (same flush the old
  // Settings page had on unmount).
  const nameRef = useRef(name); nameRef.current = name;
  const shownRef = useRef(shownName); shownRef.current = shownName;
  useEffect(() => () => {
    const v = nameRef.current.trim();
    if (v && v !== shownRef.current) persistName(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sign out with the same short, intentional loading beat the old modal had, then land on the
  // logged-out home. Guarded against double taps.
  const onLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setTimeout(() => { signOut(); router.replace('/'); }, 1200);
  };

  // SERVER-FIRST deletion (PR #725): nothing is destroyed unless the server confirms, and a failure
  // is said plainly — never a navigation that pretends success. (owner report 2026-08-17.)
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
    // Deletion lands in the canonical logged-out state — LIGHT with the stored appearance keys
    // cleared. That reset lives in the store's deleteAccount() itself (after the
    // server-confirmed guard; owner 2026-08-28/29) — ONE mechanism, shared with sign-out, so
    // this handler no longer re-stamps 'light' into storage after the store just cleared it.
    router.replace('/');
  };

  if (!shown || !user) return null;

  const loginDevice = m === 'google' ? t('Android / Chrome') : t('iPhone');
  const modeLabel = mode === 'system' ? t('System') : mode === 'light' ? t('Light') : t('Dark');
  const maxH = Math.max(260, Math.min(winH - 120, 520));

  const Row = ({
    icon, label, value, chevron, danger, onPress, testID, selected,
  }: {
    icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; chevron?: boolean;
    danger?: boolean; onPress: () => void; testID?: string; selected?: boolean;
  }) => (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="menuitem"
      style={({ hovered, pressed }: any) => [s.row, (hovered || pressed) && s.rowHover]}
    >
      <Ionicons name={icon} size={17} color={danger ? '#d05b4c' : C.ink} />
      <Text style={[s.rowLabel, danger && s.rowLabelDanger]} numberOfLines={1}>{label}</Text>
      {value ? <Text style={s.rowValue} numberOfLines={1}>{value}</Text> : null}
      {selected ? <Ionicons name="checkmark" size={16} color={C.primary} /> : null}
      {chevron ? <Ionicons name="chevron-back" size={14} color={C.muted} /> : null}
    </Pressable>
  );

  const SubHeader = ({ title }: { title: string }) => (
    <Pressable testID="account-menu-back" onPress={() => go('root', -1)} style={({ hovered }: any) => [s.subHead, hovered && s.rowHover]}>
      <Ionicons name="chevron-forward" size={16} color={C.muted} />
      <Text style={s.subHeadText}>{title}</Text>
    </Pressable>
  );

  const centered = view === 'account' || view === 'signout' || view === 'delete';

  return (
    <>
      {!centered && (
        <>
      {/* Invisible click-catcher over the WHOLE viewport (web: position fixed) — clicking anywhere
          outside the panel closes the menu, exactly like the row ⋯ menu's scrim. */}
      <Pressable testID="account-menu-scrim" style={s.scrim} onPress={onClose} />
      <Animated.View testID="account-menu" style={[s.panel, { maxHeight: maxH }, panelAnim]}>
        <Animated.View style={viewAnim}>
          {view === 'root' && (
            <View>
              {/* Profile header — clean and compact (owner 2026-08-29: no banner/hero image here):
                  avatar · name · email, nothing else. Tapping it opens إدارة الحساب with the
                  display-name editor already active — the profile IS the edit affordance. */}
              <Pressable
                testID="account-menu-profile"
                onPress={() => { setEditing(true); go('account', 1); }}
                style={({ hovered, pressed }: any) => [s.profile, (hovered || pressed) && s.rowHover]}
              >
                <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(pickName(user, locale))}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.profileName} numberOfLines={1}>{pickName(user, locale)}</Text>
                  {!!user.sub && <Text style={s.profileSub} numberOfLines={1}>{user.sub}</Text>}
                </View>
                <Ionicons name="create-outline" size={15} color={C.muted} />
              </Pressable>
              <View style={s.hairline} />
              <Row icon="contrast-outline" label={t('Appearance')} value={modeLabel} chevron onPress={() => go('appearance', 1)} testID="account-menu-appearance" />
              <Row icon="globe-outline" label={t('Language')} value="العربية" chevron onPress={() => go('language', 1)} testID="account-menu-language" />
              <Row icon="help-circle-outline" label={t('Help')} onPress={() => { onClose(); onHelp(); }} testID="account-menu-help" />
              <Row icon="person-outline" label={t('Manage account')} chevron onPress={() => { setEditing(false); go('account', 1); }} testID="account-menu-account" />
              <View style={s.hairline} />
              <Row icon="log-out-outline" label={t('Log out')} onPress={() => go('signout', 1)} testID="account-menu-signout" />
            </View>
          )}

          {view === 'appearance' && (
            <View>
              <SubHeader title={t('Appearance')} />
              <View style={s.hairline} />
              {(['system', 'light', 'dark'] as ThemeMode[]).map((mm) => (
                <Row
                  key={mm}
                  icon={mm === 'system' ? 'contrast-outline' : mm === 'light' ? 'sunny-outline' : 'moon-outline'}
                  label={mm === 'system' ? t('System') : mm === 'light' ? t('Light') : t('Dark')}
                  selected={mode === mm}
                  onPress={() => setMode(mm)}
                  testID={`appearance-${mm}`}
                />
              ))}
            </View>
          )}

          {view === 'language' && (
            <View>
              <SubHeader title={t('Language')} />
              <View style={s.hairline} />
              <Row icon="checkmark-circle-outline" label="العربية" selected onPress={() => {}} testID="language-ar" />
              {/* Arabic-only product: English is visible but disabled. The press still routes
                  through setLocale — whose guard makes it a no-op — so behavior has ONE owner. */}
              <View style={s.langDisabled} testID="language-en">
                <Ionicons name="ellipse-outline" size={17} color={C.muted} />
                <Text style={[s.rowLabel, { color: C.muted }]}>English</Text>
                <Text style={s.rowValue}>{t('Not available yet')}</Text>
              </View>
            </View>
          )}

        </Animated.View>
      </Animated.View>
        </>
      )}

      {/* ── Centered full-app popups (owner 2026-08-28): the sidebar only LAUNCHES these ── */}
      {centered && (
        <Modal visible transparent animationType="fade"
          onRequestClose={() => { if (view === 'delete') go('account', -1); else onClose(); }}>
          <View style={s.centerRoot}>
            <Pressable
              testID="account-popup-backdrop"
              style={s.centerBack}
              onPress={() => { if (view === 'delete') go('account', -1); else onClose(); }}
            />
            <Animated.View
              testID={view === 'account' ? 'account-popup' : view === 'signout' ? 'logout-popup' : 'delete-popup'}
              style={[view === 'account' ? s.centerCardWide : s.centerCard, viewAnim]}
            >
              {view === 'account' && (
                <Pressable testID="account-popup-close" onPress={onClose} hitSlop={8} style={({ hovered }: any) => [s.centerClose, hovered && s.rowHover]}>
                  <Ionicons name="close" size={18} color={C.muted} />
                </Pressable>
              )}
          {view === 'account' && (
            <ScrollView style={{ maxHeight: winH * 0.72 }} showsVerticalScrollIndicator={false}>
              {/* Popup title — this is a centered dialog now, not a drill-in: no back chevron, the
                  × in the corner (and Escape / the backdrop) closes it. */}
              <Text style={s.centerTitle}>{t('Manage account')}</Text>
              <View style={s.hairline} />
              {/* Display name — tap to edit inline, explicit save (same contract as before). */}
              <Pressable
                testID="account-menu-name"
                onPress={() => { if (!editing) setEditing(true); }}
                disabled={editing}
                style={({ hovered }: any) => [s.field, !editing && hovered && s.rowHover]}
              >
                <View style={s.fieldHead}>
                  <Text style={s.fieldLabel}>{t('Display Name')}</Text>
                  {justSaved && (
                    <View style={s.savedTag}>
                      <Ionicons name="checkmark-circle" size={12} color={C.primary} />
                      <Text style={s.savedText}>{t('Name saved')}</Text>
                    </View>
                  )}
                </View>
                {editing ? (
                  <>
                    <TextInput
                      testID="account-menu-name-input"
                      style={s.input}
                      value={name}
                      autoFocus
                      placeholder={t('Display Name')}
                      placeholderTextColor={C.muted}
                      onChangeText={setName}
                      onSubmitEditing={saveName}
                      returnKeyType="done"
                    />
                    {nameChanged && (
                      <Pressable testID="account-menu-name-save" style={s.saveBtn} onPress={saveName} hitSlop={6}>
                        <Ionicons name="checkmark" size={14} color="#fff" />
                        <Text style={s.saveBtnText}>{t('Save')}</Text>
                      </Pressable>
                    )}
                  </>
                ) : (
                  <Text style={s.fieldValue} numberOfLines={1}>{name || shownName}</Text>
                )}
              </Pressable>

              {m === 'phone' ? (
                <View style={s.field}>
                  <View style={s.fieldHead}>
                    <Text style={s.fieldLabel}>{t('Phone Number')}</Text>
                    <Pressable testID="account-menu-phone-change" onPress={() => setPhOpen(true)} hitSlop={6}>
                      <Text style={s.actText}>{t('Change')}</Text>
                    </Pressable>
                  </View>
                  <Text style={s.fieldValue}>{user.sub || '+966 5XX XXX XXX'}</Text>
                </View>
              ) : (
                <View style={s.field}>
                  <View style={s.fieldHead}>
                    <Text style={s.fieldLabel}>{m === 'apple' ? t('Apple Account') : t('Google Account')}</Text>
                    <Text style={s.lockedText}>{t("Can't be changed")}</Text>
                  </View>
                  <Text style={s.fieldValue} numberOfLines={1}>{user.sub}</Text>
                  <Text style={s.fieldNote}>{t("To change it, you'll have to delete this account and make a new one.")}</Text>
                </View>
              )}

              <View style={s.field}>
                <View style={s.fieldHead}>
                  <Text style={s.fieldLabel}>{t('Logged in device')}</Text>
                  <Text style={s.deviceCurrent}>{t('This device')}</Text>
                </View>
                <Text style={s.fieldValue}>{loginDevice}</Text>
              </View>

              <View style={s.hairline} />
              {/* Destructive action lives HERE — inside the account area, quiet, at the end. */}
              <Row icon="trash-outline" label={t('Delete my account')} danger onPress={() => { setDeleteError(null); go('delete', 1); }} testID="account-menu-delete" />
            </ScrollView>
          )}

          {view === 'signout' && (
            <View style={s.confirm}>
              <View style={s.confirmIcon}><Ionicons name="log-out-outline" size={20} color={C.primary} /></View>
              <Text style={s.confirmTitle}>{t('Log out?')}</Text>
              <Text style={s.confirmSub}>{t('Are you sure you want to log out?')}</Text>
              <Pressable
                testID="account-menu-signout-confirm"
                style={[s.confirmBtn, { backgroundColor: C.primary }, loggingOut && { opacity: 0.9 }]}
                onPress={onLogout}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <View style={s.busyRow}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={s.confirmBtnText}>{t('Signing out…')}</Text>
                  </View>
                ) : (
                  <Text style={s.confirmBtnText}>{t('Log out')}</Text>
                )}
              </Pressable>
              <Pressable testID="logout-popup-cancel" style={s.cancelBtn} onPress={onClose} disabled={loggingOut}>
                <Text style={s.cancelText}>{t('Cancel')}</Text>
              </Pressable>
            </View>
          )}

          {view === 'delete' && (
            <View style={s.confirm}>
              <View style={[s.confirmIcon, s.confirmIconDanger]}><Ionicons name="trash-outline" size={20} color="#d05b4c" /></View>
              <Text style={s.confirmTitle}>{t('Delete your account?')}</Text>
              <Text style={s.confirmSub}>{t("This permanently removes your account, saved searches, and chat history. This can't be undone.")}</Text>
              {(m === 'google' || m === 'apple') && (
                <Text style={s.confirmNote}>
                  {t("Note: to change your {provider} account, you'll need to delete this account and sign up again with the new one.", { provider: m === 'google' ? 'Google' : 'Apple' })}
                </Text>
              )}
              <Pressable
                testID="account-menu-delete-confirm"
                style={[s.confirmBtn, { backgroundColor: '#c0392b' }, deleting && { opacity: 0.9 }]}
                onPress={onDeleteAccount}
                disabled={deleting}
              >
                {deleting ? (
                  <View style={s.busyRow}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={s.confirmBtnText}>{t('Deleting account…')}</Text>
                  </View>
                ) : (
                  <Text style={s.confirmBtnText}>{t('Delete my account')}</Text>
                )}
              </Pressable>
              {deleteError ? <Text style={s.deleteError}>{deleteError}</Text> : null}
              <Pressable style={s.cancelBtn} onPress={() => go('account', -1)} disabled={deleting}>
                <Text style={s.cancelText}>{t('Cancel')}</Text>
              </Pressable>
            </View>
          )}
            </Animated.View>
          </View>
        </Modal>
      )}

      {phOpen && (
        <ChangePhone
          onDone={(newSub) => { updateUser({ sub: newSub }); setPhOpen(false); }}
          onClose={() => setPhOpen(false)}
          s={s}
          C={C}
        />
      )}
    </>
  );
}

// ── Change phone number (enter → WhatsApp OTP) — moved unchanged from settings.tsx ───────────────
function ChangePhone({
  onDone,
  onClose,
  s,
  C,
}: {
  onDone: (sub: string) => void;
  onClose: () => void;
  s: ReturnType<typeof makeStyles>;
  C: Record<string, string>;
}) {
  const { t, isRTL } = useI18n();
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
      <View style={s.phRoot}>
        <Pressable style={s.phBack} onPress={onClose} />
        <View style={s.phCard}>
          {step === 'enter' ? (
            <>
              <Text style={s.confirmTitle}>{t('Change phone number')}</Text>
              <Text style={s.confirmSub}>{t("Enter your new number, we'll send a verification code on WhatsApp.")}</Text>
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
                  placeholderTextColor={C.muted}
                  value={phone}
                  maxLength={cc.len}
                  onChangeText={(v) => setPhone((v.match(/\d/g) ?? []).join('').slice(0, cc.len))}
                />
              </View>
              {!!(liveErr || err) && <Text style={s.phErr}>{liveErr || err}</Text>}
              <Pressable style={[s.confirmBtn, { backgroundColor: lightColors.dark }, (!valid || busy) && { opacity: 0.4 }]} disabled={!valid || busy} onPress={sendCode}>
                <Text style={s.confirmBtnText}>{t('Send code')}</Text>
              </Pressable>
              <Pressable style={s.cancelBtn} onPress={onClose}>
                <Text style={s.cancelText}>{t('Cancel')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.waIcon}><Ionicons name="logo-whatsapp" size={24} color="#fff" /></View>
              <Text style={s.confirmTitle}>{t('Enter the code')}</Text>
              <Text style={s.confirmSub}>
                {t('We sent a 6-digit code on WhatsApp to')}{'\n'}
                <Text style={{ fontWeight: '700', color: C.ink }}>{cc.code} {phone}</Text>
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
              <Pressable style={s.cancelBtn} onPress={() => { setStep('enter'); setOtp(''); setErr(''); }}>
                <Text style={s.cancelText}>{t('Back')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Theme-aware styles: rebuilt only when the resolved theme flips (useMemo above).
function makeStyles(C: Record<string, string>, dark: boolean) {
  return StyleSheet.create({
    // Full-viewport click-catcher (web position:fixed; native falls back to filling the sidebar).
    scrim: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60,
      backgroundColor: 'transparent',
      ...(Platform.OS === 'web' ? ({ position: 'fixed' } as any) : null),
    },
    // Anchored ABOVE the profile row (bottom of the sidebar), matching the sidebar's inner padding.
    // Grows upward from its trigger — never centered on the screen.
    panel: {
      position: 'absolute', left: 10, right: 10, bottom: 64, zIndex: 61,
      direction: 'rtl' as any,
      backgroundColor: C.surface, borderRadius: radius.card, borderWidth: 1, borderColor: C.fieldLine,
      paddingVertical: 6, paddingHorizontal: 6, overflow: 'hidden',
      shadowColor: '#0b140f', shadowOpacity: dark ? 0.55 : 0.22, shadowRadius: 24,
      shadowOffset: { width: 0, height: 14 }, elevation: 18,
    },

    profile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
    avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    profileName: { fontSize: 13.5, fontWeight: '700', color: C.ink, textAlign: 'right', writingDirection: 'auto' as any },
    profileSub: { fontSize: 11, color: C.muted, marginTop: 1, textAlign: 'right', writingDirection: 'auto' as any },

    hairline: { height: 1, backgroundColor: C.line, marginVertical: 5, marginHorizontal: 4 },

    // ── Centered full-app popups (owner 2026-08-28) ─────────────────────────────────────────────
    // The dialog composes over the WHOLE app: fixed viewport root, a dim scrim with a soft blur
    // (web), and a centered card. Widths: the account manager breathes at 560; confirmations stay
    // an intimate 360. Both inherit the theme surface so dark mode is the card, not just the menu.
    centerRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, ...(Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any) : null) },
    centerBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: dark ? 'rgba(4,8,6,0.62)' : 'rgba(8,18,12,0.5)', ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as any) : null) },
    centerCard: { direction: 'rtl' as any, width: '100%', maxWidth: 360, backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.fieldLine, padding: 22, shadowColor: '#000', shadowOpacity: dark ? 0.6 : 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 14 },
    centerCardWide: { direction: 'rtl' as any, width: '100%', maxWidth: 560, backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.fieldLine, paddingVertical: 18, paddingHorizontal: 20, shadowColor: '#000', shadowOpacity: dark ? 0.6 : 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 14 },
    centerClose: { position: 'absolute', top: 12, left: 12, zIndex: 2, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    centerTitle: { fontSize: 16.5, fontWeight: '700', color: C.ink, textAlign: 'right', writingDirection: 'auto' as any, paddingVertical: 6, paddingHorizontal: 8 },

    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
    rowHover: { backgroundColor: dark ? '#1d2a22' : '#f2f5f2' },
    rowLabel: { flex: 1, fontSize: 13.5, fontWeight: '600', color: C.ink, textAlign: 'right', writingDirection: 'auto' as any },
    rowLabelDanger: { color: '#d05b4c' },
    rowValue: { fontSize: 12, color: C.muted, fontWeight: '500' },
    langDisabled: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, opacity: 0.55 },

    subHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
    subHeadText: { fontSize: 13.5, fontWeight: '700', color: C.ink },

    field: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10 },
    fieldHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fieldLabel: { flex: 1, fontSize: 11.5, color: C.muted, textAlign: 'right' },
    fieldValue: { fontSize: 13.5, fontWeight: '600', color: C.ink, marginTop: 3, textAlign: 'right', writingDirection: 'auto' as any },
    fieldNote: { fontSize: 11.5, color: C.muted, lineHeight: 16, marginTop: 6, textAlign: 'right' },
    savedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    savedText: { fontSize: 11, fontWeight: '600', color: C.primary },
    // >= 16 on web or mobile Safari zooms on focus and never restores (verify-input-font-no-ios-zoom).
    input: {
      fontSize: Platform.OS === 'web' ? 16 : 15, fontWeight: '600', color: C.ink, marginTop: 3,
      textAlign: 'right' as const, writingDirection: 'auto' as any,
      borderBottomWidth: 1, borderBottomColor: C.primary, paddingVertical: 2,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
    },
    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 9,
      paddingVertical: 7, paddingHorizontal: 14, marginTop: 10,
      ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
    },
    saveBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
    actText: { fontSize: 12.5, fontWeight: '600', color: C.primary },
    lockedText: { fontSize: 11, color: C.muted, fontWeight: '500' },
    deviceCurrent: { fontSize: 11, fontWeight: '600', color: C.primary },

    confirm: { alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12 },
    confirmIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
    confirmIconDanger: { backgroundColor: dark ? '#33201c' : '#fbeaea' },
    confirmTitle: { fontSize: 15.5, fontWeight: '700', color: C.ink, textAlign: 'center' },
    confirmSub: { fontSize: 12.5, color: C.muted, textAlign: 'center', marginTop: 6, lineHeight: 18 },
    confirmNote: { fontSize: 11.5, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 16, backgroundColor: C.tint, borderRadius: 9, padding: 8 },
    confirmBtn: { width: '100%', borderRadius: 11, paddingVertical: 11, alignItems: 'center', marginTop: 14 },
    confirmBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '600' },
    cancelBtn: { width: '100%', paddingVertical: 10, alignItems: 'center', marginTop: 2 },
    cancelText: { fontSize: 12.5, fontWeight: '500', color: C.muted },
    deleteError: { fontSize: 12, color: '#d05b4c', textAlign: 'center', marginTop: 8, lineHeight: 17 },
    busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    // Change-phone dialog (small focused OTP dialog — not the retired Settings modal).
    phRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, ...(Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any) : null) },
    phBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.5)' },
    phCard: { direction: 'rtl' as any, width: '100%', maxWidth: 320, backgroundColor: C.surface, borderRadius: 20, padding: 22, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 12 },
    phField: { flexDirection: 'row', gap: 8, marginTop: 16, width: '100%' },
    phCc: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.pickLine, backgroundColor: C.surface },
    phCcText: { fontSize: 14, fontWeight: '600', color: C.ink },
    // Same iOS focus-zoom guard; fixed 48 height so the box does not reflow. minWidth: 0 pairs with
    // the 16px web bump — see the note on AuthModal.phoneInput.
    phInput: { flex: 1, minWidth: 0, height: 48, paddingHorizontal: 14, textAlign: 'left' as const, writingDirection: 'ltr' as any, borderRadius: 12, borderWidth: 1, borderColor: C.pickLine, fontSize: Platform.OS === 'web' ? 16 : 15, color: C.ink, backgroundColor: C.surface, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
    phErr: { fontSize: 11.5, color: '#d05b4c', marginTop: 8, alignSelf: 'flex-start' },
    waIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: lightColors.whatsApp, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    otpBoxes: { flexDirection: 'row', gap: 8, marginTop: 16 },
    otpBox: { width: 38, height: 48, borderRadius: 11, borderWidth: 1.5, borderColor: C.pickLine, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
    otpBoxActive: { borderColor: C.primary },
    otpDigit: { fontSize: 20, fontWeight: '700', color: C.ink },
    // autoFocus'd + invisible, but iOS zooms to the focused element's font-size all the same.
    otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1, fontSize: 16 },
  });
}
