import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp, type AuthUser } from '@/store';
import { useI18n, translate } from '@/i18n';
import { useTheme } from '@/theme/theme';
import { isBackendLive, markNamePromptSeen } from '@/lib/auth';
import { useSaveName } from '@/lib/useSaveName';
import { otherSpelling, scriptOf } from '@/lib/nameSync';
import { markJustSignedIn, isFreshSignUp } from '@/lib/loginWelcome';
import { supabase } from '@/lib/supabase';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { ensureNameBoxCss, startNamePartyFromBox } from '@/lib/nameParty';

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
//
// SIGN-UP ONLY + THE PARTY (owner-approved demo mockups/name-box-party.html, 2026-10-23): the box opens by
// itself only for the sign-in that CREATED the account (lib/loginWelcome isFreshSignUp) — a returning
// Google/Apple user never sees it. A Google sign-up's box is PREFILLED with the name Google sent (the
// switch on that name's script); an Apple sign-up's is empty. «حفظ» → the box shrinks away, the home
// headline's sign-in welcome (+ a shine), and a 5-second confetti party (lib/nameParty.ts). «لاحقاً»: no
// party, and Google's name stays as it is. The motion is the demo's CSS (data-ezh-* + lib/nameParty.ts).
// OWNER 2026-10-26: no box when the sign-up already HAS a name (Google always, Apple when it shares it): that
// name is kept and the party plays by itself (shouldPartyOnSignUp). The box is only for a nameless sign-up,
// and its «تخطي» leaves the account showing «ضيف إزهله» until the user adds a name.
export function shouldAskName(user: AuthUser | null, authChecked: boolean, authOpen: boolean, now: number): boolean {
  return isBackendLive && authChecked && !authOpen && !!user && !user.namePromptSeen && !(user.name ?? '').trim() && isFreshSignUp(user.createdAt, user.lastSignInAt, now);
}

/** A sign-up that arrived WITH a name: no box, the party once (owner 2026-10-26). */
export function shouldPartyOnSignUp(user: AuthUser | null, authChecked: boolean, authOpen: boolean, now: number): boolean {
  return isBackendLive && authChecked && !authOpen && !!user && !user.namePromptSeen && !!(user.name ?? '').trim() && isFreshSignUp(user.createdAt, user.lastSignInAt, now);
}

/** After «حفظ»: fire the sign-in welcome ONCE (and the party with it), the moment the saved name `v` AND
 *  the «seen» flag are in the stored session (USER_UPDATED is emitted after supabase-js saves it; the
 *  headline reads the name from there, and waits while a sign-up's box is unanswered). No update within
 *  20 s (offline, failed write) → no welcome, never a nameless one. */
export function welcomeOnceSaved(v: string, onWelcome: () => void): void {
  if (!supabase) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const m = session?.user?.user_metadata ?? {};
    if (event !== 'USER_UPDATED' || String(m.full_name ?? '') !== v || m.name_prompt_seen !== true) return;
    stop();
    markJustSignedIn();
    onWelcome();
  });
  const stop = () => { if (timer) clearTimeout(timer); data.subscription.unsubscribe(); };
  timer = setTimeout(stop, 20000);
}

/** After «تخطي» on a nameless sign-up (owner 2026-10-26): the same welcome and party «حفظ» gives, greeting «ضيف إزهله»,
 *  once the «seen» write is in the stored session (that is what lets the home greet the guest name). 20 s cap. */
