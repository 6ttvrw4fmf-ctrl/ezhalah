import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { markJustSignedIn } from '@/lib/loginWelcome';

// OAuth REDIRECT LANDING STUB ONLY (owner 2026-08-15: sign-in is now a true in-place overlay —
// see src/components/AuthModal.tsx — never a separate-looking route). This route still has to
// exist because Google/Apple/Supabase redirect the browser back to a real URL
// (window.location.origin + '/auth', set in src/lib/auth.ts's signInWithProvider) after an OAuth
// round-trip; a real user never sees this route in the normal sign-in flow (the sidebar/settings
// entry points open the AuthModal overlay directly, no navigation involved).
//
// The store's own onAuthStateChange listener (src/store.tsx) already adopts the session globally,
// independent of which route is mounted — so this stub does not need to wait for `user` to become
// set; it just bounces immediately to wherever the user should land. If a message was parked before
// the OAuth round-trip, land back in the chat so it replays; otherwise go Home.
//
// It is also the one place every Google/Apple sign-in and sign-up passes through, so it marks the
// moment for the home's welcome line (owner 2026-10-22, lib/loginWelcome.ts). A cancelled OAuth that
// lands here with no session shows nothing: the home only uses the mark once a user is signed in.
export default function Auth() {
  const router = useRouter();
  useEffect(() => {
    markJustSignedIn();
    AsyncStorage.getItem('pendingMessage')
      .then((pm) => router.replace(pm ? '/agent' : '/'))
      .catch(() => router.replace('/'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
