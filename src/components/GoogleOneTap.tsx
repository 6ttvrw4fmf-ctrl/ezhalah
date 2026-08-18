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
//
// IMPORTANT — what Google controls vs what we control:
//
// GOOGLE CONTROLS (we cannot override):
//   - Prompt suppressed when user has no Google session in this browser
//   - Exponential cooldown after dismissals: 2h → 1d → 7d → 30d
//   - Prompt suppressed when user previously opted out of One Tap
//   - FedCM availability depends on browser version + Google account state
//   - Third-party cookie policies affect iframe mode
//   - Incognito/private browsing usually prevents One Tap entirely
//
// WE CONTROL:
//   - Loading the GIS script and calling prompt() at the right time
//   - FedCM vs iframe fallback strategy (bug: was forcing FedCM with no fallback)
//   - Not accidentally triggering cooldown via cancel() (bug: cleanup called cancel())
//   - cancel_on_tap_outside: false to prevent accidental cooldown from stray clicks
//   - Calling prompt() exactly once per page load (not on every re-render)
//   - Notification callback to log the exact reason when Google suppresses the prompt
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store';

const GOOGLE_WEB_CLIENT_ID = '39473044808-06l9dgmb4jsta05h4c5hqdglbsoaqrb5.apps.googleusercontent.com';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export default function GoogleOneTap() {
  const { user } = useApp();
  // Guard: prompt() must fire exactly once per page load. Re-calling it after a skip/dismiss burns
  // through Google's cooldown budget and makes the prompt disappear for hours/days.
  const promptedRef = useRef(false);

  // Effect 1: initialize + prompt (logged-out only, once per page load)
  useEffect(() => {
    if (Platform.OS !== 'web' || user || !supabase) return;
    if (typeof document === 'undefined') return;
    if (promptedRef.current) return; // already prompted this page load

    let cancelled = false;

    const doPrompt = (useFedCM: boolean) => {
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
            // has every normal sign-in path via the green CTA / /auth screen.
            await supabase.auth.signInWithIdToken({ provider: 'google', token: resp.credential }).catch(() => {});
          },
          auto_select: true,
          use_fedcm_for_prompt: useFedCM,
          // Prevent accidental cooldown: clicking outside the prompt dismisses it by default, which
          // Google counts as a user dismissal and triggers exponential cooldown. Disable that.
          cancel_on_tap_outside: false,
          // Safari ITP support — uses an intermediate iframe to work around Intelligent Tracking
          // Prevention, which blocks third-party cookies that the non-FedCM approach needs.
          itp_support: true,
        });
        google.accounts.id.prompt((notification: any) => {
          const moment = notification.getMomentType?.();
          // Diagnostic log — the ONLY way to know why Google suppressed the prompt. Check browser
          // console for this when debugging "One Tap isn't showing".
          if (notification.isNotDisplayed?.()) {
            // eslint-disable-next-line no-console
            console.info('[GoogleOneTap] not displayed:', notification.getNotDisplayedReason?.());
          } else if (notification.isSkippedMoment?.()) {
            const reason = notification.getSkippedReason?.();
            // eslint-disable-next-line no-console
            console.info('[GoogleOneTap] skipped:', reason);
            // KEY FIX: if FedCM was attempted and skipped (e.g. FedCM NetworkError, browser doesn't
            // support it, or Google account state prevents it), fall back to the traditional iframe
            // approach. This is the main bug that was preventing One Tap from showing.
            if (useFedCM && !cancelled) {
              doPrompt(false);
              return; // don't mark as prompted yet — the fallback will
            }
          } else if (notification.isDismissedMoment?.()) {
            // eslint-disable-next-line no-console
            console.info('[GoogleOneTap] dismissed:', notification.getDismissedReason?.());
          } else if (notification.isDisplayMoment?.()) {
            // eslint-disable-next-line no-console
            console.info('[GoogleOneTap] displayed:', notification.isDisplayed?.() ? 'visible' : 'not visible');
          }
          // After both FedCM and iframe have been tried (or one succeeded), mark as prompted so we
          // don't re-prompt on re-renders.
          if (moment !== 'skipped' || !useFedCM) {
            promptedRef.current = true;
          }
        });
      } catch {
        // GIS unavailable/misconfigured (e.g. origin not authorized) — prompt simply doesn't show.
      }
    };

    const start = () => {
      if (cancelled) return;
      // Try FedCM first (works in modern Chrome without third-party cookies), fall back to iframe.
      doPrompt(true);
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

    // IMPORTANT: do NOT call google.accounts.id.cancel() here. The previous implementation called
    // cancel() in cleanup, which Google treats as a USER DISMISSAL and triggers exponential cooldown
    // (2h → 1d → 7d → 30d). That was silently preventing One Tap from appearing for returning
    // visitors. Cleanup should only set the cancelled flag to prevent late callbacks.
    return () => { cancelled = true; };
  }, [user]);

  // Effect 2: cancel the prompt ONLY when the user actually signs in. This is the one legitimate
  // time to dismiss — the prompt is no longer needed. Separated from effect 1 so the cleanup of
  // effect 1 (which runs on re-renders) doesn't accidentally trigger Google's cooldown.
  useEffect(() => {
    if (Platform.OS !== 'web' || !user) return;
    try { (globalThis as any).google?.accounts?.id?.cancel(); } catch {}
  }, [user]);

  return null; // GIS renders its own UI; nothing to draw here.
}
