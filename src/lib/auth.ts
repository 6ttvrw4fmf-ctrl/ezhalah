import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getLocale, rememberLocaleForSignIn } from '@/i18n';
import type { AuthUser } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// Real auth seam.
//
// Every function tries the REAL backend (Supabase) first and only falls back to
// a local session when the backend isn't configured yet (so the web preview and
// dev builds keep working before partner credentials land). When Supabase env
// vars + an OTP provider + OAuth client IDs are set, these become fully real:
//   • Google  → Supabase `signInWithOAuth({ provider: 'google' })`.
//   • Apple   → Supabase `signInWithOAuth({ provider: 'apple' })`.
//   • Face ID → expo-local-authentication on a native build.
// The signed-in user is always derived from the real input/session — never a
// hardcoded "Ahmed Al-Saud" demo identity.
//
// NO PHONE SIGN-IN (owner ruling 2026-09-01: "we will just do Google and Apple, that's it"). The
// WhatsApp-OTP path was removed in full — client, account menu, i18n, country list — and
// scripts/verify-no-phone-auth.ts fails the build if any of it returns. Zero users had ever
// signed in by phone (auth.identities: google 5, email 2, phone 0), so nothing was stranded.
// ─────────────────────────────────────────────────────────────────────────────

export const isBackendLive = !!supabase;

