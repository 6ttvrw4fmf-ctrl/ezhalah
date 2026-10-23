import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useApp, type AuthUser } from '@/store';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme/theme';
import { isBackendLive, markNamePromptSeen } from '@/lib/auth';
import { useSaveName } from '@/lib/useSaveName';

// «وش نناديك؟» — asked ONCE per account when a sign-in arrives with no name (owner 2026-10-23).
// Apple sends the name only on the first authorization and Google accounts can lack one; the name is
// never derived from the email (scripts/verify-display-name-never-from-email.ts), so we ask. The
// field starts EMPTY. «حفظ» saves through the rename's own path (useSaveName); «لاحقاً» just closes.
// Either way user_metadata.name_prompt_seen is set, so it never returns on any device — «أضف اسمك» in
// the sidebar stays the permanent way to add it later. Guarded by scripts/verify-apple-name-and-prompt.ts.
export function shouldAskName(user: AuthUser | null, authChecked: boolean, authOpen: boolean): boolean {
  return isBackendLive && authChecked && !authOpen && !!user && !user.name.trim() && !user.namePromptSeen;
}

export default function NamePrompt() {
  const { user, authChecked, authOpen } = useApp();
  const { t, locale } = useI18n();
  const { resolved, colors: C } = useTheme();
  const s = useMemo(() => makeStyles(C, resolved === 'dark', locale === 'ar'), [C, resolved, locale]);
  const saveName = useSaveName();
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ask = shouldAskName(user, authChecked, authOpen) && !closed;
  useEffect(() => { setClosed(false); setName(''); }, [user?.sub]); // another account on this tab is asked afresh

  // A short settle: Apple's first-sign-in name is saved a beat after the session lands, and the
  // sign-in popup is still closing — neither should flash this sheet.
  useEffect(() => {
    if (!ask) { setOpen(false); return; }
    const id = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(id);
  }, [ask]);

  const close = () => { setClosed(true); markNamePromptSeen(); };
  const save = () => {
    const v = name.trim();
    if (!v) return;
    saveName(v);
    close();
  };

  if (!open) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <View style={s.back}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('Later')} />
        <View style={s.card} testID="name-prompt">
          <Text style={s.title}>{t('What should we call you?')}</Text>
          <TextInput
            testID="name-prompt-input"
            style={s.input}
            value={name}
            autoFocus
            placeholder={t('Display Name')}
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
  );
}

const makeStyles = (C: any, dark: boolean, rtl: boolean) => {
  const start = rtl ? 'right' : 'left';
  const web = Platform.OS === 'web';
  return StyleSheet.create({
    // Same scrim and card as AccountMenu's centered views.
    back: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: dark ? 'rgba(4,8,6,0.62)' : 'rgba(8,18,12,0.5)', ...(web ? ({ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' } as any) : null) },
    card: { direction: (rtl ? 'rtl' : 'ltr') as any, width: '100%', maxWidth: 360, backgroundColor: C.surface, borderRadius: 22, borderWidth: 1, borderColor: C.fieldLine, padding: 22, shadowColor: '#000', shadowOpacity: dark ? 0.6 : 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 20 }, elevation: 14 },
    title: { fontSize: 19, lineHeight: 26, fontWeight: '800', color: C.ink, textAlign: start as any, writingDirection: 'auto' as any, paddingBottom: 14 },
    input: {
      fontSize: Platform.OS === 'web' ? 16 : 15, fontWeight: '600', color: C.ink, textAlign: start as any, writingDirection: 'auto' as any,
      borderWidth: 1, borderColor: C.fieldLine, backgroundColor: dark ? C.surface2 : C.tint, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12,
      ...(web ? { outlineStyle: 'none' as any } : {}),
    },
    save: { marginTop: 14, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', ...(web ? { cursor: 'pointer' as any } : {}) },
    saveOff: { opacity: 0.45 },
    saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    later: { marginTop: 8, paddingVertical: 10, alignItems: 'center', ...(web ? { cursor: 'pointer' as any } : {}) },
    laterText: { color: C.muted, fontSize: 14, fontWeight: '600' },
  });
};
