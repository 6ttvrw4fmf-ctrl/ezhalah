import { createClient } from '@supabase/supabase-js';
import { dropUnrefreshableStoredSessions } from './authStorageGuard';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

// Must run BEFORE createClient reads storage (Sentry REACT-NATIVE-A/-B; see authStorageGuard.ts).
if (typeof window !== 'undefined') {
  try { dropUnrefreshableStoredSessions(window.localStorage); } catch { /* storage blocked */ }
}

// THE FRONT DOOR (security plan Phase 4.3, 2026-10-21; api/sb.ts, docs/ops/SCRAPE_GUARD.md). On the web, when
// FRONT_DOOR is on, database reads go to /sb/rest/v1/… on our own site instead of straight to supabase.co, so Vercel
// BotID can check for a real browser and the visitor's real address reaches the database. Auth, storage and edge
// functions stay direct. While the back door is still open, a front door that answers 502/503/504 or cannot be
// reached is retried directly, so a front-door problem never becomes a failed search. ON since 2026-10-21 (owner: «do
// it all», after the door, BotID, Turnstile and the handshake were tested live). Kill switch: EXPO_PUBLIC_FRONT_DOOR=0
// in the Vercel env, then a deploy.
export const FRONT_DOOR = process.env.EXPO_PUBLIC_FRONT_DOOR !== '0';
// ONLY on the real site. The door (/sb) and both guards exist only there, and Cloudflare Turnstile answers any other
// host with error 110200 (measured 2026-10-21: CI's local build threw «Uncaught TurnstileError 110200» and its search
// journey failed). Local, CI and preview builds keep talking to the database directly, exactly as before.
// ezhalah.com (owner 2026-10-26: the domain is moving to Vercel): its visitors must use the door too, or the
// back-door lock would refuse them. Turnstile must list it as well (Cloudflare dashboard), else no human pass there.
export const FRONT_DOOR_HOSTS = ['ezhalah-app.vercel.app', 'ezhalah.com', 'www.ezhalah.com'];
// OUR OWN TEST COPIES (2026-10-27, before the back-door lock): every deployment of the project, i.e. the deploy
// robot's canary (ezhalah-<id>-enzalah.vercel.app) and PR previews (ezhalah-app-git-<branch>-enzalah.vercel.app),
// is the same app with the same /sb door. Without this they talk to the database directly and the lock would
// refuse them (the canary gate would then fail every deploy). Only the team «enzalah» can create these hosts.
// Turnstile does not list them: its error-callback keeps the page quiet there (no pass, enforcement is off).
export const FRONT_DOOR_DEPLOYMENT_HOST = /^ezhalah-(?:[a-z0-9]{9}|app-git-[a-z0-9-]+)-enzalah\.vercel\.app$/;
export function frontDoorHost(hostname: string): boolean { return FRONT_DOOR_HOSTS.includes(hostname) || FRONT_DOOR_DEPLOYMENT_HOST.test(hostname); }
const webFront = typeof window !== 'undefined' && typeof window.fetch === 'function' && FRONT_DOOR && !!url
  && frontDoorHost(window.location?.hostname ?? '');

/** supabase.co/rest/v1/<rest> → /sb/rest/v1/<rest>; null for anything that is not a REST call. */
export function frontDoorUrl(target: string, base: string | undefined): string | null {
  if (!base) return null;
  const rest = `${base.replace(/\/+$/, '')}/rest/v1/`;
  return target.startsWith(rest) ? `/sb/rest/v1/${target.slice(rest.length)}` : null;
}

function frontDoorFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // window.fetch is read at CALL time: BotID wraps it after start-up, and the wrapped one must carry our requests.
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const front = frontDoorUrl(target, url);
  if (!front) return window.fetch(input, init);
  // A fallback says WHY in the API logs (x-client-info is one of the few headers Supabase keeps): «fallback=504» for a
  // front door that timed out, «fallback=404» for one that is missing, «fallback=net» when the call never got an answer.
  // Measured 2026-10-22: some iPhone page loads reached the database directly, and the back door cannot close until we
  // know whether that is this fallback or an old saved copy of the app.
  const direct = (why: string) => {
    const headers = new Headers(init?.headers);
    headers.set('x-client-info', `${headers.get('x-client-info') ?? ''} ${fallbackLabel(why)}`.trim());
    return window.fetch(input, { ...init, headers });
  };
  return window.fetch(front, init).then((r) => {
    if (!frontDoorAnswered(r.status, r.headers.has('x-ezhalah-bot'))) return direct(String(r.status));
    // VPN / Tor / server network refused by the network guard (20261021224031): tell the visitor why, once,
    // instead of letting it read as an empty or broken search (components/NetworkBlockedNotice.tsx).
    if (r.status === 403) {
      r.clone().json().then((b) => { if (isNetworkBlocked(r.status, b)) window.dispatchEvent(new Event(NETWORK_BLOCKED_EVENT)); }, () => {});
    }
    return r;
  }, () => direct('net'));
}

/** «ezhalah-fallback=<why>»: the log marker a direct retry carries. */
export function fallbackLabel(why: string): string {
  return `ezhalah-fallback=${/^[a-z0-9]{1,8}$/i.test(why) ? why : 'other'}`;
}

export const NETWORK_BLOCKED_EVENT = 'ezhalah:network-blocked';
/** The network guard's refusal (robot_gate: sqlstate PT403 «This network is not supported»). */
export function isNetworkBlocked(status: number, body: unknown): boolean {
  const b = body as { code?: unknown; message?: unknown } | null;
  return status === 403 && !!b && b.code === 'PT403' && b.message === 'This network is not supported';
}

/** A reply counts only if OUR front door sent it (it always sets x-ezhalah-bot) and it is not a gateway failure.
 *  Anything else (a local/preview build with no /sb route answering 404, a 502/503/504) is retried directly. */
export function frontDoorAnswered(status: number, fromFrontDoor: boolean): boolean {
  return fromFrontDoor && status !== 502 && status !== 503 && status !== 504;
}

if (webFront) {
  try {
    // Lazy so the native app never loads it. Protects every method the data layer uses under /sb/.
    const { initBotId } = require('botid/client/core') as typeof import('botid/client/core');
    initBotId({ protect: ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'].map((method) => ({ path: '/sb/*', method })) });
  } catch { /* the guard failed to start: requests still flow, the server reads them as unknown */ }
  startTurnstile();
}

// CLOUDFLARE TURNSTILE, INVISIBLE (owner 2026-10-21: «users shouldn't have to verify every time»). Once per visit the
// browser solves Cloudflare's invisible check and trades the token at /api/human for a one-hour pass cookie the front
// door reads; it renews itself before the hour runs out. Nothing is ever shown and nothing waits on it: a visitor
// without a pass still searches (soft mode), and the front door only labels the call (x-ezhalah-human).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFfpkJx1Y3UJ9QLd';
function startTurnstile(): void {
  try {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;bottom:0;left:0';
    document.body.appendChild(host);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => {
      const ts = (window as unknown as { turnstile?: { render: (el: HTMLElement, o: object) => string; reset: (id: string) => void } }).turnstile;
      if (!ts) return;
      const id = ts.render(host, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => {
          void window.fetch('/api/human', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => {});
        },
        'refresh-expired': 'auto',
        // A Turnstile failure must never surface as an uncaught page error: no pass, the call is labelled "none".
        'error-callback': () => true,
      });
      // The pass lasts an hour; renew at 50 minutes so a long visit never runs without one.
      setInterval(() => { try { ts.reset(id); } catch { /* renew failed: the next call still flows */ } }, 50 * 60 * 1000);
    };
    document.head.appendChild(s);
  } catch { /* Turnstile failed to start: requests still flow, the front door reads them as "none" */ }
}

// Null when env isn't configured — the data layer falls back to bundled mock data so the app
// (and preview) never hard-fails on a missing backend.
// Real sign-in sessions must survive reloads/redirects (OAuth bounces back to /auth),
// so we persist + auto-refresh when a backend is configured. `detectSessionInUrl` lets
// the web OAuth redirect hand its token back to the client automatically.
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        ...(webFront ? { global: { fetch: frontDoorFetch } } : {}),
      })
    : null;