function initialsFrom(name: string, fallback: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Build an AuthUser from whatever a real Supabase session gives us.
// Persist a renamed display name to the auth backend so it SURVIVES a refresh — mapSupabaseUser
// below rebuilds the user from user_metadata on every load, so a rename that only patches the
// in-memory store dies with the tab (pre-existing gap, owner-ordered fix 2026-08-29). Both
// full_name and name are written because mapSupabaseUser reads them in that order. Fire-and-forget:
// the local rename must never be blocked by a slow/failed network write.
// THE SAME STALE-CONTINUATION CLASS, ON THE PERSISTENCE AXIS (routine #8, 2026-09-24). Fixing only
// the in-memory write would have DISPLACED the symptom rather than removed it: two renames in quick
// succession used to put two independent `updateUser` requests in flight, and nothing orders their
// ARRIVAL at the server. The older value could be written last, so user_metadata held a name the
// user had already replaced and `mapSupabaseUser` rebuilt it on the next load — the name reverting
// on a refresh, with no user action, after the screen had shown the new one.
//
// Serialised, so the last value CALLED is the last value WRITTEN: each write waits for the previous
// one to settle, and a value already superseded before its turn is skipped rather than written and
// immediately overwritten. Still fire-and-forget — the local rename is never blocked on the network.
//
// AND BOUNDED, because serialising introduced a hazard the independent writes did not have: one
// request that never settles would hold the queue forever and every later rename would be dropped
// in silence — a worse failure than the race this queue exists to fix. The wait is capped (the same
// 15s bound src/lib/chatSync.ts uses for its reads); the cap releases the QUEUE, it does not cancel
// the request, so the worst case degrades to the old unordered behaviour instead of a dead queue.
let nameWriteQueue: Promise<unknown> = Promise.resolve();
let latestIntendedName: string | null = null;
const NAME_WRITE_TIMEOUT_MS = 15000;

export function persistDisplayName(v: string): void {
  if (!supabase) return;
  latestIntendedName = v;
  nameWriteQueue = nameWriteQueue
    .then(() => {
      if (latestIntendedName !== v) return;   // superseded before it got its turn
      return Promise.race([
        supabase!.auth.updateUser({ data: { full_name: v, name: v } }),
        new Promise((r) => setTimeout(r, NAME_WRITE_TIMEOUT_MS)),
      ]);
    })
    .catch(() => {});
}

// BOTH SPELLINGS ARE STORED (owner P1 2026-10-24: an English refresh showed «يوسف, the market…» and the
// name blinked). nameAr/nameEn used to live in memory only, so every page load (and every auth re-map)
// started with the typed script alone until translit answered. Now the synced spellings are written to
// user_metadata with the name they belong to (name_spellings_for), on every save AND on the backfill, on
// the SAME serialized queue as the name — a spelling for a name the user already replaced is skipped.
export function persistNameSpellings(s: { name: string; nameAr?: string; nameEn?: string }): void {
  if (!supabase || !s?.name || !(s.nameAr || s.nameEn)) return;
  nameWriteQueue = nameWriteQueue
    .then(() => {
      if (latestIntendedName !== null && latestIntendedName !== s.name) return; // superseded by a newer name
      const data: Record<string, string> = { name_spellings_for: s.name };
      if (s.nameAr) data.nameAr = s.nameAr;
      if (s.nameEn) data.nameEn = s.nameEn;
      return Promise.race([
        supabase!.auth.updateUser({ data }),
        new Promise((r) => setTimeout(r, NAME_WRITE_TIMEOUT_MS)),
      ]);
    })
    .catch(() => {});
}

// «وش نناديك؟» was answered or put off — written ONCE to user_metadata so the prompt follows the
// account to every device (owner 2026-10-23). On the same queue as the name write, so a Save's two
// writes reach the server in the order they were called and neither response can overwrite the other.
export function markNamePromptSeen(): void {
  if (!supabase) return;
  nameWriteQueue = nameWriteQueue
    .then(() => Promise.race([
      supabase!.auth.updateUser({ data: { name_prompt_seen: true } }),
      new Promise((r) => setTimeout(r, NAME_WRITE_TIMEOUT_MS)),
    ]))
    .catch(() => {});
}

export function mapSupabaseUser(u: any, method: AuthUser['method']): AuthUser {
  const meta = u?.user_metadata ?? {};
  // The name is only ever what the provider SENT (owner 2026-10-23). Apple sends it on the FIRST
  // authorization only, so a later sign-up has none. The old fallback, the email's local part, turned an
  // Apple private-relay address («66s7zmj7t9@privaterelay.appleid.com») into a "name" that the
  // translit backfill then rendered as Arabic gibberish («سدسزمجتت»). No name → '' → the UI shows
  // «أضف اسمك» and the user types it. scripts/verify-display-name-never-from-email.ts pins this.
  const name: string = String(meta.full_name || meta.name || '').trim();
  const sub: string = u?.email || name;
  // The stored spellings count only for the name they were made for (a rename makes them stale).
  const spelled = !!name && String(meta.name_spellings_for ?? '') === name;
  const nameAr = spelled && typeof meta.nameAr === 'string' && meta.nameAr.trim() ? meta.nameAr.trim() : undefined;
  const nameEn = spelled && typeof meta.nameEn === 'string' && meta.nameEn.trim() ? meta.nameEn.trim() : undefined;
  return { method, name, ...(nameAr ? { nameAr } : {}), ...(nameEn ? { nameEn } : {}), initials: initialsFrom(name, sub), sub, namePromptSeen: meta.name_prompt_seen === true, createdAt: u?.created_at, lastSignInAt: u?.last_sign_in_at };
}

// ── OAuth (Google / Apple) ───────────────────────────────────────────────────

// Returns a real AuthUser if a session already resolved synchronously, otherwise
// `redirected: true` (the browser/native flow has taken over and the session is
// applied via onAuthStateChange in the store). Falls back to null when no backend.
export async function signInWithProvider(
  provider: 'google' | 'apple',
): Promise<{ user?: AuthUser; redirected?: boolean; error?: string }> {
  if (!supabase) return {}; // preview: caller keeps the design-only chooser
  try {
    const redirectTo = Platform.OS === 'web' ? window.location.origin + '/auth' : undefined;
    // Arabic-first (owner): Google's own consent screen defaults to the visitor's Google-account
    // locale, then browser locale — neither is Ezhalah's own language choice. `hl` is Google's
    // documented lever for the SCREEN's language, same mechanism GoogleOneTap.tsx uses for the
    // One Tap prompt, so both Google entry points speak Ezhalah's current language consistently.
    // Apple has no equivalent knob here, so it's a no-op for that provider.
    const queryParams = provider === 'google' ? { hl: getLocale() } : undefined;
    // The redirect is a fresh page load: carry the language on screen to the /auth landing (i18n.tsx).
    rememberLocaleForSignIn();
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, queryParams } });
    if (error) return { error: error.message };
    return { redirected: true };
  } catch (e: any) {
    return { error: e?.message ?? 'Sign-in failed' };
  }
}

