import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp, type AuthUser } from '@/store';
import { useI18n, translate } from '@/i18n';
import { useTheme } from '@/theme/theme';
import { isBackendLive, markNamePromptSeen } from '@/lib/auth';
import { useSaveName } from '@/lib/useSaveName';
import { takeJustSignedIn } from '@/lib/loginWelcome';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { ConfettiOverlay } from '@/components/ConfettiOverlay';

// «وش نناديك؟» — asked ONCE per account when a sign-in arrives with no name (owner 2026-10-23).
// Apple sends the name only on the first authorization and Google accounts can lack one; the name is
// never derived from the email (scripts/verify-display-name-never-from-email.ts), so we ask. The
// field starts EMPTY. «حفظ» saves through the rename's own path (useSaveName); «لاحقاً» just closes.
// Either way user_metadata.name_prompt_seen is set, so it never returns on any device — «أضف اسمك» in
// the sidebar stays the permanent way to add it later. Guarded by scripts/verify-apple-name-and-prompt.ts.
//
// The owner-approved mockup (mockups/apple-name-flow.png, 2026-10-23): a عربي | English switch above the
// field picks the field's direction and placeholder (default: the app's language). A save with a name ends
// in the celebration — the app's own party confetti (ConfettiOverlay) and «هلا {first}، حياك الله» /
// «وش تدور عليه اليوم؟». It IS this sign-in's welcome: it takes the login-welcome mark (lib/loginWelcome.ts)
// so the home's sign-in line does not greet a second time. «لاحقاً» has no party.
export function shouldAskName(user: AuthUser | null, authChecked: boolean, authOpen: boolean): boolean {
  return isBackendLive && authChecked && !authOpen && !!user && !user.name.trim() && !user.namePromptSeen;
}

/** After «حفظ»: the first name to celebrate, or null (nothing typed → no party). Takes the sign-in
 *  welcome mark, so exactly one welcome follows this sign-in. */
export function celebrationFor(typed: string, takeWelcomeMark: () => unknown): string | null {
  const first = typed.trim().split(/\s+/)[0] ?? '';
  if (!first) return null;
  takeWelcomeMark();
  return first;
}

type Lang = 'ar' | 'en';
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'ar', label: 'عربي' }];
const PARTY_MS = 3200;

