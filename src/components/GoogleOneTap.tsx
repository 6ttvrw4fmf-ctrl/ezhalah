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
// ── ROOT CAUSE #2 (measured live 2026-08-28: "it popped up then went away, didn't sign me in") ───
// The BUG 1 fix above (a bounded timer retries once with FedCM off) had its own defect: the timer
// fired unconditionally after FEDCM_FALLBACK_MS, with no way to tell whether the browser's NATIVE
// FedCM bubble was still legitimately showing and awaiting the visitor's click — that UI is drawn by
// the browser chrome itself, entirely outside the page DOM, so the existing "is a prompt already up"
// guard (a DOM query for the legacy iframe) could never see it. Any real visitor slower than the
// timer to notice a small corner bubble had it interrupted: re-initializing GIS for the legacy retry
// superseded the still-outstanding FedCM request — reproduced live via Google's own console warning
// ("initialize() called multiple times... only the last initialized instance will be used") and the
// browser's own "Only one navigator.credentials.get request may be outstanding at one time" error,
// on every run, not a guess. Fixed by observing the REAL underlying navigator.credentials.get() call
// GIS makes internally and gating the fallback on that call's actual settlement (with an empty/falsy
// result or a rejection) rather than elapsed time — a still-visible, still-awaited prompt is never
// interrupted, and a genuine successful resolution is explicitly excluded from ever triggering the
// fallback (racing it in on the success path would just move this exact bug, not fix it). The old
// timer survives only as an absolute ceiling for the case GIS never touches credentials.get at all.
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

      // ── FIX (owner report, 2026-08-28: "it popped up then went away, didn't sign me in") ─────────
      // The OLD fallback fired on a blind timer, unconditionally, after FEDCM_FALLBACK_MS — with no
      // way to know whether the browser's NATIVE FedCM bubble was still legitimately showing and
      // awaiting the visitor's click, because that UI is drawn by the browser chrome itself, outside
      // the page DOM entirely. The `document.querySelector('[id*="credential_picker"]...')` guard can
      // only ever see the LEGACY iframe prompt, never FedCM's — so it protected against nothing in
      // the one case that mattered. Any real visitor slower than 4s to notice a small corner bubble
      // had it killed out from under them: re-initializing GIS for the legacy retry supersedes the
      // still-outstanding FedCM identity request (Google's own console warning — "initialize() called
      // multiple times... only the last initialized instance will be used" — and the browser's own
      // "Only one navigator.credentials.get request may be outstanding at one time" error both
      // reproduced live, every run, confirming this mechanically rather than by guesswork).
      //
      // FIX: observe the REAL underlying navigator.credentials.get() call GIS makes internally under
      // FedCM, and gate the fallback on that call actually SETTLING (resolved — the visitor chose an
      // account — or rejected — nothing to offer / dismissed), never on elapsed time. A still-visible,
      // still-awaited prompt is now never interrupted, because we only act once the real API call
      // Chrome is using has genuinely finished. FEDCM_FALLBACK_MS becomes a ceiling for the case GIS
      // never calls credentials.get() at all (e.g. an unexpected internal short-circuit) — not the
      // everyday trigger — so it can stay generous without making a normal "nothing to offer" case
      // feel slow.
      // Guards the legacy retry from firing more than once, regardless of which trigger path reaches
      // it first (real settlement, or the absolute ceiling below).
      let fallbackStarted = false;
      const fireFallback = (reason: string) => {
        if (cancelled || momentSeen || fallbackStarted) return;
        fallbackStarted = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        diag.fallbackFired = true;
        log(reason, '— retrying without FedCM');
        run(false);
      };

      const nav = navigator as any;
      const realGet: ((...a: unknown[]) => Promise<unknown>) | undefined = nav.credentials?.get?.bind(nav.credentials);
      if (realGet) {
        nav.credentials.get = (...args: unknown[]) => {
          nav.credentials.get = realGet; // one-shot: restore immediately, before the call even settles,
          // so nothing else on the page can ever observe or be affected by the patched version.
          const p = realGet(...args);
          // Settlement is the real, event-driven trigger — not a guess. A quick "nothing to offer"
          // rejection now falls back immediately instead of waiting out the old flat delay, AND a
          // still-visible prompt the visitor hasn't acted on yet is never interrupted, because
          // nothing fires until Chrome itself reports this exact call is actually done.
          //
          // A genuine RESOLUTION with a real credential must NEVER trigger the fallback: this handler
          // is attached to the same promise GIS itself awaits, and attaches BEFORE GIS's own internal
          // handler does (this code runs first, then returns `p` to GIS, which only then chains onto
          // it) — so on success, this fires first. Racing run(false) in right here, ahead of GIS
          // processing the credential through our onFailure callback, would re-initialize the client
          // and would be the EXACT interrupted-mid-flow bug this fix exists to remove, just moved to
          // the success path instead of the pending one. On success we instead DISARM the ceiling
          // timer outright — caught by this file's own barrier test: without this, a fast successful
          // sign-in would still eat a spurious run(false) once the ceiling later elapsed, because
          // nothing else cancels that timer. Only an empty/falsy resolution (no account actually
          // offered) or an outright rejection means there is genuinely nothing left to wait for.
          p.then((cred) => {
            if (cred) { if (fallbackTimer) clearTimeout(fallbackTimer); } // success: disarm the ceiling too, permanently — not just "not now"
            else fireFallback('FedCM resolved with no credential');
          }, () => fireFallback('FedCM request rejected/dismissed'));
          return p;
        };
      }

      run(true);
      // Absolute worst-case ceiling only — covers GIS never touching credentials.get at all (some
      // unforeseen internal short-circuit). The everyday trigger is the real settlement above.
      fallbackTimer = setTimeout(
        () => fireFallback(realGet ? 'hit the absolute fallback ceiling with no FedCM signal' : `no FedCM prompt within ${FEDCM_FALLBACK_MS}ms`),
        realGet ? Math.max(FEDCM_FALLBACK_MS, 12000) : FEDCM_FALLBACK_MS,
      );
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
    // DEPS: signedOut ONLY. `user` must not be here — it is no longer read in this effect, and with a
    // stale/deleted-account token the store flips it mid-flight, which re-runs the effect: the cleanup
    // sets cancelled = true on the in-flight start(), and the re-run bails on startedRef. Net effect,
    // measured live 2026-08-18: GIS loaded and ready, gate passed, and STILL zero prompt attempts.
  }, [signedOut]);

  // The one legitimate cancel: the visitor signed in WHILE the prompt was up, so it is moot.
  //
  // It must be a TRANSITION (no user → user), never "user is truthy at mount". Measured live
  // 2026-08-18: with a stale/deleted-account token the store's `user` is truthy from the very first
  // render (it comes from a LOCAL getSession), so an unconditional cancel fired on every page load —
  // the probe caught it as `dismissed: cancel_called` immediately after a correct prompt. Google
  // counts every cancel() as a USER DISMISSAL, so that silently escalated the 2h→1d→7d→30d cooldown
  // on each load until One Tap stopped appearing at all. That is the reported symptom exactly.
  const hadUserRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const has = !!user;
    const prev = hadUserRef.current;
    hadUserRef.current = has;
    if (prev === null) return;          // first observation = initial state, never a sign-in event
    if (!(has && prev === false)) return;
    try { (globalThis as any).google?.accounts?.id?.cancel(); } catch {}
  }, [user]);

  return null; // GIS renders its own UI.
}
