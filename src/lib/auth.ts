import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getLocale } from '@/i18n';
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
export function persistDisplayName(v: string): void {
  if (!supabase) return;
  supabase.auth.updateUser({ data: { full_name: v, name: v } }).catch(() => {});
}

export function mapSupabaseUser(u: any, method: AuthUser['method']): AuthUser {
  const meta = u?.user_metadata ?? {};
  const name: string = meta.full_name || meta.name || u?.email?.split('@')[0] || 'User';
  const sub: string = u?.email || name;
  return { method, name, initials: initialsFrom(name, sub), sub };
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
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, queryParams } });
    if (error) return { error: error.message };
    return { redirected: true };
  } catch (e: any) {
    return { error: e?.message ?? 'Sign-in failed' };
  }
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
 */
export async function signOutBackend(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    /* ignore */
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