export default function NamePrompt() {
  const { user, authChecked, authOpen } = useApp();
  const { t, locale } = useI18n();
  const { resolved, colors: C } = useTheme();
  const s = useMemo(() => makeStyles(C, resolved === 'dark', locale === 'ar'), [C, resolved, locale]);
  const saveName = useSaveName();
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>(locale);
  const [party, setParty] = useState<{ first: string; key: number } | null>(null);
  const ask = shouldAskName(user, authChecked, authOpen) && !closed;
  useEffect(() => { setClosed(false); setName(''); }, [user?.sub]); // another account on this tab is asked afresh

  // A short settle: Apple's first-sign-in name is saved a beat after the session lands, and the
  // sign-in popup is still closing — neither should flash this sheet.
  useEffect(() => {
    if (!ask) { setOpen(false); return; }
    setLang(locale);
    const id = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  useEffect(() => {
    if (!party) return;
    const id = setTimeout(() => setParty(null), PARTY_MS);
    return () => clearTimeout(id);
  }, [party]);

  const close = () => { setClosed(true); markNamePromptSeen(); };
  const save = () => {
    const v = name.trim();
    if (!v) return;
    saveName(v);
    close();
    const first = celebrationFor(v, () => takeJustSignedIn(Date.now()));
    if (first) setParty({ first, key: Date.now() });
  };

  return (
    <>
      {open && (
        <Modal transparent visible animationType="fade" onRequestClose={close}>
          <View style={s.back}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('Later')} />
            <View style={s.card} testID="name-prompt">
              <View style={s.avatar}><Ionicons name="person" size={26} color="#fff" /></View>
              <Text style={s.title}>{t('What should we call you?')}</Text>
              <Text style={s.sub}>{t('Choose a language and type your name')}</Text>
              <View style={s.seg} testID="name-prompt-lang">
                {LANGS.map((l) => (
                  <Pressable key={l.id} testID={`name-prompt-lang-${l.id}`} style={[s.segItem, lang === l.id && s.segOn]} onPress={() => setLang(l.id)} accessibilityRole="button" accessibilityState={{ selected: lang === l.id }}>
                    <Text style={[s.segText, lang === l.id && s.segTextOn]}>{l.label}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                testID="name-prompt-input"
                style={[s.input, lang === 'ar' ? s.inputAr : s.inputEn]}
                value={name}
                autoFocus
                placeholder={translate(lang, 'Type your name')}
                placeholderTextColor={C.muted}
                onChangeText={setName}
                onSubmitEditing={save}
                returnKeyType="done"
                autoComplete="name"
              />
              <Pressable testID="name-prompt-save" style={[s.save, !name.trim() && s.saveOff]} onPress={save} disabled={!name.trim()}>
                <Text style={s.saveText}>{t('Save')}</Text>
              </Pressable>
              <Pressable testID="name-prompt-later" style={s.later} onPress={close} hitSlop={6}>
                <Text style={s.laterText}>{t('Later')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
      {party && <Celebration key={party.key} first={party.first} burstKey={party.key} s={s} />}
    </>
  );
}

// The welcome after «حفظ»: decoration only — it never takes a tap and leaves on a timer.
function Celebration({ first, burstKey, s }: { first: string; burstKey: number; s: ReturnType<typeof makeStyles> }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [fade, reduced]);
  return (
    <View pointerEvents="none" style={s.party} testID="name-celebration">
      <Animated.View style={[s.partyCard, { opacity: fade }]}>
        <Text style={s.partyEmoji}>🎉</Text>
        <Text style={s.partyTitle}>{t('Welcome, {name}', { name: first })}</Text>
        <Text style={s.partySub}>{t('What are you looking for today?')}</Text>
      </Animated.View>
      <ConfettiOverlay burstKey={burstKey} />
    </View>
  );
}

const makeStyles = (C: any, dark: boolean, rtl: boolean) => {
  const web = Platform.OS === 'web';
  const ptr = web ? { cursor: 'pointer' as any } : {};
  return StyleSheet.create({
    // Same scrim and card as AccountMenu's centered views.
    back: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: dark ? 'rgba(4,8,6,0.62)' : 'rgba(8,18,12,0.5)', ...(web ? ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as any) : null) },
    card: { direction: (rtl ? 'rtl' : 'ltr') as any, width: '100%', maxWidth: 360, alignItems: 'stretch', backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.fieldLine, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 18, shadowColor: '#000', shadowOpacity: dark ? 0.6 : 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 14 },
    avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 },
    title: { fontSize: 22, lineHeight: 30, fontWeight: '800', color: C.ink, textAlign: 'center' },
    sub: { fontSize: 14, lineHeight: 20, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 16 },
    // The switch reads English | عربي in both languages (as in the mockup), so it never flips under RTL.
    seg: { flexDirection: 'row', direction: 'ltr' as any, borderWidth: 1, borderColor: C.fieldLine, borderRadius: 999, padding: 4, marginBottom: 14 },
    segItem: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', ...ptr },
    segOn: { backgroundColor: C.primary },
    segText: { fontSize: 15, fontWeight: '600', color: C.muted },
    segTextOn: { color: '#fff' },
    input: {
      fontSize: 18, fontWeight: '500', color: C.ink,
      borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
      ...(web ? { outlineStyle: 'none' as any } : {}),
    },
    // The switch decides the field's direction — never the app's language.
    inputAr: { textAlign: 'right', writingDirection: 'rtl' },
    inputEn: { textAlign: 'left', writingDirection: 'ltr' },
    save: { marginTop: 16, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', ...ptr },
    saveOff: { opacity: 0.45 },
    saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    later: { marginTop: 6, paddingVertical: 10, alignItems: 'center', ...ptr },
    laterText: { color: C.muted, fontSize: 14, fontWeight: '600' },
    party: { position: (web ? 'fixed' : 'absolute') as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, alignItems: 'center', justifyContent: 'center', padding: 24 },
    partyCard: { direction: (rtl ? 'rtl' : 'ltr') as any, alignItems: 'center', backgroundColor: dark ? 'rgba(18,28,22,0.94)' : 'rgba(255,255,255,0.95)', borderRadius: 24, paddingVertical: 26, paddingHorizontal: 28, maxWidth: 360, shadowColor: '#000', shadowOpacity: dark ? 0.5 : 0.18, shadowRadius: 26, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
    partyEmoji: { fontSize: 46, lineHeight: 56 },
    partyTitle: { fontSize: 26, lineHeight: 36, fontWeight: '800', color: C.ink, textAlign: 'center', marginTop: 6 },
    partySub: { fontSize: 16, lineHeight: 22, color: C.muted, textAlign: 'center', marginTop: 6 },
  });
};
