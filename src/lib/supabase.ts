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
// reached is retried directly, so a front-door problem never becomes a failed search. OFF by default.
export const FRONT_DOOR = process.env.EXPO_PUBLIC_FRONT_DOOR === '1';
const webFront = typeof window !== 'undefined' && typeof window.fetch === 'function' && FRONT_DOOR && !!url;

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
  const direct = () => window.fetch(input, init);
  return window.fetch(front, init).then((r) => (r.status === 502 || r.status === 503 || r.status === 504 ? direct() : r), direct);
}

if (webFront) {
  try {
    // Lazy so the native app never loads it. Protects every method the data layer uses under /sb/.
    const { initBotId } = require('botid/client/core') as typeof import('botid/client/core');
    initBotId({ protect: ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD'].map((method) => ({ path: '/sb/*', method })) });
  } catch { /* the guard failed to start: requests still flow, the server reads them as unknown */ }
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
