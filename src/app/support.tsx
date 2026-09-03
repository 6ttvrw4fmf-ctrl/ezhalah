import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/theme/tokens';
import { useApp } from '@/store';

// /support — a DOOR, not a screen. (owner 2026-09-03)
//
// This file used to render its own Support page: two mailto-style address cards and a response-time
// panel, built for the prototype. Nothing in the app has linked here for a long time — the sidebar
// and the account menu both open components/InfoModal — so it quietly became a SECOND Support
// surface that nobody maintained. By 2026-09-02 it contradicted the real one outright: the canonical
// screen had become a working message form, while anyone who typed /support (or followed an old
// bookmark) still got a dead address card telling them to go and write an email by hand.
//
// The rule this file now enforces, and the reason it has no content of its own: THERE IS EXACTLY ONE
// Support experience, and it lives in components/InfoModal.tsx. This route opens that one and steps
// out of the way. The URL keeps working; the duplicate cannot drift again, because there is nothing
// here left to drift. Same shape as /about, and the same call the owner already made for /settings
// (removed 2026-08-28 in favour of the anchored account panel).
//
// Pinned by scripts/verify-info-routes-single-source.ts.
export default function SupportRoute() {
  const router = useRouter();
  const { openModal } = useApp();

  useEffect(() => {
    // Order matters: raise the modal FIRST, then swap the URL. `modal` lives in the app-wide store,
    // so it survives the navigation — the user lands on the home screen with Support already open,
    // and never sees a frame of empty page. replace(), not push(), so Back does not bounce them
    // straight back into this redirect.
    openModal('support');
    router.replace('/');
  }, [openModal, router]);

  // A paper-coloured filler for the one frame before the swap: `null` would flash white in dark mode.
  return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
}
