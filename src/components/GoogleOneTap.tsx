// Google One Tap (web only) — the small "Sign in with Google" prompt in the page corner that lets a
// visitor sign in with one click, without ever leaving the page (owner 2026-08-14: "this pop up on
// the top right… user just clicks on it and he signs in").
//
// How it works: Google Identity Services renders its own prompt; on consent it hands us an ID token,
// which Supabase exchanges for a real session (signInWithIdToken). The app's existing
// onAuthStateChange listener in store.tsx then adopts the session — same end state as the
// "Continue with Google" button, minus the redirect round-trip.
//
// The client id is the SAME public Google OAuth client Supabase already uses for the redirect flow
// (it appears in every user's /auth/v1/authorize redirect — public by design, not a secret).
// REQUIREMENT (Google Cloud Console, owner-only): the production origin
// https://ezhalah-app.vercel.app must be listed under the OAuth client's "Authorized JavaScript
// origins" — if it isn't, GIS logs a console warning and simply never shows the prompt; every other
// sign-in path is unaffected. Fail-soft by construction.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store';

const GOOGLE_WEB_CLIENT_ID = '39473044808-06l9dgmb4jsta05h4c5hqdglbsoaqrb5.apps.googleusercontent.com';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export default function GoogleOneTap() {
  const { user } = useApp();

  useEffect(() => {
    if (Platform.OS !== 'web' || user || !supabase) return;
    if (typeof document === 'undefined') return;

    let cancelled = false;

    const start = () => {
      if (cancelled) return;
      const google = (globalThis as any).google;
      if (!google?.accounts?.id) return;
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          callback: async (resp: { credential?: string }) => {
            if (!resp?.credential || !supabase) return;
            // Exchange Google's ID token for a Supabase session; the store's onAuthStateChange
            // listener signs the user in from there. Errors fall through silently — the user still
            // has every normal sign-in path on /auth.
            await supabase.auth.signInWithIdToken({ provider: 'google', token: resp.credential }).catch(() => {});
          },
          // Let returning users through with zero clicks when Google allows it; new users get the
          // one-click prompt. FedCM keeps this working as third-party cookies phase out.
          auto_select: true,
          use_fedcm_for_prompt: true,
        });
        google.accounts.id.prompt();
      } catch {
        // GIS unavailable/misconfigured (e.g. origin not authorized) — prompt simply doesn't show.
      }
    };

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((globalThis as any).google?.accounts?.id) start();
      else existing.addEventListener('load', start, { once: true });
    } else {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.addEventListener('load', start, { once: true });
      document.head.appendChild(s);
    }

    return () => {
      cancelled = true;
      // Dismiss any showing prompt when the user signs in elsewhere or the app unmounts.
      try { (globalThis as any).google?.accounts?.id?.cancel(); } catch {}
    };
  }, [user]);

  return null; // GIS renders its own UI; nothing to draw here.
}
