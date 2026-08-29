import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/theme/tokens';
import { useApp } from '@/store';

// The centered Settings modal is GONE (owner redesign 2026-08-28) — settings/account now live in
// the sidebar-anchored AccountMenu (src/components/AccountMenu.tsx). This route survives only for
// old deep links / bookmarks: it lands the user home and raises the menu in place. Signed-out
// visitors get the sign-in prompt, exactly as the old gear behavior did.
export default function Settings() {
  const router = useRouter();
  const { user, openAccountMenu, openAuth } = useApp();
  useEffect(() => {
    router.replace('/');
    const id = setTimeout(() => (user ? openAccountMenu() : openAuth()), 80);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
}
