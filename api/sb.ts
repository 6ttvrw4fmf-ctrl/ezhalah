// THE FRONT DOOR (security plan Phase 4.3, owner-approved 2026-10-21; docs/ops/SCRAPE_GUARD.md).
//
// /sb/rest/v1/<path> → this function (vercel.json rewrite) → Supabase /rest/v1/<path>. The web app's database reads
// come through here instead of going straight to supabase.co, so that:
//   1. Vercel BotID checks the caller is a real browser. SOFT today (EZ_BOTID_ENFORCE unset): every answer carries
//      x-ezhalah-bot: human | bot | unknown and nobody is refused, until a day of real traffic shows real visitors
//      read as human. Then EZ_BOTID_ENFORCE=1 refuses bots with 403.
//   1b. Cloudflare Turnstile (invisible) gave this browser a one-hour human pass (api/human.ts): x-ezhalah-human:
//      pass | none | off. SOFT until EZ_TURNSTILE_ENFORCE=1.
//   2. The visitor's real address reaches the database. Cloudflare in front of Supabase sees THIS server, so we forward
//      the address Vercel measured (x-real-ip / x-forwarded-for, set by Vercel, not by the caller) in
//      x-ezhalah-client-ip, vouched for by x-ezhalah-gate = EZ_GATE_SECRET. robot_gate believes it only when the secret
//      matches (guard.front_door_client_ip, 20261021120255); without the secret the headers are not sent.
//   3. Later the back door closes: the public key alone stops working, and only requests carrying the secret pass.
//
// Only database READS/WRITES that the app already makes pass here: the path must be a plain REST path, and only the
// headers PostgREST understands are forwarded. Auth, storage and edge functions stay direct.
import { checkBotId } from 'botid/server';
import { HUMAN_COOKIE, humanPassValid, readCookie } from './_humanPass';

const UPSTREAM = `${process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://aannarbkwcymrotzwdbo.supabase.co'}/rest/v1/`;
const GATE = process.env.EZ_GATE_SECRET || '';
const ENFORCE = process.env.EZ_BOTID_ENFORCE === '1';
// Cloudflare Turnstile (owner 2026-10-21): the one-hour human pass from api/human.ts. SOFT until EZ_TURNSTILE_ENFORCE=1.
const TURNSTILE_KEY = process.env.TURNSTILE_SECRET_KEY || '';
const TURNSTILE_ENFORCE = process.env.EZ_TURNSTILE_ENFORCE === '1';

const PASS_REQUEST = ['apikey', 'authorization', 'content-type', 'prefer', 'range', 'range-unit', 'accept',
  'accept-profile', 'content-profile', 'x-client-info'];
const PASS_RESPONSE = ['content-type', 'content-range', 'content-location', 'preference-applied', 'location', 'etag'];

/** The REST path after /sb/rest/v1/: table or rpc/<fn>, nothing that could climb out of /rest/v1/. */
export function safeRestPath(p: string | null): string | null {
  if (p == null || p.length > 200) return null;
  return /^(rpc\/)?[A-Za-z0-9_]+$/.test(p) ? p : null;
}

/** «bot=human ts=pass robot=0 dev=iphone cc=SA»: what the two guards and the robot pass said about this call, plus the
 *  coarse device class and country, for the API logs. Never the address or the full user agent. */
export function doorLabels(bot: string, human: string, robot: boolean, ua = '', country = ''): string {
  const cc = /^[A-Z]{2}$/.test(country) ? country : '--';
  return `bot=${bot} ts=${human} robot=${robot ? 1 : 0} dev=${deviceClass(ua)} cc=${cc}`;
}

/** A visitor's scrambled code: the first 16 hex of HMAC-SHA256(secret, address). Not reversible without the secret;
 *  the database computes the same value (extensions.hmac) to honour a block. '' without an address or a secret. */
export async function visitorCode(ip: string, secret: string): Promise<string> {
  if (!ip || !secret) return '';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return Array.from(sig.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** headless (an automated browser), iphone, android, desktop, or other. */
export function deviceClass(ua: string): string {
  if (/HeadlessChrome|Headless|PhantomJS|puppeteer|playwright|bot\b|crawler|spider/i.test(ua)) return 'headless';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iphone';
  if (/Android/.test(ua)) return 'android';
  if (/Windows NT|Macintosh|X11|Linux x86_64|CrOS/.test(ua)) return 'desktop';
  return 'other';
}

/** True only when the caller presented the gate secret itself (our own browser robots). Never true without a secret. */
export function robotPass(presented: string | null, gate: string): boolean {
  if (!gate || !presented || presented.length !== gate.length) return false;
  let diff = 0;
  for (let i = 0; i < gate.length; i++) diff |= gate.charCodeAt(i) ^ presented.charCodeAt(i);
  return diff === 0;
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
  const human = !TURNSTILE_KEY ? 'off'
    : (await humanPassValid(readCookie(request.headers.get('cookie'), HUMAN_COOKIE), Date.now() / 1000, TURNSTILE_KEY)) ? 'pass' : 'none';
  // Our own robots (scripts/lib/robotPass.mjs) carry the gate secret: never refused by BotID or Turnstile.
  const robot = robotPass(request.headers.get('x-ezhalah-robot'), GATE);
  if (!robot && ((ENFORCE && bot === 'bot') || (TURNSTILE_ENFORCE && human === 'none'))) {
    return Response.json({ message: 'Access denied' }, { status: 403, headers: { 'x-ezhalah-bot': bot, 'x-ezhalah-human': human } });
  }

  const headers = new Headers();
  for (const k of PASS_REQUEST) { const v = request.headers.get(k); if (v) headers.set(k, v); }
  // The labels ride in x-client-info because it is one of the few request headers Supabase keeps in its API logs: they
  // are how we MEASURE what share of real traffic BotID and Turnstile pass before either is allowed to refuse anyone.
  // PER-VISITOR COUNT (2026-10-27): «vid=<code>» lets the hourly scrape alarm count EACH visitor behind the door (before,
  // every visitor was summed under Vercel's few addresses — a stated gap). The code is scrambled with the secret, never
  // the address; robot_gate recomputes it to honour a block (guard.visitor_is_blocked).
  const ip = visitorIp(request.headers);
  const vid = await visitorCode(ip, GATE);
  headers.set('x-client-info', `${headers.get('x-client-info') ?? ''} ezhalah-front-door ${doorLabels(bot, human, robot, request.headers.get('user-agent') ?? '', request.headers.get('x-vercel-ip-country') ?? '')}${vid ? ` vid=${vid}` : ''}`.trim());
  if (GATE && ip) { headers.set('x-ezhalah-gate', GATE); headers.set('x-ezhalah-client-ip', ip); }
  // ROBOT PASS (20261021224031): our own browser robots run from server networks (GitHub, Google Cloud) that the network
  // guard refuses. They send x-ezhalah-robot = the gate secret; only then does the database hear «robot: 1» (vouched
  // by the same handshake). A caller's own x-ezhalah-robot is never forwarded as-is.
  if (robot) headers.set('x-ezhalah-robot', '1');

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
    return Response.json({ message: 'upstream unreachable' }, { status: 502, headers: { 'x-ezhalah-bot': bot, 'x-ezhalah-human': human } });
  }
  const out = new Headers({ 'x-ezhalah-bot': bot, 'x-ezhalah-human': human, 'cache-control': 'no-store' });
  for (const k of PASS_RESPONSE) { const v = upstream.headers.get(k); if (v) out.set(k, v); }
  return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as HEAD };
