// THE HUMAN PASS (security plan Phase 4, Cloudflare Turnstile, owner 2026-10-21; docs/ops/SCRAPE_GUARD.md).
// A browser that passes Cloudflare's invisible check once (api/human.ts) gets a cookie good for one hour; the front
// door (api/sb.ts) reads it on every call. The cookie is "<expiry seconds>.<HMAC-SHA256 of the expiry>", signed with
// the Turnstile secret, so only our server can mint one. Web Crypto only (runs anywhere); verify-front-door.ts
// executes these.

export const HUMAN_COOKIE = 'ez_human';
export const HUMAN_PASS_SECONDS = 3600;

const enc = new TextEncoder();
const hmacKey = (key: string, use: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

export async function mintHumanPass(nowSec: number, key: string): Promise<string> {
  const exp = String(Math.floor(nowSec) + HUMAN_PASS_SECONDS);
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), enc.encode(`ez_human:${exp}`));
  return `${exp}.${hex(sig)}`;
}

export async function humanPassValid(value: string | null | undefined, nowSec: number, key: string): Promise<boolean> {
  if (!value || !key) return false;
  const m = /^(\d{9,11})\.([0-9a-f]{64})$/.exec(value);
  if (!m || Number(m[1]) <= nowSec || Number(m[1]) > nowSec + HUMAN_PASS_SECONDS + 60) return false;
  const sig = new Uint8Array(m[2].match(/../g)!.map((h) => parseInt(h, 16)));
  // subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), sig, enc.encode(`ez_human:${m[1]}`));
}

export function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
