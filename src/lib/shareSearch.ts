// SHARE A SEARCH (owner 2026-10-17). A signed-in user's «مشاركة» under a result sends THAT search,
// not the bare homepage: whoever opens the link sees «عقارات من {name} لك على إزهله», taps «اضغط وشوف
// العقارات», and lands on the same results — saved to their own list, because it runs through the
// Filter's ordinary search path. A guest's Share is unchanged (the homepage link).
//
// The owner-approved wording (option C, gender-neutral) never says "sign in" — the sign-in screen
// simply appears after the tap for a visitor who isn't signed in.
//
// THE LINK LANDS ON HOME, NEVER ON /agent. A pasted link must not execute a search (the appSession
// gate, owner 2026-08-16 — see src/lib/appSession.ts and src/app/agent.tsx). So the link is
// `/?share=<payload>`: Home shows the card, and the user's TAP is what runs the search.
//
// Pure: no React, no storage, no network. Executed by scripts/verify-share-search-link.ts.
import type { SearchQuery } from '@/data/search';

export const SHARE_PARAM = 'share';
export const SHARE_PAYLOAD_VERSION = 1;

/** The approved lines (owner 2026-10-17, option C). {name} is the sender's first name. */
export const SHARE_COPY = {
  ar: {
    message: 'عقارات من {name} لك على إزهله 🦅 اضغط الرابط وشوف 👇',
    title: 'عقارات من {name} لك على إزهله',
    button: 'اضغط وشوف العقارات',
  },
  en: {
    message: 'Properties from {name}, just for you on Ezhalah 🦅 Tap to see 👇',
    title: 'Properties from {name}, just for you on Ezhalah',
    button: 'Tap to see the properties',
  },
} as const;

const firstName = (name: string): string => (name ?? '').trim().split(/\s+/)[0] ?? '';
const fill = (tpl: string, name: string) => tpl.replace('{name}', name);

/** The text sent next to the link, or null when there is no name to say it with. */
export function shareMessage(name: string, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  return n ? fill(SHARE_COPY[locale].message, n) : null;
}
export function shareLandingTitle(name: string, locale: 'ar' | 'en'): string | null {
  const n = firstName(name);
  return n ? fill(SHARE_COPY[locale].title, n) : null;
}

// UTF-8 safe base64url (Arabic names and place names survive the round trip; no '+', '/', '=').
function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

/** Packs the search and the sender's first name into the link payload. */
export function encodeSharePayload(q: SearchQuery, senderName: string): string | null {
  const n = firstName(senderName);
  if (!n || !q || typeof q.location !== 'string') return null;
  return toB64Url(JSON.stringify({ v: SHARE_PAYLOAD_VERSION, n, q }));
}

/** Unpacks a payload; anything malformed, foreign or from another version is null (never a guess). */
export function decodeSharePayload(raw: string | null | undefined): { q: SearchQuery; name: string } | null {
  if (!raw || raw.length > 8000) return null;
  const json = fromB64Url(raw);
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    if (!p || p.v !== SHARE_PAYLOAD_VERSION) return null;
    const name = firstName(String(p.n ?? ''));
    const q = p.q;
    if (!name || !q || typeof q !== 'object' || typeof q.location !== 'string') return null;
    if (q.deal !== 'Rent' && q.deal !== 'Buy') return null; // the only two Deal values (data/taxonomy.ts)
    return { q: q as SearchQuery, name };
  } catch { return null; }
}

/** The link itself: always Home with the share param (a pasted link never runs a search by itself). */
export function shareLink(origin: string, payload: string): string {
  return `${origin.replace(/\/+$/, '')}/?${SHARE_PARAM}=${payload}`;
}
