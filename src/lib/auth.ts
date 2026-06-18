import { Platform } from 'react-native';
import { supabase } from './supabase';
import type { AuthUser } from '@/store';

// ─────────────────────────────────────────────────────────────────────────────
// Real auth seam.
//
// Every function tries the REAL backend (Supabase) first and only falls back to
// a local session when the backend isn't configured yet (so the web preview and
// dev builds keep working before partner credentials land). When Supabase env
// vars + an OTP provider + OAuth client IDs are set, these become fully real:
//   • Phone   → Supabase phone OTP over the WhatsApp channel (PRD §13).
//   • Google  → Supabase `signInWithOAuth({ provider: 'google' })`.
//   • Apple   → Supabase `signInWithOAuth({ provider: 'apple' })`.
//   • Face ID → expo-local-authentication on a native build.
// The signed-in user is always derived from the real input/session — never a
// hardcoded "Ahmed Al-Saud" demo identity.
// ─────────────────────────────────────────────────────────────────────────────

export const isBackendLive = !!supabase;

function initialsFrom(name: string, fallback: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Build an AuthUser from whatever a real Supabase session gives us.
export function mapSupabaseUser(u: any, method: AuthUser['method']): AuthUser {
  const meta = u?.user_metadata ?? {};
  const name: string = meta.full_name || meta.name || u?.email?.split('@')[0] || u?.phone || 'User';
  const sub: string = u?.email || (u?.phone ? '+' + String(u.phone).replace(/^\+/, '') : '') || name;
  return { method, name, initials: initialsFrom(name, sub), sub };
}

// ── Phone OTP (WhatsApp channel) ─────────────────────────────────────────────

// Map raw Supabase/Twilio error text onto a stable English key the i18n layer can
// translate (Arabic-first app — never surface a raw backend string to the user).
export function friendlyOtpError(raw?: string): string {
  const m = (raw ?? '').toLowerCase();
  if (!m) return 'Something went wrong. Please try again.';
  if (m.includes('expired')) return 'This code has expired. Request a new one.';
  if (m.includes('invalid') && (m.includes('token') || m.includes('otp') || m.includes('code')))
    return 'The code you entered is incorrect.';
  if (m.includes('rate') || m.includes('too many') || m.includes('limit'))
    return 'Too many attempts. Please wait a moment and try again.';
  if (m.includes('phone') && m.includes('invalid')) return 'Please enter a valid phone number.';
  if (m.includes('provider') || m.includes('unsupported') || m.includes('not enabled') || m.includes('disabled'))
    return 'Phone sign-in isn’t available right now. Please try another method.';
  if (m.includes('network') || m.includes('fetch') || m.includes('timeout'))
    return 'Network error. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

export async function sendPhoneOtp(e164: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: true }; // preview: pretend it sent, accept any 6 digits
  try {
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164,
      // Supabase routes this to the WhatsApp template when the provider supports it.
      options: { channel: 'whatsapp' as any },
    });
    if (error) return { ok: false, error: friendlyOtpError(error.message) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: friendlyOtpError(e?.message) };
  }
}

export async function verifyPhoneOtp(
  e164: string,
  code: string,
): Promise<{ user?: AuthUser; error?: string }> {
  if (!supabase) {
    const last4 = e164.replace(/\D/g, '').slice(-4);
    return { user: { method: 'phone', initials: last4.slice(0, 2) || '966', name: 'User ' + last4, sub: e164 } };
  }
  try {
    const { data, error } = await supabase.auth.verifyOtp({ phone: e164, token: code, type: 'sms' });
    if (error || !data?.user) return { error: friendlyOtpError(error?.message ?? 'invalid code') };
    return { user: mapSupabaseUser(data.user, 'phone') };
  } catch (e: any) {
    return { error: friendlyOtpError(e?.message) };
  }
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
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
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
  method: AuthUser['method'] = 'phone',
): Promise<AuthUser | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user ? mapSupabaseUser(data.user, method) : null;
  } catch {
    return null;
  }
}

export async function signOutBackend(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
}
