// Google One Tap (web only) — the official Google prompt in the page corner (owner 2026-08-14).
//
// Google Identity Services renders its own prompt; on consent it hands us an ID token, which Supabase
// exchanges for a real session (signInWithIdToken). The store's onAuthStateChange listener adopts it —
// same end state as "Continue with Google", minus the redirect. We NEVER draw a fake prompt.
//
// ── ROOT CAUSE THIS FILE WAS REWRITTEN FOR (measured live 2026-08-15) ────────────────────────────
// A live probe of production showed GIS loading and FedCM actually starting (requests to
// gsi/fedcm.json + gsi/fedcm/listaccounts), yet our `[GoogleOneTap]` notification log NEVER appeared.
// Reason: with `use_fedcm_for_prompt: true`, Google does NOT invoke the PromptMomentNotification
// callback — those moment APIs are deprecated under FedCM, because the browser (not GIS) owns the UI.
// Two Ezhalah-side bugs followed, both fixed here:
//
//   BUG 1 (why the prompt could stay hidden): the FedCM→legacy fallback lived INSIDE that callback.
//   Under FedCM the callback never fires, so the fallback was UNREACHABLE — when FedCM failed (e.g.
//   "FedCM get() rejects with NetworkError") we silently never retried. Fixed two ways: (a) a browser
//   with no FedCM goes straight to the legacy path; (b) with FedCM, a bounded TIMER retries exactly
//   once with FedCM off. Neither depends on a callback Google will not call.
//
//   BUG 2 (why we were blind): under FedCM we logged nothing. Diagnostics now record the path taken
//   and any suppression reason, and are exposed on `window.__ezOneTap` for live inspection.
//
// Also fixed: the component keyed off the store's `user`, which is null while Supabase restores the
// session — so a SIGNED-IN visitor briefly looked logged out and got One Tap initialized + prompted.
// The logged-out state is now resolved authoritatively via getSession() first.
//
// ── WHAT GOOGLE CONTROLS (we cannot override, and must not pretend to) ───────────────────────────
//   - No Google session in the browser → no prompt. Fresh/incognito profiles almost never show it.
//   - Exponential cooldown after dismissals: 2h → 1d → 7d → 30d.
//   - Opt-out, FedCM availability, browser privacy / third-party-cookie settings.
// Our contract: when the visitor is genuinely logged out we initialize and call prompt() on every page
// load by a path that can actually work, we never burn the cooldown ourselves, and we record the reason.
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store';

const GOOGLE_WEB_CLIENT_ID = '39473044808-06l9dgmb4jsta05h4c5hqdglbsoaqrb5.apps.googleusercontent.com';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
// FedCM resolves well under a second when it works; generous enough not to race a slow network.
const FEDCM_FALLBACK_MS = 4000;
// getUser() must never be able to stall the prompt indefinitely (see the bounded race below).
const GETUSER_TIMEOUT_MS = 2500;

type Diag = {
  fedcmSupported: boolean;
  attempts: Array<{ fedcm: boolean; at: number }>;
  moments: Array<Record<string, unknown>>;
  fallbackFired: boolean;
  signedOut: boolean | null;
  exchangeError?: string;
};

