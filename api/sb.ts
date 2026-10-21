// THE FRONT DOOR (security plan Phase 4.3, owner-approved 2026-10-21; docs/ops/SCRAPE_GUARD.md).
//
// /sb/rest/v1/<path> → this function (vercel.json rewrite) → Supabase /rest/v1/<path>. The web app's database reads
// come through here instead of going straight to supabase.co, so that:
//   1. Vercel BotID checks the caller is a real browser. SOFT today (EZ_BOTID_ENFORCE unset): every answer carries
//      x-ezhalah-bot: human | bot | unknown and nobody is refused, until a day of real traffic shows real visitors
//      read as human. Then EZ_BOTID_ENFORCE=1 refuses bots with 403.
//   2. The visitor's real address reaches the database. Cloudflare in front of Supabase sees THIS server, so we forward
//      the address Vercel measured (x-real-ip / x-forwarded-for, set by Vercel, not by the caller) in
//      x-ezhalah-client-ip, vouched for by x-ezhalah-gate = EZ_GATE_SECRET. robot_gate believes it only when the secret
//      matches (guard.front_door_client_ip, 20261021120255); without the secret the headers are not sent.
//   3. Later the back door closes: the public key alone stops working, and only requests carrying the secret pass.
//
// Only database READS/WRITES that the app already makes pass here: the path must be a plain REST path, and only the
// headers PostgREST understands are forwarded. Auth, storage and edge functions stay direct.
import { checkBotId } from 'botid/server';

const UPSTREAM = `${process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co'}/rest/v1/`;
const GATE = process.env.EZ_GATE_SECRET || '';
const ENFORCE = process.env.EZ_BOTID_ENFORCE === '1';

const PASS_REQUEST = ['apikey', 'authorization', 'content-type', 'prefer', 'range', 'range-unit', 'accept',
  'accept-profile', 'content-profile', 'x-client-info'];
const PASS_RESPONSE = ['content-type', 'content-range', 'content-location', 'preference-applied', 'location', 'etag'];

/** The REST path after /sb/rest/v1/: table or rpc/<fn>, nothing that could climb out of /rest/v1/. */
export function safeRestPath(p: string | null): string | null {
  if (p == null || p.length > 200) return null;
  return /^(rpc\/)?[A-Za-z0-9_]+$/.test(p) ? p : null;
}

/** The visitor's address as Vercel measured it (Vercel overwrites these headers; a caller cannot set them). */
export function visitorIp(h: Headers): string {
  const ip = (h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0] || '').trim();
  return /^[0-9A-Fa-f:.]{3,45}$/.test(ip) ? ip : '';
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = safeRestPath(url.searchParams.get('__p'));
  if (!path) return Response.json({ message: 'not found' }, { status: 404 });
  // Vercel also appends the rewrite's named capture as its own query parameter; PostgREST would read it as a filter
  // (measured live 2026-10-21: PGRST100 «failed to parse filter (search_listings_ar)»). Drop both.
  url.searchParams.delete('__p');
  url.searchParams.delete('ezsbpath');

  let bot = 'unknown';
  try { bot = (await checkBotId()).isBot ? 'bot' : 'human'; } catch { /* the check itself failed: unknown, never a block */ }
  if (ENFORCE && bot === 'bot') {
    return Response.json({ message: 'Access denied' }, { status: 403, headers: { 'x-ezhalah-bot': bot } });
  }

  const headers = new Headers();
  for (const k of PASS_REQUEST) { const v = request.headers.get(k); if (v) headers.set(k, v); }
  headers.set('x-client-info', `${headers.get('x-client-info') ?? ''} ezhalah-front-door`.trim());
  const ip = visitorIp(request.headers);
  if (GATE && ip) { headers.set('x-ezhalah-gate', GATE); headers.set('x-ezhalah-client-ip', ip); }

  const method = request.method.toUpperCase();
  const qs = url.searchParams.toString();
  let upstream: Response;
  try {
    upstream = await fetch(`${UPSTREAM}${path}${qs ? `?${qs}` : ''}`, {
      method, headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    // The app retries a failed front door against the database directly (src/lib/supabase.ts) while the back door
    // is still open, so a 502 here costs a visitor one round trip, never a broken search.
    return Response.json({ message: 'upstream unreachable' }, { status: 502, headers: { 'x-ezhalah-bot': bot } });
  }
  const out = new Headers({ 'x-ezhalah-bot': bot, 'cache-control': 'no-store' });
  for (const k of PASS_RESPONSE) { const v = upstream.headers.get(k); if (v) out.set(k, v); }
  return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as HEAD };