// ── Sign in with Apple JS (web, popup) ───────────────────────────────────────
// Apple sends the user's name ONLY on the first authorization, and only to the page that asked —
// the Supabase redirect (signInWithProvider above) never passes it on, so every Apple sign-up landed
// nameless (2026-10-23: raw_user_meta_data had iss/sub/email only). Apple's own JS in popup mode
// hands the name to THIS page, and the id_token goes to Supabase via signInWithIdToken.
//
// Behind a build-time flag (EXPO_PUBLIC_APPLE_JS_SIGNIN=1), default OFF: Apple refuses the popup
// until the Services ID com.ezhalah.web lists this domain + Return URL. Flag off → AuthModal never
// reaches this code and Apple sign-in is today's redirect, byte for byte.
// Any failure (script blocked, popup blocked, Apple config error, token refused) → { fallback } →
// the caller runs the redirect. Closing Apple's window is the user's choice → { cancelled }.
export const APPLE_JS_SIGNIN = process.env.EXPO_PUBLIC_APPLE_JS_SIGNIN === '1';
const APPLE_JS_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
const APPLE_SERVICES_ID = 'com.ezhalah.web';
// The ONE Return URL registered with Apple for the popup. Any other origin (previews, localhost)
// takes the redirect — Apple would refuse it there anyway.
const APPLE_JS_ORIGIN = 'https://ezhalah-app.vercel.app';

/** «First Last» from Apple's `user.name`, or '' — never invented, never the email. */
export function appleFullName(n: { firstName?: string; lastName?: string } | null | undefined): string {
  return [n?.firstName, n?.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
}

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b as ArrayBuffer), (x) => x.toString(16).padStart(2, '0')).join('');

let appleJsReady: Promise<{ rawNonce: string; state: string } | null> | null = null;

/** Load Apple's script and init it with a fresh nonce + state, ahead of the click: the popup must
 *  open inside the user's tap, so nothing slow may run between the tap and `AppleID.auth.signIn()`. */
export function prepareAppleJs(): Promise<{ rawNonce: string; state: string } | null> {
  if (appleJsReady) return appleJsReady;
  appleJsReady = (async () => {
    if (Platform.OS !== 'web' || window.location.origin !== APPLE_JS_ORIGIN) return null;
    const w = window as any;
    if (!w.AppleID?.auth) {
      await new Promise<void>((resolve) => {
        const el = document.createElement('script');
        el.src = APPLE_JS_SRC;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => resolve();
        setTimeout(resolve, 8000);
        document.head.appendChild(el);
      });
    }
    if (!w.AppleID?.auth) return null;
    const rawNonce = hex(crypto.getRandomValues(new Uint8Array(32)));
    const state = hex(crypto.getRandomValues(new Uint8Array(16)));
    const nonce = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawNonce)));
    w.AppleID.auth.init({ clientId: APPLE_SERVICES_ID, scope: 'name email', redirectURI: APPLE_JS_ORIGIN + '/auth', state, nonce, usePopup: true });
    return { rawNonce, state };
  })().catch(() => null);
  return appleJsReady;
}

export async function signInWithAppleJs(): Promise<{ signedIn?: true; name?: string; cancelled?: true; fallback?: true }> {
  if (!supabase) return { fallback: true };
  const prep = await prepareAppleJs();
  appleJsReady = null; // one nonce per attempt
  if (!prep) return { fallback: true };
  let res: any;
  try {
    res = await (window as any).AppleID.auth.signIn();
  } catch (e: any) {
    void prepareAppleJs();
    const err = String(e?.error ?? '');
    return err === 'popup_closed_by_user' || err === 'user_cancelled_authorize' ? { cancelled: true } : { fallback: true };
  }
  void prepareAppleJs();
  const token = res?.authorization?.id_token;
  if (!token || res?.authorization?.state !== prep.state) return { fallback: true };
  try {
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce: prep.rawNonce });
    if (error) return { fallback: true };
  } catch {
    return { fallback: true };
  }
  return { signedIn: true, name: appleFullName(res?.user?.name) };
}

// ── Face ID / biometric (native only) ────────────────────────────────────────

