// /s/<payload> → this function (vercel.json rewrite). It answers with the WhatsApp/iMessage/X preview
// card for a shared chat or search — «شقق للإيجار في حي النرجس من يوسف على إزهله» — and sends a person
// straight to Home with ?share=, where the app's card + tap flow takes over (owner 2026-10-17). All logic,
// wording and escaping live in src/lib/shareSearch.ts (shareCardHtml), executed by
// scripts/verify-share-search-link.ts. The origin is the REQUEST'S OWN host, so moving the site to a new
// domain needs no change here.
//
// An 8-character code is a SAVED CHAT (public.shared_chat): its card facts come from the anon-readable
// shared_chat_card RPC, bounded at 6 s (owner 2026-10-18: a busy database took 2.8 s and the card fell back to plain «إزهله»). A failed read still answers — the plain Ezhalah card, still
// sending the person to Home + ?share=<code>, where the app reads the chat itself.
import { shareCardHtml, isShareCode, sharedChatCardFrom, type SharedChatCard } from '../src/lib/shareSearch';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

async function chatCard(code: string): Promise<SharedChatCard | null> {
  if (!SUPABASE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/shared_chat_card`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return sharedChatCardFrom(Array.isArray(rows) ? rows[0] : null);
  } catch { return null; }
}

export default async function handler(req: { headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined>; url?: string }, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: (body: string) => void }) {
  const h = (k: string) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };
  const host = h('x-forwarded-host') || h('host') || '';
  const proto = (h('x-forwarded-proto') || 'https').split(',')[0].trim();
  const p = req.query?.p;
  const payload = Array.isArray(p) ? p[0] : p;
  const card = isShareCode(payload) ? await chatCard(payload!) : null;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // A shared chat's card never changes, so a card that loaded is kept at Vercel's edge for a day
  // (s-maxage): WhatsApp's later fetches never wait on the database. A failed read is never cached.
  res.setHeader('Cache-Control', card ? 'public, max-age=300, s-maxage=86400' : !isShareCode(payload) ? 'public, max-age=300' : 'no-store');
  res.end(shareCardHtml(host ? `${proto}://${host}` : '', payload ?? null, card));
}
