import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '@/theme/tokens';
import { useApp } from '@/store';

// /about — a DOOR, not a screen. (owner 2026-09-03)
//
// This file used to render its own «من نحن» page, written for the prototype. Nothing in the app has
// linked here for a long time — the sidebar opens components/InfoModal — so it became a SECOND About
// surface that nobody maintained, and it drifted: the canonical screen was redesigned around the
// eagle artwork with compact approved copy, while anyone who typed /about still got the old plain
// text page. Worse, a stale copy of the LEGAL text is the dangerous kind of duplicate: the licensing,
// disclaimer and privacy statements have to be corrected in ONE place when they change, and this
// file was a second place that no correction ever reached.
//
// The rule this file now enforces, and the reason it has no content of its own: THERE IS EXACTLY ONE
// About experience, and it lives in components/InfoModal.tsx — including the truthful
// listing-provenance statement, which verify-no-unsupported-claims.ts checks THERE. This route opens
// that one and steps out of the way. The URL keeps working; the duplicate cannot drift again,
// because there is nothing here left to drift. Same call the owner already made for /settings
// (removed 2026-08-28 in favour of the anchored account panel).
//
// Pinned by scripts/verify-info-routes-single-source.ts.
export default function AboutRoute() {
  const router = useRouter();
  const { openModal } = useApp();

  useEffect(() => {
    // Order matters: raise the modal FIRST, then swap the URL. `modal` lives in the app-wide store,
    // so it survives the navigation — the user lands on the home screen with «من نحن» already open,
    // and never sees a frame of empty page. replace(), not push(), so Back does not bounce them
    // straight back into this redirect.
    openModal('about');
    router.replace('/');
  }, [openModal, router]);

  // A paper-coloured filler for the one frame before the swap: `null` would flash white in dark mode.
  return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
}
