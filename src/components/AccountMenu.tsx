import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, I18nManager, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hasLegalDocs } from '@/data/legal';
import { colors as lightColors, radius } from '@/theme/tokens';
import { useTheme, type ThemeMode } from '@/theme/theme';
import { useApp } from '@/store';

import { useI18n } from '@/i18n';
import { detectDevice, readDeviceEnv } from '@/lib/deviceInfo';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { pickName, buildSyncedName, scriptOf, initialsOf } from '@/lib/nameSync';
import { isBackendLive, persistDisplayName, signOutBackend } from '@/lib/auth';
import {
  currentSessionId, lastActiveLabel, listDeviceSessions, revokeDeviceSession,
  signOutOtherDevices, type DeviceSession,
} from '@/lib/devices';

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
//   account    display-name inline edit · locked Google/Apple row (phone sign-in removed, owner 2026-09-01) ·
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
  onLegal,
}: {
  visible: boolean;
  onClose: () => void;
  /** Opens the existing Support popup (the sidebar owns the drawer-close choreography). */
  onHelp: () => void;
  /** Opens the «الشروط والخصوصية» reader (same InfoModal host as Support / About). */
  onLegal: () => void;
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
      // Neutral on every open, exactly like the view. A destructive flow that ended — or that was
      // dismissed mid-flight — must never hand the next open a spinner and a permanently disabled
      // button (ops_incident hunt-2026-09-04:modal:04).
      setLoggingOut(false); setDeleting(false); setLogoutError(null); setDeleteError(null);
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
  const m = user?.method ?? 'google';
  const shownName = pickName(user, locale);
  const [name, setName] = useState(shownName);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
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

  // SERVER-FIRST sign-out, for the same reason deletion is server-first: the logged-out UI is never
  // shown while a valid session is still stored. supabase-js keeps the session in localStorage when
  // the logout request fails, so the old fire-and-forget version dropped to the guest home over a
  // live token and the next reload signed the user back in (ops_incident hunt-2026-09-04:auth:03).
  // The short, intentional loading beat the old modal had is kept — it now runs ALONGSIDE the real
  // call instead of standing in for it, so a fast network still gets the same deliberate pause.
  // Guarded against double taps.
  const onLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const [ok] = await Promise.all([signOutBackend(), new Promise((r) => setTimeout(r, 1200))]);
    if (!ok) {
      setLoggingOut(false);
      setLogoutError(t("Couldn't sign out this device. Try again."));
      return;
    }
    signOut();
    router.replace('/');
    // Land the menu in its neutral state. This component stays MOUNTED while it renders null
    // (`!user`), so a `loggingOut` left true survives into the next signed-in state as a stuck
    // confirmation with a dead button.
    setLoggingOut(false);
    onClose();
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
    // …and leave the menu neutral, for the same reason onLogout does: the component is still
    // mounted behind the null render.
    setDeleting(false);
    onClose();
  };

  // ── «الأجهزة المسجّل عليها الدخول» (owner Phase 2, 2026-08-29) ──────────────────────────────────
  // The REAL session registry via the `devices` edge function — no fake devices, no fingerprinting.
  // «هذا الجهاز» is matched by the session_id from this client's OWN JWT, never by list position.
  // The current device always renders from LOCAL detection (it self-corrects the iPad-as-Mac case
  // and needs no network), so a failed/empty fetch still shows the truth we already have.
  const [devSessions, setDevSessions] = useState<DeviceSession[] | null>(null);
  const [devLoading, setDevLoading] = useState(false);
  const [devError, setDevError] = useState(false);
  const [mySid, setMySid] = useState<string | null>(null);
  const [confirmSid, setConfirmSid] = useState<string | null>(null);
  const [revokingSid, setRevokingSid] = useState<string | null>(null);
  const [revokeErrSid, setRevokeErrSid] = useState<string | null>(null);
  const [othersBusy, setOthersBusy] = useState(false);
  const [othersErr, setOthersErr] = useState(false);
  const fetchSeq = useRef(0);

  const fetchDevices = async () => {
    if (!isBackendLive) { setDevSessions([]); setDevError(false); return; } // preview: local card only
    const seq = ++fetchSeq.current;
    setDevLoading(true);
    setDevError(false);
    const [sid, list] = await Promise.all([currentSessionId(), listDeviceSessions()]);
    if (seq !== fetchSeq.current) return; // a newer fetch owns the state
    setMySid(sid);
    setDevSessions(list); // null = load failure — the section falls back to the local current card
    setDevError(list === null);
    setDevLoading(false);
  };
  useEffect(() => {
    if (view === 'account') { setConfirmSid(null); setRevokeErrSid(null); setOthersErr(false); fetchDevices(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // GENUINE per-device sign-out: the card is removed ONLY after the backend confirms the
  // revocation (revoked:true — including the clean "already signed out" race). A failure keeps
  // the card and says so; nothing is ever optimistically removed.
  const onRevokeDevice = async (sid: string) => {
    if (revokingSid) return;
    setRevokingSid(sid);
    setRevokeErrSid(null);
    const res = await revokeDeviceSession(sid);
    if (!res.ok) {
      setRevokingSid(null);
      setRevokeErrSid(sid);
      return;
    }
    setDevSessions((list) => (list ? list.filter((s0) => s0.session_id !== sid) : list));
    setRevokingSid(null);
    setConfirmSid(null);
  };

  const onSignOutOthers = async () => {
    if (othersBusy) return;
    setOthersBusy(true);
    setOthersErr(false);
    const ok = await signOutOtherDevices();
    if (!ok) {
      setOthersBusy(false);
      setOthersErr(true);
      return;
    }
    await fetchDevices(); // the refetch is the confirmation — only the server's truth clears cards
    setOthersBusy(false);
  };

  if (!shown || !user) return null;

  // TRUTHFUL device row (owner 2026-08-29): detected from the actual browser environment — never
  // from the login provider (the old `m === 'google' ? Android : iPhone` fabrication), never an
  // exact model. Unknowns stay unknown: device falls back to «هذا الجهاز», browser line is omitted.
  const device = detectDevice(readDeviceEnv());
  // Identity, not position: only a session whose id differs from THIS client's JWT session_id is
  // an "other" device. The current session's server row is folded into the leading local card.
  const otherSessions = (devSessions ?? []).filter((s0) => s0.session_id !== mySid);
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
      {({ hovered, pressed }: any) => { const on = !!(hovered || pressed); return (<>
        <Ionicons name={icon} size={17} color={on ? C.onFill : danger ? '#d05b4c' : C.ink} />
        <Text style={[s.rowLabel, danger && s.rowLabelDanger, on && s.rowOn]} numberOfLines={1}>{label}</Text>
        {value ? <Text style={[s.rowValue, on && s.rowSubOn]} numberOfLines={1}>{value}</Text> : null}
        {selected ? <Ionicons name="checkmark" size={16} color={on ? C.onFill : C.primary} /> : null}
        {chevron ? <Ionicons name="chevron-back" size={14} color={on ? C.onFill : C.muted} /> : null}
      </>); }}
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
                {({ hovered, pressed }: any) => { const on = !!(hovered || pressed); return (<>
                  <View style={s.avatar}><Text style={s.avatarText}>{initialsOf(pickName(user, locale))}</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.profileName, on && s.rowOn]} numberOfLines={1}>{pickName(user, locale)}</Text>
                    {!!user.sub && <Text style={[s.profileSub, on && s.rowSubOn]} numberOfLines={1}>{user.sub}</Text>}
                  </View>
                  <Ionicons name="create-outline" size={15} color={on ? C.onFill : C.muted} />
                </>); }}
              </Pressable>
              <View style={s.hairline} />
              <Row icon="contrast-outline" label={t('Appearance')} value={modeLabel} chevron onPress={() => go('appearance', 1)} testID="account-menu-appearance" />
              <Row icon="globe-outline" label={t('Language')} value="العربية" chevron onPress={() => go('language', 1)} testID="account-menu-language" />
              <Row icon="help-circle-outline" label={t('Help')} onPress={() => { onClose(); onHelp(); }} testID="account-menu-help" />
              <Row icon="person-outline" label={t('Manage account')} chevron onPress={() => { setEditing(false); go('account', 1); }} testID="account-menu-account" />
              {/* «الشروط والخصوصية» (owner 2026-09-03, text drafted 2026-09-04) — directly above
                  «تسجيل الخروج». Still gated on hasLegalDocs(): a row that opens an empty reader
                  would be worse than no row, so the gate stays even now that text exists. */}
              {hasLegalDocs() && (
                <Row icon="document-text-outline" label={t('Terms & Privacy')} onPress={() => { onClose(); onLegal(); }} testID="account-menu-legal" />
              )}
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
              {/* EVERY centered popup carries the same physical top-right × (owner 2026-08-29:
                  «do not make the user hunt for how to close something»). Its meaning is always the
                  SAFE dismissal: close for account/logout, step-back-to-account for the delete
                  confirmation — identical to what Escape and the backdrop already do. */}
              <Pressable
                testID={view === 'account' ? 'account-popup-close' : view === 'signout' ? 'logout-popup-close' : 'delete-popup-close'}
                onPress={() => { if (view === 'delete') go('account', -1); else onClose(); }}
                hitSlop={8}
                style={({ hovered }: any) => [s.centerClose, hovered && s.quietHover]}
              >
                <Ionicons name="close" size={18} color={C.muted} />
              </Pressable>
          {view === 'account' && (
            <ScrollView style={{ maxHeight: winH * 0.72 }} showsVerticalScrollIndicator={false}>
              {/* Popup title — this is a centered dialog now, not a drill-in: no back chevron, the
                  × in the corner (and Escape / the backdrop) closes it. */}
              <Text style={s.centerTitle}>{t('Manage account')}</Text>
              {/* Identity fields as ONE inset group (2026-08-30 visual refresh — the iOS grouped-
                  list idiom): the group surface carries the boundary, so the fields inside stay
                  the exact same Pressable/edit structures they were — only the wrapper is new. */}
              <View style={s.fieldsGroup}>
              {/* Display name — tap to edit inline, explicit save (same contract as before). */}
              <Pressable
                testID="account-menu-name"
                onPress={() => { if (!editing) setEditing(true); }}
                disabled={editing}
                style={({ hovered }: any) => [s.field, !editing && hovered && s.quietHover]}
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

              <View style={s.groupDivider} />
                <View style={s.field}>
                  <View style={s.fieldHead}>
                    <Text style={s.fieldLabel}>{m === 'apple' ? t('Apple Account') : t('Google Account')}</Text>
                    <Text style={s.lockedText}>{t("Can't be changed")}</Text>
                  </View>
                  <Text style={s.fieldValue} numberOfLines={1}>{user.sub}</Text>
                  <Text style={s.fieldNote}>{t("To change it, you'll have to delete this account and make a new one.")}</Text>
                </View>
              </View>

              {/* «الأجهزة المسجّل عليها الدخول» — the real session registry, current device first.
                  Loading = two shimmer cards; a failed fetch still shows the local current card
                  (the section never shows less than the truth it already has). */}
              <View style={s.devicesWrap}>
                <Text style={s.fieldLabel}>{t('Devices signed in')}</Text>
                <View testID="devices-list" style={s.devicesList}>
                  {devLoading ? (
                    <>
                      <ShimmerDeviceCard s={s} reduced={reduced} />
                      <ShimmerDeviceCard s={s} reduced={reduced} />
                    </>
                  ) : (
                    <>
                      <View testID="device-card-current" style={[s.deviceCard, s.deviceCardCurrent]}>
                        <View style={[s.deviceGlyph, s.deviceGlyphCurrent]}>
                          <Ionicons name={glyphFor(device.deviceClass)} size={17} color={C.primary} />
                        </View>
                        <View style={s.deviceBody}>
                          <Text style={s.deviceTitle} numberOfLines={1}>
                            {device.deviceClass ? t(device.deviceClass) : t('This device')}
                          </Text>
                          {device.browser ? (
                            <Text style={s.deviceSub} numberOfLines={1}>{t(device.browser)}</Text>
                          ) : null}
                          <Text style={s.deviceActiveNow}>{t('Active now')}</Text>
                        </View>
                        <View style={s.deviceTrailing}>
                          <View style={s.devicePill}><Text style={s.devicePillText}>{t('This device')}</Text></View>
                          {/* Signing out the CURRENT device is just sign-out — the existing
                              confirmed flow (and its theme-reset lifecycle), never the edge DELETE. */}
                          <Pressable
                            testID="device-signout-current"
                            onPress={() => go('signout', 1)}
                            hitSlop={6}
                            style={({ hovered }: any) => [s.deviceOutBtn, hovered && s.quietHover]}
                          >
                            <Text style={s.deviceOutText}>{t('Log out')}</Text>
                          </Pressable>
                        </View>
                      </View>

                      {otherSessions.map((s0) => (
                        <View key={s0.session_id} testID="device-card" style={s.deviceCard}>
                          <View style={s.deviceGlyph}>
                            <Ionicons name={glyphFor(s0.device_class)} size={17} color={C.primary} />
                          </View>
                          <View style={s.deviceBody}>
                            <Text style={s.deviceTitle} numberOfLines={1}>
                              {s0.device_class ? t(s0.device_class) : t('Unknown device')}
                            </Text>
                            {s0.browser ? (
                              <Text style={s.deviceSub} numberOfLines={1}>{t(s0.browser)}</Text>
                            ) : null}
                            {confirmSid === s0.session_id ? (
                              <Text style={s.deviceNote}>{t('Signs out within an hour at most')}</Text>
                            ) : (
                              <Text style={s.deviceActive} numberOfLines={1}>
                                {lastActiveLabel(s0.refreshed_at, Date.now())}
                              </Text>
                            )}
                            {revokeErrSid === s0.session_id ? (
                              <Text style={s.deviceErr}>{t("Couldn't sign out this device. Try again.")}</Text>
                            ) : null}
                          </View>
                          {confirmSid === s0.session_id ? (
                            revokingSid === s0.session_id ? (
                              <ActivityIndicator size="small" color={C.primary} />
                            ) : (
                              <View style={s.deviceConfirmCol}>
                                <Pressable
                                  testID="device-signout-confirm"
                                  onPress={() => onRevokeDevice(s0.session_id)}
                                  hitSlop={4}
                                  style={s.deviceConfirmBtn}
                                >
                                  <Text style={s.deviceConfirmText}>{t('Confirm sign out')}</Text>
                                </Pressable>
                                <Pressable
                                  testID="device-signout-cancel"
                                  onPress={() => { setConfirmSid(null); setRevokeErrSid(null); }}
                                  hitSlop={6}
                                >
                                  <Text style={s.deviceCancelText}>{t('Cancel')}</Text>
                                </Pressable>
                              </View>
                            )
                          ) : (
                            <Pressable
                              testID="device-signout"
                              onPress={() => { setConfirmSid(s0.session_id); setRevokeErrSid(null); }}
                              hitSlop={6}
                              style={({ hovered }: any) => [s.deviceOutBtn, hovered && s.quietHover]}
                            >
                              <Text style={s.deviceOutText}>{t('Log out')}</Text>
                            </Pressable>
                          )}
                        </View>
                      ))}

                      {devError ? (
                        <Pressable testID="devices-retry" onPress={fetchDevices} style={s.devicesRetry} hitSlop={4}>
                          <Text style={s.devicesRetryText}>
                            {t("Couldn't load the other devices.")} <Text style={s.devicesRetryLink}>{t('Retry')}</Text>
                          </Text>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>

                {otherSessions.length > 0 ? (
                  <Pressable
                    testID="devices-signout-others"
                    onPress={onSignOutOthers}
                    disabled={othersBusy}
                    hitSlop={4}
                    style={({ hovered }: any) => [s.devicesOthers, hovered && s.quietHover]}
                  >
                    {othersBusy ? (
                      <ActivityIndicator size="small" color={C.primary} />
                    ) : (
                      <Text style={s.devicesOthersText}>{t('Log out from all other devices')}</Text>
                    )}
                  </Pressable>
                ) : null}
                {othersErr ? (
                  <Text style={s.deviceErr}>{t('Something went wrong. Please try again.')}</Text>
                ) : null}
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
              {logoutError ? <Text style={s.deleteError}>{logoutError}</Text> : null}
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

    </>
  );
}

// One outline glyph per truthful device class — never a model image, never a guess dressed as one.
function glyphFor(dc: DeviceSession['device_class']): keyof typeof Ionicons.glyphMap {
  if (dc === 'iPad') return 'tablet-portrait-outline';
  if (dc === 'Mac' || dc === 'Windows') return 'laptop-outline';
  if (dc === 'iPhone' || dc === 'Android') return 'phone-portrait-outline';
  return 'hardware-chip-outline';
}

// Loading = two of these, no spinner: the card silhouette breathing quietly (a slow opacity pulse;
// reduced motion holds it still at half strength).
function ShimmerDeviceCard({ s, reduced }: { s: ReturnType<typeof makeStyles>; reduced: boolean }) {
  const pulse = useSharedValue(reduced ? 0.55 : 0.35);
  useEffect(() => {
    if (reduced) { pulse.value = 0.55; return; }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.75, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.35, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  const a = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View testID="device-card-shimmer" style={[s.deviceCard, a]}>
      <View style={[s.deviceGlyph, s.shimmerBlock]} />
      <View style={s.deviceBody}>
        <View style={[s.shimmerLine, { width: '42%' }]} />
        <View style={[s.shimmerLine, { width: '26%', marginTop: 8 }]} />
      </View>
    </Animated.View>
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
    centerCardWide: { direction: 'rtl' as any, width: '100%', maxWidth: 560, backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.fieldLine, paddingVertical: 20, paddingHorizontal: 22, shadowColor: '#000', shadowOpacity: dark ? 0.6 : 0.3, shadowRadius: 34, shadowOffset: { width: 0, height: 22 }, elevation: 14 },
    // PHYSICAL top-right (owner: «X always at the visual TOP-RIGHT»). Arabic forces app-wide RTL
    // (i18n.tsx: documentElement.dir + I18nManager.forceRTL), which makes RN flip `right:` to the
    // physical LEFT — so under RTL the physical right is spelled `left:`. Direction-aware so a
    // future LTR locale keeps the × on the same physical corner.
    centerClose: { position: 'absolute', top: 12, ...(I18nManager.isRTL ? { left: 12 } : { right: 12 }), zIndex: 2, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    centerTitle: { fontSize: 19, lineHeight: 26, fontWeight: '800', color: C.ink, textAlign: 'right', writingDirection: 'auto' as any, paddingTop: 4, paddingBottom: 14, paddingHorizontal: 8 },
    // Identity fields live in ONE inset group (iOS grouped-list idiom, 2026-08-30 refresh): the
    // group surface owns the boundary, an inset hairline separates the rows, and the fields keep
    // their exact structures — the wrapper is the only new element.
    fieldsGroup: { backgroundColor: dark ? C.surface2 : C.tint, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 4 },
    groupDivider: { height: 1, backgroundColor: dark ? C.line : C.tintLine ?? C.line, marginHorizontal: 12 },

    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
    // Sidebar rows (this menu is anchored IN the sidebar): the same fill as every sidebar row.
    rowHover: { backgroundColor: C.hoverRow },
    rowOn: { color: C.onFill },
    rowSubOn: { color: 'rgba(255,255,255,0.78)' },
    // The centered account popup's controls keep a quiet neutral hover — they are not sidebar rows.
    quietHover: { backgroundColor: dark ? '#1d2a22' : '#f2f5f2' },
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

    // ── الأجهزة المسجّل عليها الدخول — stacked truthful session cards ───────────────────────────
    // The account popup's own language (13px card radius, 10px gaps), not the settings-table look.
    // The current card is the one loud thing here: 1.5px primary border over the faint green wash
    // (C.tint is that wash in BOTH palettes — deep green under the dark layer by construction).
    devicesWrap: { paddingTop: 16, paddingBottom: 9, paddingHorizontal: 10 },
    devicesList: { marginTop: 10, gap: 10 },
    deviceCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64,
      borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
      paddingVertical: 12, paddingHorizontal: 14,
    },
    deviceCardCurrent: { borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.tint },
    deviceGlyph: {
      width: 38, height: 38, borderRadius: 19, backgroundColor: C.tint,
      alignItems: 'center', justifyContent: 'center',
    },
    deviceGlyphCurrent: { backgroundColor: C.surface },
    deviceBody: { flex: 1, minWidth: 0 },
    deviceTitle: { fontSize: 13.5, fontWeight: '700', color: C.ink, textAlign: 'right', writingDirection: 'auto' as any },
    deviceSub: { fontSize: 11.5, color: C.muted, marginTop: 1, textAlign: 'right' },
    deviceActiveNow: { fontSize: 11, fontWeight: '600', color: C.primary, marginTop: 3, textAlign: 'right' },
    deviceActive: { fontSize: 11, color: C.muted, marginTop: 3, textAlign: 'right' },
    // The honest revocation note — the victim's issued token can outlive the row by up to an hour.
    deviceNote: { fontSize: 10.5, color: C.body, lineHeight: 14, marginTop: 3, textAlign: 'right' },
    deviceErr: { fontSize: 11, color: '#d05b4c', marginTop: 4, textAlign: 'right' },
    deviceTrailing: { alignItems: 'center', gap: 4 },
    devicePill: { backgroundColor: C.primary, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
    devicePillText: { color: C.onFill, fontSize: 10.5, fontWeight: '700' },
    deviceOutBtn: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
    deviceOutText: { fontSize: 11.5, fontWeight: '600', color: C.muted },
    deviceConfirmCol: { alignItems: 'center', gap: 4 },
    deviceConfirmBtn: {
      backgroundColor: C.dangerBg, borderWidth: 1, borderColor: C.dangerLine,
      borderRadius: 9, paddingVertical: 5, paddingHorizontal: 10,
    },
    deviceConfirmText: { fontSize: 11, fontWeight: '700', color: C.danger },
    deviceCancelText: { fontSize: 11, fontWeight: '500', color: C.muted },
    // A real (quiet) chip, not a bare text link — the affordance reads as tappable at a glance.
    devicesOthers: { marginTop: 12, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.tint, borderWidth: 1, borderColor: C.tintLine ?? C.line },
    devicesOthersText: { fontSize: 12.5, fontWeight: '700', color: C.primary },
    devicesRetry: { paddingVertical: 6 },
    devicesRetryText: { fontSize: 11.5, color: C.muted, textAlign: 'right' },
    devicesRetryLink: { color: C.primary, fontWeight: '600' },
    shimmerBlock: { backgroundColor: C.surface2 },
    shimmerLine: { height: 10, borderRadius: 5, backgroundColor: C.surface2 },

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
    // Same iOS focus-zoom guard; fixed 48 height so the box does not reflow. minWidth: 0 pairs with
    // the 16px web bump — see the note on AuthModal.phoneInput.
    // autoFocus'd + invisible, but iOS zooms to the focused element's font-size all the same.
  });
}
