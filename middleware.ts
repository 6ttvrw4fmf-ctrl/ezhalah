// Vercel Routing Middleware — runs ONLY for the home page («/», see config.matcher).
//
// One job (owner 2026-10-18): when a LINK-PREVIEW BOT (WhatsApp, iMessage, Telegram, X…) fetches the
// main link, answer with the preview card carrying the LIVE numbers
//   «محرك بحث عقاري بالذكاء الاصطناعي: 149 موقع و385,330 إعلان في 346 مدينة، كلها في مكان واحد.»
// Everyone else — every person, every search engine — falls straight through to the normal static
// page: this function returns nothing for them and touches nothing.
//
// The numbers are read with a hard timeout and kept for 10 minutes in this edge instance, so a burst of
// shares costs the database at most two small reads per instance per 10 minutes. Any failure prints the
// line WITHOUT numbers (src/lib/homeCard.ts) — never a zero, never a guess.
// No '.ts' on this import: Vercel's edge bundler rejects it ("referencing unsupported modules"), which
// failed every production deploy from #7593 on. The verify script rewrites the path to load it under Node.
import { homeCardDescription, homeCardFactsFrom, homeCardHtml, isPreviewBot, type HomeCardFacts } from './src/lib/homeCard';

export const config = { matcher: '/' };

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';
const READ_MS = 4000;
const KEEP_MS = 10 * 60 * 1000;
let kept: { at: number; facts: HomeCardFacts } | null = null;

async function rpc(name: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(READ_MS),
  });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  return r.json();
}

async function liveFacts(): Promise<HomeCardFacts | null> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.facts;
  if (!SUPABASE_KEY) return null;
  try {
    const [platforms, scale] = await Promise.all([rpc('loader_active_platforms_ar'), rpc('loader_scale_stats_ar')]);
    const facts = homeCardFactsFrom(platforms, scale);
    // Only a complete, real set is kept; a partial one is used once (it renders the fallback) and retried next time.
    if (homeCardDescription(facts) !== homeCardDescription(null)) kept = { at: Date.now(), facts };
    return facts;
  } catch { return null; }
}

export default async function middleware(request: Request): Promise<Response | undefined> {
  if (!isPreviewBot(request.headers.get('user-agent'))) return undefined; // people + search engines: untouched
  try {
    const origin = new URL(request.url).origin;
    const html = homeCardHtml(origin, homeCardDescription(await liveFacts()));
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    return undefined; // never break the page over a card: the static page has its own card tags
  }
}
