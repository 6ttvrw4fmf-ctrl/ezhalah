import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp, type AuthUser } from '@/store';
import { useI18n, translate } from '@/i18n';
import { useTheme } from '@/theme/theme';
import { isBackendLive, markNamePromptSeen } from '@/lib/auth';
import { useSaveName } from '@/lib/useSaveName';
import { otherSpelling, scriptOf } from '@/lib/nameSync';
import { markJustSignedIn } from '@/lib/loginWelcome';
import { supabase } from '@/lib/supabase';

// «وش نناديك؟» — asked ONCE per account when a sign-in arrives with no name (owner 2026-10-23).
// Apple sends the name only on the first authorization and Google accounts can lack one; the name is
// never derived from the email (scripts/verify-display-name-never-from-email.ts), so we ask. The
// field starts EMPTY. «حفظ» saves through the rename's own path (useSaveName); «لاحقاً» just closes.
// Either way user_metadata.name_prompt_seen is set, so it never returns on any device — «أضف اسمك» in
// the sidebar stays the permanent way to add it later. Guarded by scripts/verify-apple-name-and-prompt.ts.
//
// AFTER «حفظ», THE WELCOME A GOOGLE SIGN-IN GETS (owner 2026-10-23: «it should become "Hi Yusuf" … like the
// Gmail thing»): the home headline swaps to the personal greeting — the same markJustSignedIn() the /auth
// landing and One Tap call (lib/loginWelcome.ts → useFilterWelcome), same text, animation and timing. A
// nameless sign-in gets no greeting (useFilterWelcome needs a name), so the welcome waits for the box and
// fires ONCE, after the saved name is in the stored session the headline reads. «لاحقاً»: no welcome.
//
// FINAL design, mockups/name-box-v4.png (owner 2026-10-23): centered box; the circle shows the typed name's
// first letter live; the switch flips the WHOLE box (language + direction); under the field, the other
// script's spelling (the same translit source as the save, 400 ms after typing stops, never a stale one);
// small «لاحقاً» above the full-width «حفظ» at the very bottom. «أضف اسمك ✏️» in the account menu reopens it.
export function shouldAskName(user: AuthUser | null, authChecked: boolean, authOpen: boolean): boolean {
  return isBackendLive && authChecked && !authOpen && !!user && !user.name.trim() && !user.namePromptSeen;
}

/** After «حفظ»: fire the sign-in welcome ONCE, the moment the saved name `v` is in the stored session
 *  (USER_UPDATED is emitted after supabase-js saves it; the headline reads the name from there). No
 *  update within 20 s (offline, failed write) → no welcome, never a nameless one. */
export function welcomeOnceSaved(v: string): void {
  if (!supabase) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event !== 'USER_UPDATED' || String(session?.user?.user_metadata?.full_name ?? '') !== v) return;
    stop();
    markJustSignedIn();
  });
  const stop = () => { if (timer) clearTimeout(timer); data.subscription.unsubscribe(); };
  timer = setTimeout(stop, 20000);
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
const PREVIEW_DEBOUNCE_MS = 400;

export default function NamePrompt() {
  const { user, authChecked, authOpen } = useApp();
  const { t, locale } = useI18n();
  const { resolved, colors: C } = useTheme();
  const s = useMemo(() => makeStyles(C, resolved === 'dark'), [C, resolved, locale]);
  const saveName = useSaveName();
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>(locale);
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

  const close = () => { setClosed(true); setReopened(false); markNamePromptSeen(); };
  const save = () => {
    const v = name.trim();
    if (!v) return;
    saveName(v);
    close();
    welcomeOnceSaved(v);
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
    </>
  );
}

const makeStyles = (C: any, dark: boolean) => {
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
  });
};