export function welcomeOnceSkipped(onWelcome: () => void): void {
  if (!supabase) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    const m = session?.user?.user_metadata ?? {};
    if (event !== 'USER_UPDATED' || m.name_prompt_seen !== true || String(m.full_name || m.name || '').trim()) return;
    stop();
    markJustSignedIn();
    onWelcome();
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
const LEAVE_MS = 230;
type Phase = 'off' | 'enter' | 'on' | 'leave';
// react-native-web's data-* attributes (the demo CSS targets them); untyped on RN's host props.
const ds = (d: Record<string, string>) => ({ dataSet: d } as any);

export default function NamePrompt() {
  const { user, authChecked, authOpen } = useApp();
  const { t, locale } = useI18n();
  const { resolved, colors: C } = useTheme();
  const s = useMemo(() => makeStyles(C, resolved === 'dark'), [C, resolved, locale]);
  const reduced = useReducedMotion();
  const saveName = useSaveName();
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>(locale);
  const [preview, setPreview] = useState<{ for: string; text: string } | null>(null);
  const [reopened, setReopened] = useState(false);
  const [phase, setPhase] = useState<Phase>('off');
  const [focused, setFocused] = useState(false);
  const [shakeN, setShakeN] = useState(0);
  const [segW, setSegW] = useState(0);
  const field = useRef<TextInput>(null);
  const ask = shouldAskName(user, authChecked, authOpen, Date.now()) && !closed;
  const party = shouldPartyOnSignUp(user, authChecked, authOpen, Date.now());
  const partied = useRef<string | null>(null);
  useEffect(() => { ensureNameBoxCss(); }, []);
  useEffect(() => {
    const o = () => { setName(''); setLang(locale); setReopened(true); };
    openers.push(o);
    return () => { openers = openers.filter((x) => x !== o); };
  }, [locale]);
  const shown = open || (reopened && !!user && !user.name.trim());
  // Mount → next frames «on» (the CSS spring plays) → «leave» (shrink + fade, 220 ms) → unmount.
  useEffect(() => { if (shown && (phase === 'off' || phase === 'leave')) setPhase('enter'); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // A timer, not an animation frame: frames never fire in a background tab, which would leave an invisible
  // box (opacity 0) over the page. Reading layout first commits the «enter» styles, so the CSS spring plays.
  useEffect(() => {
    if (phase !== 'enter') return;
    const id = setTimeout(() => {
      if (typeof document !== 'undefined') void document.body?.offsetHeight;
      setPhase('on');
    }, 20);
    return () => clearTimeout(id);
  }, [phase]);

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
    // A Google sign-up arrives with Google's name: the box opens PREFILLED, the switch on its script.
    const given = (user?.name ?? '').trim();
    setName(given);
    setLang(given ? scriptOf(given) : locale);
    const id = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  const close = () => { setClosed(true); setReopened(false); markNamePromptSeen(); setPhase('leave'); setTimeout(() => setPhase((p) => (p === 'leave' ? 'off' : p)), LEAVE_MS); };
  // «تخطي»: the box closes; on the sign-up box (not the menu's reopen) a nameless account is then welcomed as
  // «ضيف إزهله» with the party (owner 2026-10-26: «with party it's fine»).
  const skip = () => {
    const signUpBox = !reopened && !(user?.name ?? '').trim();
    close();
    if (signUpBox) welcomeOnceSkipped(() => startNamePartyFromBox(reduced));
  };
  const save = () => {
    const v = name.trim();
    // An empty «حفظ» is not disabled: the field gives a small shake and takes the focus.
    if (!v) { setShakeN((n) => n + 1); field.current?.focus(); return; }
    saveName(v);
    close();
    welcomeOnceSaved(v, () => startNamePartyFromBox(reduced));
  };
  // A sign-up that arrived WITH a name (owner 2026-10-26): no box. Record «seen», then the very same welcome and
  // party «حفظ» gives, once, when that write is in the session (welcomeOnceSaved).
  useEffect(() => {
    if (!party || !user || partied.current === user?.sub) return;
    partied.current = user?.sub ?? null;
    const given = user.name.trim();
    markNamePromptSeen();
    welcomeOnceSaved(given, () => startNamePartyFromBox(reduced));
  }, [party, user?.sub]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'off') return null;
  const thumbW = segW > 8 ? (segW - 8) / 2 : 0;
  return (
    <View style={s.overlay} {...ds({ ezhScrim: phase })}>
      {/* No tap-outside dismiss (owner P1 2026-10-24): a stray tap while the box was still fading in marked a
          Google sign-up «seen» without the box ever being seen. Only «حفظ» or «لاحقاً» answer it. */}
      <View style={[s.card, lang === 'ar' ? s.rtl : s.ltr]} testID="name-prompt" {...ds({ ezhCard: '1' })} {...({ role: 'dialog', 'aria-modal': true } as any)}>
        <View style={s.avatar} testID="name-prompt-letter" {...ds({ ezhAv: '1' })}>
          {letter
            ? <Text key={letter} style={s.avatarText} {...ds({ ezhLetter: '1' })}>{letter}</Text>
            : <View key="person" {...ds({ ezhLetter: '1' })}><Ionicons name="person" size={26} color="#fff" /></View>}
        </View>
        <Text style={s.title}>{tr('What should we call you?')}</Text>
        <Text style={s.sub}>{tr("We'll greet you by name and share a property fact every day")}</Text>
        <View style={s.seg} testID="name-prompt-lang" onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
          {thumbW > 0 && <View style={[s.thumb, { width: thumbW, transform: [{ translateX: lang === 'ar' ? thumbW : 0 }] }]} {...ds({ ezhThumb: '1' })} />}
          {LANGS.map((l) => (
            <Pressable key={l.id} testID={`name-prompt-lang-${l.id}`} style={s.segItem} onPress={() => setLang(l.id)} accessibilityRole="button" accessibilityState={{ selected: lang === l.id }}>
              <Text style={[s.segText, lang === l.id && s.segTextOn]} {...ds({ ezhSegtext: '1' })}>{l.label}</Text>
            </Pressable>
          ))}
        </View>
        <View {...ds({ ezhShake: shakeN === 0 ? 'n' : shakeN % 2 ? 'a' : 'b' })}>
          <TextInput
            ref={field}
            testID="name-prompt-input"
            style={[s.input, focused && s.inputFocus, lang === 'ar' ? s.inputAr : s.inputEn]}
            {...ds({ ezhField: '1' })}
            value={name}
            autoFocus
            placeholder={translate(lang, 'Type your name')}
            placeholderTextColor={C.muted}
            onChangeText={setName}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={save}
            returnKeyType="done"
            autoComplete="name"
          />
        </View>
        <View {...ds({ ezhChipwrap: chip ? 'show' : 'hide' })}>
          <View>
            <View style={s.prev}>
              {!!chip && (<>
                <Text style={s.prevLabel}>{tr(other === 'en' ? 'In English:' : 'In Arabic:')}</Text>
                <Text testID="name-prompt-preview" style={[s.chip, other === 'en' ? s.ltr : s.rtl]} numberOfLines={1}>{chip}</Text>
              </>)}
            </View>
          </View>
        </View>
        {!chip && <Text style={s.hint} testID="name-prompt-hint">{tr(lang === 'ar' ? "We'll write it in English for you" : "We'll write it in Arabic for you")}</Text>}
        <Pressable testID="name-prompt-later" style={s.later} onPress={skip} hitSlop={8}>
          <Text style={s.laterText}>{tr('Skip')}</Text>
        </Pressable>
        <Pressable testID="name-prompt-save" style={[s.save, !name.trim() && s.saveOff]} onPress={save} {...ds({ ezhSave: '1' })}>
          <Text style={s.saveText}>{tr('Save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (C: any, dark: boolean) => {
  const web = Platform.OS === 'web';
  const ptr = web ? { cursor: 'pointer' as any } : {};
  return StyleSheet.create({
    // The demo's scrim (its fade + blur are CSS, lib/nameParty.ts) over everything, like AuthModal's overlay.
    overlay: { position: (web ? 'fixed' : 'absolute') as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: dark ? 'rgba(4,8,6,0.62)' : 'rgba(14,28,20,0.38)' },
    card: { width: '100%', maxWidth: 360, alignItems: 'stretch', backgroundColor: C.surface, borderRadius: 26, paddingTop: 26, paddingHorizontal: 20, paddingBottom: 20, shadowColor: '#0a1e14', shadowOpacity: dark ? 0.6 : 0.22, shadowRadius: 50, shadowOffset: { width: 0, height: 18 }, elevation: 14 },
    rtl: { direction: 'rtl' as any, writingDirection: 'rtl' },
    ltr: { direction: 'ltr' as any, writingDirection: 'ltr' },
    avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12, ...(web ? ({ boxShadow: `0 0 0 5px ${dark ? C.surface2 : C.tint}` } as any) : { borderWidth: 4, borderColor: dark ? C.surface2 : C.tint }) },
    avatarText: { color: '#fff', fontSize: 26, fontWeight: '700' },
    title: { fontSize: 23, lineHeight: 31, fontWeight: '700', color: C.ink, textAlign: 'center' },
    sub: { fontSize: 14, lineHeight: 21, color: C.muted, textAlign: 'center', marginTop: 6, marginBottom: 16 },
    // The switch reads English | عربي in both languages (as in the mockup), so it never flips under RTL.
    seg: { flexDirection: 'row', direction: 'ltr' as any, backgroundColor: dark ? C.surface2 : C.tint, borderRadius: 999, padding: 4, marginBottom: 12 },
    // The white thumb glides under the picked side (transition: lib/nameParty.ts [data-ezh-thumb]).
    thumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: 999, backgroundColor: C.surface, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segItem: { flex: 1, paddingVertical: 9, borderRadius: 999, alignItems: 'center', zIndex: 1, ...ptr },
    segText: { fontSize: 15, fontWeight: '600', color: C.muted },
    segTextOn: { color: dark ? C.ink : '#1d4a37' },
    input: {
      fontSize: 18, fontWeight: '500', color: C.ink,
      borderWidth: 1.5, borderColor: C.fieldLine, backgroundColor: C.surface, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14,
      ...(web ? { outlineStyle: 'none' as any } : {}),
    },
    // The focus ring (eased by lib/nameParty.ts [data-ezh-field]).
    inputFocus: { borderColor: C.primary, ...(web ? ({ boxShadow: '0 0 0 4px rgba(47,114,71,0.12)' } as any) : {}) },
    // The switch decides the field's direction — never the app's language.
    inputAr: { textAlign: 'right', writingDirection: 'rtl' },
    inputEn: { textAlign: 'left', writingDirection: 'ltr' },
    // The chip row slides open (grid-rows 0fr→1fr, lib/nameParty.ts); the hint holds its place until then.
    prev: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, marginHorizontal: 2 },
    prevLabel: { fontSize: 13, color: C.muted },
    hint: { fontSize: 12.5, color: C.muted, paddingTop: 9, textAlign: 'center' },
    chip: { flexShrink: 1, backgroundColor: dark ? C.surface2 : C.tint, color: dark ? C.ink : '#1d4a37', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12, fontSize: 14, fontWeight: '600', overflow: 'hidden' },
    later: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 10, marginTop: 18, marginBottom: 10, ...ptr },
    laterText: { color: '#9aa6a0', fontSize: 12, fontWeight: '500' },
    save: { backgroundColor: C.primary, borderRadius: 15, paddingVertical: 15, alignItems: 'center', ...ptr },
    // Not disabled-looking: a soft green until there is a name, then the app green (eased).
    saveOff: { backgroundColor: dark ? '#3c5546' : '#b9cbbf' },
    saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  });
};
