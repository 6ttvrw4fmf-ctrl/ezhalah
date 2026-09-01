// Pure truths about device sessions (owner Phase 2, 2026-08-29) — PURE on purpose, zero runtime
// imports, so the barrier (scripts/verify-devices-contract.ts) EXECUTES both functions under
// plain Node. The network seam lives in src/lib/devices.ts; the rules live here.
import type { Browser, DeviceClass } from './deviceInfo';

export type DeviceSession = {
  session_id: string;
  device_class: DeviceClass | null;
  browser: Browser | null;
  created_at: string;
  refreshed_at: string;
};

// «هذا الجهاز» is IDENTITY, not position: decode the payload of the caller's OWN access token and
// return its `session_id` claim (standard in every GoTrue JWT). No signature check — this never
// authorizes anything; the server validates tokens for real. Garbage in → null, never a guess.
export function sessionIdFromJwt(accessToken: string | null | undefined): string | null {
  if (!accessToken) return null;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const text = typeof atob === 'function'
      ? atob(pad)
      : (globalThis as any).Buffer.from(pad, 'base64').toString('utf8');
    const payload = JSON.parse(text);
    return typeof payload?.session_id === 'string' ? payload.session_id : null;
  } catch {
    return null;
  }
}

// ── Honest Arabic last-active buckets ────────────────────────────────────────
// refreshed_at moves on ~hourly token rotation (proven live against production GoTrue,
// 2026-08-29), so no bucket claims more precision than that: the freshest truthful statement
// about ANOTHER device is «نشط خلال الساعة الأخيرة» — «نشط الآن» belongs to the current device
// only, which proves its own liveness by rendering. Arabic number agreement: dual (ساعتين),
// 3–10 plural (٣ ساعات), 11+ singular (١٥ ساعة); digits are Arabic-Indic.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const toArabicDigits = (n: number): string =>
  String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);

function countNoun(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${toArabicDigits(n)} ${few}`;
  return `${toArabicDigits(n)} ${many}`;
}

// isoUtc → a truthful «آخر نشاط …» label, or '' when the timestamp is unusable
// (render nothing rather than guess a lie into the gap).
export function lastActiveLabel(isoUtc: string, nowMs: number): string {
  const t = Date.parse(isoUtc);
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((nowMs - t) / 60_000);
  if (mins < 0) return '';
  if (mins < 75) return 'نشط خلال الساعة الأخيرة';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `آخر نشاط قبل ${countNoun(hours, 'ساعة', 'ساعتين', 'ساعات', 'ساعة')}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `آخر نشاط قبل ${countNoun(days, 'يوم', 'يومين', 'أيام', 'يومًا')}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `آخر نشاط قبل ${countNoun(months, 'شهر', 'شهرين', 'أشهر', 'شهرًا')}`;
  return 'آخر نشاط قبل أكثر من سنة';
}
