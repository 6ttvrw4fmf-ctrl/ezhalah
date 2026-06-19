import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import HeroBackground from '@/components/HeroBackground';
import { useApp } from '@/store';
import { useI18n, t, translate } from '@/i18n';
import { COUNTRIES, type Country } from '@/data/countries';
import { sendPhoneOtp, verifyPhoneOtp } from '@/lib/auth';
import { pickName, buildSyncedName, scriptOf, initialsOf } from '@/lib/nameSync';

const MAX_W = 560;

// Account settings — a faithful port of the prototype's SettingsPage: editable display name, a
// method-specific account row (phone can change number via WhatsApp OTP; Google/Apple are locked),
// the logged-in device, and a danger zone to delete the account. Compliance copy lives in About.
export default function Settings() {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const { isRTL, locale } = useI18n();
  const { user, updateUser, signOut, deleteAccount } = useApp();
  // Centered popup (not a full-screen page): cap the card height so it scrolls inside the dialog.
  const maxH = Math.min(height - 32, 720);

  // Premium entrance (item 7): the card fades + gently scales up on open instead of snapping in.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [enter]);
  const cardAnim = { opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] };

  // If somehow opened while signed out, bounce to auth.
  const m = user?.method ?? 'phone';
  // The name shown/edited is the one for the CURRENT app language (Arabic UI → Arabic spelling).
  const shownName = pickName(user, locale);
  const [name, setName] = useState(shownName);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [phStep, setPhStep] = useState<null | 'enter' | 'otp'>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // True when the typed name differs from the stored one — drives the explicit green Save button.
  const nameChanged = name.trim().length > 0 && name.trim() !== shownName;

  // Keep the field in sync with the app language and stored spellings — e.g. switching the app to
  // Arabic flips the field to the Arabic name — but never clobber what the user is actively typing.
  useEffect(() => {
    if (!editing) setName(pickName(user, locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, user?.name, user?.nameEn, user?.nameAr]);

  // The ENTIRE Settings page follows the APP language: Arabic app → every label Arabic, only the
  // email/phone VALUE stays as-is. (user request: no mixed Arabic/English chrome on the page.) The
  // display name itself is shown bilingually via pickName(user, locale).
  const tp = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);

  // Device label follows the app language: "Android / Chrome" ↔ "أندرويد / كروم".
  const loginDevice = m === 'google' ? tp('Android / Chrome') : tp('iPhone');

  // Persist an edited name + generate its other-language spelling so both stay synced. We save the
  // typed value immediately (so the UI updates and the "Saved" toast feels instant), then fill the
  // opposite script in the background once the transliteration returns.
  const persistName = (v: string) => {
    const sc = scriptOf(v);
    const immediate = sc === 'ar' ? { name: v, nameAr: v } : { name: v, nameEn: v };
    updateUser({ ...immediate, initials: initialsOf(v) });
    buildSyncedName(v).then((synced) => updateUser({ ...synced, initials: initialsOf(v) }));
  };

  // Notion/Linear-style inline editing: click the name → type → click away → auto-saves. No Edit/
  // Save/Cancel buttons. We commit on blur, and also on unmount (closing Settings / navigating away).
  const commitName = () => {
    const v = name.trim();
    if (v && v !== shownName) {
      persistName(v);
      // Brief "تم حفظ الاسم / Name saved" confirmation, then fade it out.
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
    } else if (!v) setName(shownName);
  };
  // Explicit Save (button / Enter): commit and exit edit mode. (user request: a clear Save button,
  // no silent blur-save.)
  const saveName = () => { commitName(); setEditing(false); };
  const nameRef = useRef(name);
  nameRef.current = name;
  const shownRef = useRef(shownName);
  shownRef.current = shownName;
  useEffect(() => () => {
    // On unmount, flush a still-open edit so closing Settings never loses the change.
    const v = nameRef.current.trim();
    if (v && v !== shownRef.current) persistName(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log out with a short, intentional loading beat (spinner + localized message) so the user clearly
  // sees the sign-out happen, then land on the logged-out home. Guard against double taps. (user req.)
  const onLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setTimeout(() => { signOut(); router.replace('/'); }, 1200);
  };

  // Deleting wipes saved searches + chat history, signs out, and drops the user on the home Filter
  // screen. Show a progress beat first, and block repeat clicks while it runs. (user request.)
  const onDeleteAccount = () => {
    if (deleting) return;
    setDeleting(true);
    setTimeout(() => { deleteAccount(); router.replace('/'); }, 1200);
  };

  if (!user) {
    return (
      <View style={s.overlay}>
        <HeroBackground imageOpacity={0.5} fadeStart={0.85} fadeEnd={1} />
        <Pressable style={s.backdrop} onPress={() => router.back()} />
        <View style={[s.popup, { maxHeight: maxH }]}>
          <View style={s.topBar}>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => router.back()} style={s.xBtn} hitSlop={8}>
              <Ionicons name="close" size={20} color="#56635c" />
            </Pressable>
          </View>
          <View style={s.signedOut}>
            <Text style={s.signedOutText}>{t('Sign in')}</Text>
            <Pressable style={s.primaryBtn} onPress={() => router.replace('/auth')}>
              <Text style={s.primaryBtnText}>{t('Sign up / Log in')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.overlay}>
      {/* The route unmounts the page behind on web, which left a flat grey void; render the app's
          branded sketch background so Settings floats over the same scenery as every other screen,
          dimmed by the backdrop. Tapping the backdrop closes. */}
      <HeroBackground imageOpacity={0.5} fadeStart={0.85} fadeEnd={1} />
      <Pressable style={[s.backdrop, Platform.OS === 'web' ? ({ backdropFilter: 'blur(6px)' } as any) : null]} onPress={() => router.back()} />
      <Animated.View style={[s.popup, { maxHeight: maxH }, cardAnim]}>
      <View style={s.topBar}>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.back()} style={s.xBtn} hitSlop={8}>
          <Ionicons name="close" size={20} color="#56635c" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: 24 }]}>
        <View style={s.col}>
          <Text style={s.h}>{tp('Settings')}</Text>

          {/* Account */}
          <Text style={s.sec}>{tp('Account')}</Text>
          <View style={s.card}>
            {/* The WHOLE Display Name row is the edit target — clicking anywhere inside it enters edit
                mode and the input auto-focuses (cursor placed automatically). No Edit/Save buttons;
                it auto-saves on blur. (user request.) */}
            <Pressable
              onPress={() => { if (!editing) setEditing(true); }}
              disabled={editing}
              style={({ hovered }: any) => [s.row, !editing && Platform.OS === 'web' ? ({ cursor: 'text', transitionProperty: 'background-color', transitionDuration: '150ms' } as any) : null, !editing && hovered && s.nameRowHover]}
            >
              <View style={{ flex: 1 }}>
                <View style={s.kRow}>
                  <Text style={s.k}>{tp('Display Name')}</Text>
                  {justSaved && (
                    <View style={s.savedTag}>
                      <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
                      <Text style={s.savedTx}>{tp('Name saved')}</Text>
                    </View>
                  )}
                </View>
                {editing ? (
                  // Inline field + an explicit green Save button that only appears once the name has
                  // actually changed. Enter also saves. No silent blur-save — the user commits. (user req.)
                  <>
                    <TextInput
                      style={[s.input, Platform.OS === 'web' ? ({ transitionProperty: 'opacity', transitionDuration: '160ms' } as any) : null]}
                      value={name}
                      autoFocus
                      placeholder={tp('Display Name')}
                      placeholderTextColor={colors.muted}
                      onChangeText={setName}
                      onSubmitEditing={saveName}
                      returnKeyType="done"
                    />
                    {nameChanged && (
                      <Pressable style={s.saveBtn} onPress={saveName} hitSlop={6}>
                        <Ionicons name="checkmark" size={15} color="#fff" />
                        <Text style={s.saveBtnText}>{tp('Save')}</Text>
                      </Pressable>
                    )}
                  </>
                ) : (
                  <Text style={[s.v, { marginTop: 3 }]}>{name || shownName}</Text>
                )}
              </View>
            </Pressable>

            {m === 'phone' && (
              <View style={[s.row, s.rowTop]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.k}>{tp('Phone Number')}</Text>
                  <Text style={s.v}>{user.sub || '+966 5XX XXX XXX'}</Text>
                </View>
                <Pressable style={s.act} onPress={() => setPhStep('enter')} hitSlop={6}>
                  <Text style={s.actText}>{tp('Change')}</Text>
                </Pressable>
              </View>
            )}
            {(m === 'apple' || m === 'google') && (
              <View style={[s.rowCol, s.rowTop]}>
                <View style={s.rowColTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.k}>{m === 'apple' ? tp('Apple Account') : tp('Google Account')}</Text>
                    <Text style={s.v}>{user.sub}</Text>
                  </View>
                  <Text style={s.locked}>{tp("Can't be changed")}</Text>
                </View>
                <Text style={s.accNote}>{tp("To change it, you'll have to delete this account and make a new one.")}</Text>
              </View>
            )}
          </View>

          {/* Logged in device */}
          <Text style={s.sec}>{tp('Logged in device')}</Text>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.dev}>{loginDevice}</Text>
              <Text style={s.cur}>{tp('This device')}</Text>
            </View>
          </View>

          {/* Note #10 — full-width Log out (green tint) + Delete my account (red tint) buttons, each
              with its own icon and stacked. Tint style matches the user's screenshot. (user request.) */}
          {/* Log out no longer signs out on the first tap — it opens a confirmation popup (like Delete
              account). The actual sign-out + loading beat runs only after the user confirms. (user req.) */}
          <Pressable style={s.logoutPrimary} onPress={() => setConfirmLogout(true)}>
            <View style={s.btnRow}>
              <Ionicons name="log-out-outline" size={20} color={colors.primary} />
              <Text style={s.logoutPrimaryText}>{tp('Log out')}</Text>
            </View>
          </Pressable>

          <Pressable style={s.deleteDanger} onPress={() => setConfirmDelete(true)}>
            <View style={s.btnRow}>
              <Ionicons name="trash-outline" size={20} color="#c0392b" />
              <Text style={s.deleteDangerText}>{tp('Delete my account')}</Text>
            </View>
          </Pressable>
        </View>
      </ScrollView>
      </Animated.View>

      {/* Change-phone modal */}
      {phStep && (
        <ChangePhone
          current={user.sub}
          isRTL={isRTL}
          onDone={(newSub) => { updateUser({ sub: newSub }); setPhStep(null); }}
          onClose={() => setPhStep(null)}
        />
      )}

      {/* Log out confirm — same pattern as Delete account, but green/neutral (not destructive). */}
      <Modal visible={confirmLogout} transparent animationType="fade" onRequestClose={() => { if (!loggingOut) setConfirmLogout(false); }}>
        <View style={s.modalRoot}>
          <Pressable style={s.modalBack} onPress={() => { if (!loggingOut) setConfirmLogout(false); }} />
          <View style={s.modalCard}>
            <View style={s.logoutIc}><Ionicons name="log-out-outline" size={22} color={colors.primary} /></View>
            <Text style={s.delT}>{tp('Log out?')}</Text>
            <Text style={s.delS}>{tp('Are you sure you want to log out?')}</Text>
            <Pressable style={[s.logoutConfirm, loggingOut && { opacity: 0.9 }]} onPress={onLogout} disabled={loggingOut}>
              {loggingOut ? (
                <View style={s.busyRow}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={s.logoutConfirmText}>{tp('Signing out…')}</Text>
                </View>
              ) : (
                <Text style={s.logoutConfirmText}>{tp('Log out')}</Text>
              )}
            </Pressable>
            <Pressable style={s.delCancel} onPress={() => setConfirmLogout(false)} disabled={loggingOut}>
              <Text style={s.delCancelText}>{tp('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Delete confirm */}
      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => { if (!deleting) setConfirmDelete(false); }}>
        <View style={s.modalRoot}>
          <Pressable style={s.modalBack} onPress={() => { if (!deleting) setConfirmDelete(false); }} />
          <View style={s.modalCard}>
            <View style={s.delIc}><Ionicons name="trash-outline" size={22} color="#c0392b" /></View>
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
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={s.delConfirmText}>{t('Deleting account…')}</Text>
                </View>
              ) : (
                <Text style={s.delConfirmText}>{t('Delete my account')}</Text>
              )}
            </Pressable>
            <Pressable style={s.delCancel} onPress={() => setConfirmDelete(false)} disabled={deleting}>
              <Text style={s.delCancelText}>{t('Cancel')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}


