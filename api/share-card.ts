// /s/<payload> → this function (vercel.json rewrite). It answers with the WhatsApp/iMessage/X preview
// card for a shared search — «عقارات من {name} لك على إزهله 🦅» — and sends a person straight to Home
// with ?share=, where the app's card + tap flow takes over (owner 2026-10-17). All logic, wording and
// escaping live in src/lib/shareSearch.ts (shareCardHtml), executed by scripts/verify-share-search-link.ts.
// The origin is the REQUEST'S OWN host, so moving the site to a new domain needs no change here.
import { shareCardHtml } from '../src/lib/shareSearch';

export default function handler(req: { headers: Record<string, string | string[] | undefined>; query?: Record<string, string | string[] | undefined>; url?: string }, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: (body: string) => void }) {
  const h = (k: string) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };
  const host = h('x-forwarded-host') || h('host') || '';
  const proto = (h('x-forwarded-proto') || 'https').split(',')[0].trim();
  const p = req.query?.p;
  const payload = Array.isArray(p) ? p[0] : p;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(shareCardHtml(host ? `${proto}://${host}` : '', payload ?? null));
}
