// ─────────────────────────────────────────────────────────────────────────────
// devices — client seam for «الأجهزة المسجّل عليها الدخول» (owner Phase 2, 2026-08-29).
//
// Truth rules this seam carries (the pure logic lives in deviceSessions.ts so
// the barrier can execute it):
//   • The list is the REAL session registry (auth.sessions) via the `devices`
//     edge function — never a fabricated device, never fingerprinting. The
//     server returns ONLY { session_id, device_class, browser, created_at,
//     refreshed_at }; raw UA/IP never reach this client.
//   • Revocation is only believed when the BACKEND says so: revokeDeviceSession
//     resolves ok:true only on an explicit { revoked: true } — the UI removes a
//     card on that signal alone. `already` marks the clean "already signed out"
//     race (gone server-side between fetch and revoke), still a confirmed state.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase';
import { sessionIdFromJwt, type DeviceSession } from './deviceSessions';

export { lastActiveLabel, sessionIdFromJwt, toArabicDigits, type DeviceSession } from './deviceSessions';

export async function currentSessionId(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return sessionIdFromJwt(data?.session?.access_token);
  } catch {
    return null;
  }
}

// null = the list could not be loaded (the UI keeps showing the locally-derived
// current device — the section never shows less than the truth it already has).
export async function listDeviceSessions(): Promise<DeviceSession[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('devices', { method: 'GET' });
    if (error) return null;
    const arr = (data as { sessions?: unknown } | null)?.sessions;
    return Array.isArray(arr) ? (arr as DeviceSession[]) : null;
  } catch {
    return null;
  }
}

// ok:true ONLY when the backend confirmed the session row is gone (revoked now,
// or already gone). The card the user tapped may be removed on ok:true and on
// nothing else.
export async function revokeDeviceSession(sessionId: string): Promise<{ ok: boolean; already?: boolean }> {
  if (!supabase) return { ok: false };
  try {
    const { data, error } = await supabase.functions.invoke('devices', {
      method: 'DELETE',
      body: { session_id: sessionId },
    });
    if (error) return { ok: false };
    const d = data as { revoked?: boolean; already?: boolean } | null;
    return d?.revoked === true ? { ok: true, already: d.already === true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// GoTrue's own "everyone but me": revokes every OTHER session server-side and
// keeps this one signed in. The caller refetches the list afterwards — the
// refetch, not this boolean alone, is what clears cards.
export async function signOutOtherDevices(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    return !error;
  } catch {
    return false;
  }
}
