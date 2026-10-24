import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp, type AuthUser } from '@/store';
import { useI18n, translate } from '@/i18n';
import { useTheme } from '@/theme/theme';
import { isBackendLive, markNamePromptSeen } from '@/lib/auth';
import { useSaveName } from '@/lib/useSaveName';
import { otherSpelling, scriptOf } from '@/lib/nameSync';
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
//
// FINAL design, mockups/name-box-v4.png (owner 2026-10-23): centered box; the circle shows the typed name's
// first letter live; the switch flips the WHOLE box (language + direction); under the field, the other
// script's spelling (the same translit source as the save, 400 ms after typing stops, never a stale one);
// small «لاحقاً» above the full-width «حفظ» at the very bottom. «أضف اسمك ✏️» in the account menu reopens it.
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

/** The circle's letter: the typed name's first character, live ('' → the person icon). */
export function letterOf(typed: string): string {
  return (typed ?? '').trim().charAt(0).toUpperCase();
}

/** The preview chip's text, only when it was computed for exactly what is typed now — never a stale one. */
export function previewFor(p: { for: string; text: string } | null, typed: string): string {
  return p && p.text && p.for === (typed ?? '').trim() ? p.text : '';
}

// «أضف اسمك ✏️» (AccountMenu) reopens THIS box — a one-line bus, like ConfettiOverlay's partyConfetti.
let openers: Array<() => void> = [];
export function openNamePrompt(): void { for (const o of openers) { try { o(); } catch { /* UI only */ } } }

type Lang = 'ar' | 'en';
const LANGS: { id: Lang; label: string }[] = [{ id: 'en', label: 'English' }, { id: 'ar', label: 'عربي' }];
const PARTY_MS = 3200;
const PREVIEW_DEBOUNCE_MS = 400;

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
  const [preview, setPreview] = useState<{ for: string; text: string } | null>(null);
  const [reopened, setReopened] = useState(false);
  const ask = shouldAskName(user, authChecked, authOpen) && !closed;
  useEffect(() => {
    const o = () => { setLang(locale); setReopened(true); };
    openers.push(o);
    return () => { openers = openers.filter((x) => x !== o); };
  }, [locale]);
  const shown = open || (reopened && !!user && !user.name.trim());

  // The other script's spelling, 400 ms after typing stops. A late answer for an older input is dropped
  // (previewFor), so the chip never shows a spelling of something no longer typed.
  useEffect(() => {
    const v = name.trim();
    if (!v) { setPreview(null); return; }
    let live = true;
    const id = setTimeout(() => {
      otherSpelling(v).then((text) => { if (live) setPreview({ for: v, text }); }).catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(id); };
  }, [name]);
  const chip = previewFor(preview, name);
  const letter = letterOf(name);
  const other = scriptOf(name.trim()) === 'ar' ? 'en' : 'ar';
  const tr = (en: string) => translate(lang, en);
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

  const close = () => { setClosed(true); setReopened(false); markNamePromptSeen(); };
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
      {shown && (
        <Modal transparent visible animationType="fade" onRequestClose={close}>
          <View style={s.back}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={tr('Later')} />
            <View style={[s.card, lang === 'ar' ? s.rtl : s.ltr]} testID="name-prompt">
              <View style={s.avatar} testID="name-prompt-letter">
                {letter ? <Text style={s.avatarText}>{letter}</Text> : <Ionicons name="person" size={26} color="#fff" />}
              </View>
              <Text style={s.title}>{tr('What should we call you?')}</Text>
              <Text style={s.sub}>{tr("We'll greet you by name and share a property fact every day")}</Text>
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
              <View style={s.prev}>
                {!!chip && (<>
                  <Text style={s.prevLabel}>{tr(other === 'en' ? 'In English:' : 'In Arabic:')}</Text>
                  <Text testID="name-prompt-preview" style={[s.chip, other === 'en' ? s.ltr : s.rtl]} numberOfLines={1}>{chip}</Text>
                </>)}
              </View>
              <Pressable testID="name-prompt-later" style={s.later} onPress={close} hitSlop={8}>
                <Text style={s.laterText}>{tr('Later')}</Text>
              </Pressable>
              <Pressable testID="name-prompt-save" style={[s.save, !name.trim() && s.saveOff]} onPress={save} disabled={!name.trim()}>
                <Text style={s.saveText}>{tr('Save')}</Text>
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
    card: { width: '100%', maxWidth: 360, alignItems: 'stretch', backgroundColor: C.surface, borderRadius: 24, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 18, shadowColor: '#000', shadowOpacity: dark ? 0.6 : 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 14 },
    rtl: { direction: 'rtl' as any, writingDirection: 'rtl' },
    ltr: { direction: 'ltr' as any, writingDirection: 'ltr' },
    avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary, borderWidth: 4, borderColor: dark ? C.surface2 : C.tint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 },
    avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
    title: { fontSize: 23, lineHeight: 31, fontWeight: '700', color: C.ink, textAlign: 'center' },
    sub: { fontSize: 14, lineHeight: 21, color: C.muted, textAlign: 'center', marginTop: 6, marginBottom: 16 },
    // The switch reads English | عربي in both languages (as in the mockup), so it never flips under RTL.
    seg: { flexDirection: 'row', direction: 'ltr' as any, backgroundColor: dark ? C.surface2 : C.tint, borderRadius: 999, padding: 4, marginBottom: 14 },
    segItem: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center', ...ptr },
    segOn: { backgroundColor: C.surface, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segText: { fontSize: 15, fontWeight: '600', color: C.muted },
    segTextOn: { color: dark ? C.ink : '#1d4a37' },
    input: {
      fontSize: 18, fontWeight: '500', color: C.ink,
      borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14,
      ...(web ? { outlineStyle: 'none' as any } : {}),
    },
    // The switch decides the field's direction — never the app's language.
    inputAr: { textAlign: 'right', writingDirection: 'rtl' },
    inputEn: { textAlign: 'left', writingDirection: 'ltr' },
    // Reserved height, so the chip arriving never shifts «لاحقاً» / «حفظ» under a finger.
    prev: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, marginTop: 10, marginBottom: 14, marginHorizontal: 2 },
    prevLabel: { fontSize: 14, color: C.muted },
    chip: { flexShrink: 1, backgroundColor: dark ? C.surface2 : C.tint, color: dark ? C.ink : '#1d4a37', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, fontSize: 14, fontWeight: '600', overflow: 'hidden' },
    later: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12, marginBottom: 12, ...ptr },
    laterText: { color: '#9aa6a0', fontSize: 12, fontWeight: '500' },
    save: { backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', ...ptr },
    saveOff: { opacity: 0.45 },
    saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    party: { position: (web ? 'fixed' : 'absolute') as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, alignItems: 'center', justifyContent: 'center', padding: 24 },
    partyCard: { direction: (rtl ? 'rtl' : 'ltr') as any, alignItems: 'center', backgroundColor: dark ? 'rgba(18,28,22,0.94)' : 'rgba(255,255,255,0.95)', borderRadius: 24, paddingVertical: 26, paddingHorizontal: 28, maxWidth: 360, shadowColor: '#000', shadowOpacity: dark ? 0.5 : 0.18, shadowRadius: 26, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
    partyEmoji: { fontSize: 46, lineHeight: 56 },
    partyTitle: { fontSize: 26, lineHeight: 36, fontWeight: '800', color: C.ink, textAlign: 'center', marginTop: 6 },
    partySub: { fontSize: 16, lineHeight: 22, color: C.muted, textAlign: 'center', marginTop: 6 },
  });
};