export async function authenticateWithFaceId(): Promise<{ ok: boolean; error?: string }> {
  if (Platform.OS === 'web') return { ok: true }; // no biometric in the browser preview
  try {
    // Lazily required so the web bundle/typecheck never depends on the native module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LocalAuth = require('expo-local-authentication');
    const hasHardware = await LocalAuth.hasHardwareAsync();
    const enrolled = await LocalAuth.isEnrolledAsync();
    if (!hasHardware || !enrolled) return { ok: true }; // nothing to verify against
    const res = await LocalAuth.authenticateAsync({ promptMessage: 'Ezhalah' });
    return res?.success ? { ok: true } : { ok: false, error: 'Not verified' };
  } catch {
    return { ok: true }; // module absent in this build — don't block the flow
  }
}

// ── Session helpers ──────────────────────────────────────────────────────────

export async function getCurrentUser(
  method: AuthUser['method'] = 'google',
): Promise<AuthUser | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user ? mapSupabaseUser(data.user, method) : null;
  } catch {
    return null;
  }
}

/**
 * Sign out THIS device only — never the user's other devices.
 *
 * `scope: 'local'` is load-bearing and must not be dropped. supabase-js defaults `signOut()` to
 * `scope: 'global'`, which revokes EVERY session the user has; its own JSDoc carries a "**Warning:**
 * the default `scope` is `'global'`". Measured against production GoTrue 2026-08-30 with two real
 * sessions: a plain `signOut()` on the Mac made the untouched iPhone's refresh token return
 * `refresh_token_not_found` — i.e. logging out of one browser silently signed the user out
 * everywhere. That is not what any mainstream app does (Google/Apple/Instagram all leave your other
 * devices signed in), and here it also contradicted the «الأجهزة المسجّل عليها الدخول» UI directly:
 * that list offers per-device revoke AND a separate «تسجيل الخروج من جميع الأجهزة الأخرى», so the
 * plain sign-out quietly doing the "all devices" thing made both controls meaningless.
 *
 * The two deliberate multi-session paths stay explicit and are unaffected: `scope: 'others'`
 * (devices.ts → signOutOtherDevices) and the per-session DELETE in the `devices` edge function.
 *
 * Returns whether the session on THIS device actually ended, so the UI can tell the truth instead of
 * reporting success on a failed logout. This is not defensive plumbing: when the logout request
 * fails for any reason other than an already-dead token (supabase-js forgives 401/403/404 and clears
 * anyway), gotrue-js returns `{ error }` and LEAVES THE SESSION IN STORAGE — still valid, still
 * auto-refreshing. The previous body returned void and swallowed that error, so the app dropped to
 * the guest UI while the `sb-*` token sat untouched in localStorage and the next reload signed the
 * user straight back in (ops_incident hunt-2026-09-04:auth:03). No backend configured (preview) is
 * `true`: there is no stored session to end.
 */
export async function signOutBackend(): Promise<boolean> {
  if (!supabase) return true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Permanently delete the signed-in user's own account on the SERVER, then sign out.
 *
 * Before 2026-08-17 "Delete my account" only cleared on-device state, so the account survived and
 * signing in again restored it — and the About screen promised PDPL removal that never happened.
 * The `delete-account` edge function deletes the auth user identified by the caller's own access
 * token (never an id sent from here — see that function's header).
 *
 * Returns whether the server actually deleted the account, so the UI can tell the truth instead of
 * reporting success on a failed delete. Signs out ONLY after a confirmed delete: if the call failed
 * the account still exists, and silently signing the user out would look like it had worked.
 */
export async function deleteAccountBackend(): Promise<boolean> {
  if (!supabase) return false;
  let deleted = false;
  try {
    const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
    deleted = !error && !!(data as { deleted?: boolean } | null)?.deleted;
  } catch {
    deleted = false;
  }
  if (!deleted) return false;
  try {
    // 'local' for the same reason as signOutBackend, and doubly so here: the account row is already
    // deleted, so every one of its sessions is gone server-side and there is nothing left to revoke
    // — all this call still has to do is clear the tokens held on THIS device.
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    /* the account is already gone; the store clears local state regardless */
  }
  return true;
}