// ── Change phone number (enter → WhatsApp OTP) ───────────────────────────────
function ChangePhone({
  current,
  isRTL,
  onDone,
  onClose,
}: {
  current: string;
  isRTL: boolean;
  onDone: (sub: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<'enter' | 'otp'>('enter');
  const [cc, setCc] = useState<Country>(COUNTRIES[0]);
  const [ccOpen, setCcOpen] = useState(false);
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
                {/* Saudi only (+966) — fixed dial code, no country dropdown. (user request.) */}
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
              {ccOpen && (
                <View style={s.phCcList}>
                  {COUNTRIES.map((c) => (
                    <Pressable key={c.code} style={[s.phCcItem, c.code === cc.code && s.phCcItemSel]} onPress={() => { setCc(c); setCcOpen(false); setPhone(''); }}>
                      <Text style={{ fontSize: 18 }}>{c.flag}</Text>
                      <Text style={s.phCcName}>{t(c.name)}</Text>
                      <Text style={s.phCcCode}>{c.code}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {!!(liveErr || err) && <Text style={s.phErr}>{liveErr || err}</Text>}
              <Pressable style={[s.delConfirmOk, (!valid || busy) && { opacity: 0.4 }]} disabled={!valid || busy} onPress={sendCode}>
                <Text style={s.delConfirmText}>{t('Send code')}</Text>
              </Pressable>
              <Pressable style={s.delCancel} onPress={onClose}>
                <Text style={s.delCancelText}>{t('Cancel')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.waIc}><Ionicons name="logo-whatsapp" size={26} color="#fff" /></View>
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
  // Centered popup over a dimmed page (the route is a transparentModal, so this card floats above
  // whatever screen launched Settings instead of replacing it full-screen).
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  // Lighter overlay (item 7) — a soft wash, not a heavy slab; web also gets a gentle blur inline.
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,22,16,0.30)' },
  popup: { width: '100%', maxWidth: MAX_W, backgroundColor: colors.paper, borderRadius: 22, overflow: 'hidden', ...cardShadow, shadowOpacity: 0.22, shadowRadius: 26 },

  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  xBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },

  signedOut: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 44 },
  signedOutText: { fontSize: 16, color: colors.muted },
  primaryBtn: { backgroundColor: colors.dark, borderRadius: 13, paddingVertical: 13, paddingHorizontal: 28 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  scroll: { paddingHorizontal: 20, alignItems: 'center', paddingTop: 4 },
  col: { width: '100%', maxWidth: MAX_W },
  h: { fontSize: 24, fontWeight: '700', color: colors.ink, marginBottom: 6 },

  sec: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.fieldLine, overflow: 'hidden' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowTop: { borderTopWidth: 1, borderTopColor: colors.line },
  rowCol: { padding: 14, gap: 8 },
  rowColTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  k: { fontSize: 12, color: colors.muted },
  kRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedTag: { flexDirection: 'row', alignItems: 'center', gap: 3, ...(Platform.OS === 'web' ? ({ transitionProperty: 'opacity', transitionDuration: '200ms' } as any) : {}) },
  savedTx: { fontSize: 11, fontWeight: '600', color: colors.primary },
  v: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 3 },
  input: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 3, borderBottomWidth: 1, borderBottomColor: colors.primary, paddingVertical: 2, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  // Compact green Save button under the name field — app-green, noticeable but not oversized,
  // self-sized to its content so it sits neatly under the input. (user request.)
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 16, marginTop: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  saveBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  act: { paddingHorizontal: 8, paddingVertical: 6 },
  actText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  // Click-to-edit name target: a small hit area with a soft hover wash + text cursor (web).
  nameTap: { alignSelf: 'flex-start', marginTop: 1, marginHorizontal: -6, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  nameTapHover: { backgroundColor: '#eef1ef' },
  nameRowHover: { backgroundColor: '#f4f6f4' },
  locked: { fontSize: 11.5, color: colors.muted, fontWeight: '500' },
  accNote: { fontSize: 12, color: colors.muted, lineHeight: 17 },

  dev: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  cur: { fontSize: 12, fontWeight: '600', color: colors.primary },

  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 14 },
  deleteText: { fontSize: 14.5, fontWeight: '600', color: '#c0392b' },
  // Note #10 — full-width Logout (green tint) + Delete (red tint), each with its own icon. Matches
  // the user's screenshot (tinted background, colored icon + matching text, centered). (user request.)
  logoutPrimary: { backgroundColor: '#e8efe9', borderColor: colors.tintLine, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, marginTop: 18 },
  logoutPrimaryText: { fontSize: 16, fontWeight: '700', color: colors.primary },
  deleteDanger: { backgroundColor: '#fbe8e6', borderColor: '#f3cfca', borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 15, marginTop: 10 },
  deleteDangerText: { fontSize: 16, fontWeight: '700', color: '#c0392b' },
  // Row inside each button: icon + text, centered together.
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  logout: { alignItems: 'center', paddingVertical: 16, marginTop: 18 },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.muted },

  // Modals — pinned to the VIEWPORT and centered both axes, so the dialog is always dead-center
  // regardless of sidebar state, scroll, zoom, or content behind it. (web: position:fixed inset:0.)
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, ...(Platform.OS === 'web' ? ({ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 } as any) : null) },
  modalBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.5)' },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: '#fff', borderRadius: 22, padding: 24, alignItems: 'center', ...{ shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 12 } },
  delIc: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fbeaea', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  waIc: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.whatsApp, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  delT: { fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  delS: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  delNote: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 17, backgroundColor: '#f6f8f6', borderRadius: 10, padding: 10 },
  delConfirm: { width: '100%', backgroundColor: '#c0392b', borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  delConfirmOk: { width: '100%', backgroundColor: colors.dark, borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  delConfirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  delCancel: { width: '100%', paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  delCancelText: { fontSize: 14, fontWeight: '500', color: colors.muted },
  // Log-out confirm dialog — neutral green tint (not destructive red).
  logoutIc: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  logoutConfirm: { width: '100%', backgroundColor: colors.primary, borderRadius: 13, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  logoutConfirmText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  // change-phone field
  phField: { flexDirection: 'row', gap: 8, marginTop: 18, width: '100%' },
  phCc: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#dfe3e0', backgroundColor: '#fff' },
  phCcText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  phInput: { flex: 1, height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#dfe3e0', fontSize: 15, color: colors.ink, backgroundColor: '#fff', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  phCcList: { width: '100%', marginTop: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 6 },
  phCcItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 9 },
  phCcItemSel: { backgroundColor: '#eef6f0' },
  phCcName: { flex: 1, fontSize: 13.5, color: colors.ink },
  phCcCode: { fontSize: 13.5, color: colors.muted, fontWeight: '600' },
  phErr: { fontSize: 11.5, color: '#c0392b', marginTop: 8, alignSelf: 'flex-start' },

  otpBoxes: { flexDirection: 'row', gap: 8, marginTop: 18 },
  otpBox: { width: 38, height: 48, borderRadius: 11, borderWidth: 1.5, borderColor: '#dfe3e0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  otpBoxActive: { borderColor: colors.primary },
  otpDigit: { fontSize: 20, fontWeight: '700', color: colors.ink },
  otpHidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
});
