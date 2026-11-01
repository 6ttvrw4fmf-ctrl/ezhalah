// THE SECRET HANDSHAKE FOR OUR OWN ROBOT SCRIPTS (security plan Phase 4.5, owner 2026-10-21; docs/ops/SCRAPE_GUARD.md).
//
// The back door (the database answering the public key directly) is closing: only callers carrying the secret handshake
// (x-ezhalah-gate = EZ_GATE_SECRET) will be served. Real visitors get it from the front door (api/sb.ts). Our own
// robot scripts read the database directly, so this side-effect module wraps the process's fetch: when the job
// provides EZ_GATE_SECRET, every request to OUR project's /rest/v1/ carries the handshake and the log marker
// «ezhalah-gate» (so the API logs show which callers already have it). Nothing else is touched, and without the secret
// this module does nothing at all. Imported by scripts/lib/public-supabase.ts, so every script using that helper has
// it; a script that talks to the database another way imports this file itself (scripts/verify-gate-handshake.ts
// finds the ones that do not).

export const GATE_HOST = 'aannarbkwcymrotzwdbo.supabase.co';

/** The extra headers for one request, or null when it is not a call to our database's REST API. */
export function gateHeaders(url, secret) {
  if (!secret) return null;
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (u.hostname !== GATE_HOST || !u.pathname.startsWith('/rest/v1/')) return null;
  return { 'x-ezhalah-gate': secret };
}

const SECRET = process.env.EZ_GATE_SECRET || '';
const g = globalThis;
if (SECRET && typeof g.fetch === 'function' && !g.fetch.__ezGate) {
  const original = g.fetch;
  const wrapped = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const extra = gateHeaders(url, SECRET);
    if (!extra) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    headers.set('x-client-info', `${headers.get('x-client-info') ?? ''} ezhalah-gate`.trim());
    return original(input, { ...init, headers });
  };
  wrapped.__ezGate = true;
  g.fetch = wrapped;
}