export default function GoogleOneTap() {
  const { user } = useApp();
  // Authoritative logged-out check. The store's `user` is null during session restore, so trusting it
  // alone would prompt signed-in visitors. null = not resolved yet.
  const [signedOut, setSignedOut] = useState<boolean | null>(null);
  const startedRef = useRef(false); // prompt() runs at most once per page load

  useEffect(() => {
    if (Platform.OS !== 'web' || !supabase) return;
    let cancelled = false;
    // getUser() validates the token WITH THE SERVER; getSession() only reads local storage. After an
    // account deletion (or any revoked/invalid token) the stale JWT can still parse locally, so
    // getSession() would report "signed in" and we would never prompt — the exact case the owner
    // raised: a deleted account, or someone who never signed up, must still get the prompt.
    // Any error (no session, deleted user, revoked token, network) means: not signed in → prompt.
    // BOUNDED. With an invalid refresh token (deleted account, revoked session) supabase-js retries
    // the refresh with backoff, so getUser() can take many seconds or never settle — and while it is
    // unresolved we would never prompt, which is strictly worse than the bug it fixes. Measured live
    // 2026-08-18: a stale token produced 0 prompt attempts for this exact reason.
    // On timeout we default to SIGNED OUT, because that is the safe direction: a genuinely signed-in
    // visitor is still protected by the store `user` gate below and by the cancel-on-sign-in effect.
    const decide = (v: boolean) => { if (!cancelled) setSignedOut(v); };
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; decide(true); } }, GETUSER_TIMEOUT_MS);
    supabase.auth.getUser()
      .then(({ data, error }) => { if (!settled) { settled = true; clearTimeout(t); decide(!!error || !data?.user); } })
      .catch(() => { if (!settled) { settled = true; clearTimeout(t); decide(true); } })
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !supabase) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    // Gate on the SERVER-VALIDATED answer only. The store's `user` is derived from its own
    // getSession(), which is local-only — so a stale/deleted-account token makes `user` truthy and
    // would block the prompt here, which is exactly the bug this component keeps hitting (measured
    // live 2026-08-18: the deleted-token case still produced 0 prompt attempts with `|| user` here).
    // It adds nothing that getUser() does not already answer authoritatively, and someone who signs
    // in AFTER we prompt is handled by the cancel-on-sign-in effect below.
    if (signedOut !== true) return;
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let momentSeen = false;

    const fedcmSupported = 'IdentityCredential' in window;
    const diag: Diag = { fedcmSupported, attempts: [], moments: [], fallbackFired: false, signedOut: true };
    (window as any).__ezOneTap = diag;
    const log = (...a: unknown[]) => { try { console.info('[GoogleOneTap]', ...a); } catch {} };

    const run = (useFedCM: boolean) => {
      if (cancelled) return;
      const google = (globalThis as any).google;
      if (!google?.accounts?.id) { log('GIS not available'); return; }
      diag.attempts.push({ fedcm: useFedCM, at: Date.now() });
      log('initialize + prompt', { fedcm: useFedCM, fedcmSupported });
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          callback: async (resp: { credential?: string }) => {
            if (!resp?.credential || !supabase) return;
            // Never swallow this. If Google hands us a credential and the Supabase exchange fails, the
            // visitor sees no prompt AND stays logged out — indistinguishable from "Google suppressed
            // it" unless we say so. Record it in the diagnostics and the console.
            try {
              const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: resp.credential });
              if (error) { diag.exchangeError = String(error.message ?? error); log('token exchange FAILED', error.message ?? error); }
              else log('signed in via One Tap');
            } catch (e) {
              diag.exchangeError = String(e); log('token exchange threw', String(e));
            }
          },
          // auto_select:true silently signs a RETURNING visitor in and NEVER renders the prompt —
          // which is exactly how "it used to appear and then stopped" happens once you've signed in
          // with Google here before. The owner's requirement is to SEE the prompt and click it, so
          // auto-select is off: Google always renders the account chooser. (owner 2026-08-18.)
          auto_select: false,
          use_fedcm_for_prompt: useFedCM,
          // Clicking outside counts as a dismissal to Google and starts the exponential cooldown.
          cancel_on_tap_outside: false,
          itp_support: true,   // Safari ITP
        });
        google.accounts.id.prompt((n: any) => {
          // Fires on the legacy path only — under FedCM Google does not call this.
          momentSeen = true;
          const rec = {
            moment: n?.getMomentType?.(),
            notDisplayed: n?.isNotDisplayed?.() ? (n.getNotDisplayedReason?.() ?? 'yes') : null,
            skipped: n?.isSkippedMoment?.() ? (n.getSkippedReason?.() ?? 'yes') : null,
            dismissed: n?.isDismissedMoment?.() ? (n.getDismissedReason?.() ?? 'yes') : null,
            displayed: n?.isDisplayMoment?.() ? !!n.isDisplayed?.() : null,
          };
          diag.moments.push(rec);
          log('moment', rec);   // THE suppression reason, when Google gives us one
        });
      } catch (e) {
        log('initialize/prompt threw', String(e));
      }
    };

    const start = () => {
      if (cancelled) return;
      // No FedCM in this browser → the legacy path is the only one that can work; spending the single
      // attempt on FedCM there would guarantee no prompt.
      if (!fedcmSupported) { run(false); return; }
      run(true);
      // Bounded single retry. Reaching it does not prove FedCM was rejected — if it simply had no
      // account to offer, the legacy attempt is equally harmless (Google suppresses it the same way).
      fallbackTimer = setTimeout(() => {
        if (cancelled || momentSeen) return;
        if (document.querySelector('[id*="credential_picker"], iframe[src*="gsi/iframe"]')) return;
        diag.fallbackFired = true;
        log('no FedCM prompt within', FEDCM_FALLBACK_MS, 'ms — retrying without FedCM');
        run(false);
      }, FEDCM_FALLBACK_MS);
    };

    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      if ((globalThis as any).google?.accounts?.id) start();
      else existing.addEventListener('load', start, { once: true });
    } else {
      const s = document.createElement('script');
      s.src = GIS_SRC; s.async = true; s.defer = true;
      s.addEventListener('load', start, { once: true });
      s.addEventListener('error', () => log('GIS script failed to load'), { once: true });
      document.head.appendChild(s);
    }

    // NEVER call google.accounts.id.cancel() here. Google treats it as a USER dismissal and starts the
    // exponential cooldown (2h → 1d → 7d → 30d) — that alone can make One Tap "disappear" for days.
    return () => { cancelled = true; if (fallbackTimer) clearTimeout(fallbackTimer); };
  }, [signedOut, user]);

  // The one legitimate cancel: the visitor signed in, so the prompt is moot.
  useEffect(() => {
    if (Platform.OS !== 'web' || !user) return;
    try { (globalThis as any).google?.accounts?.id?.cancel(); } catch {}
  }, [user]);

  return null; // GIS renders its own UI.
}
