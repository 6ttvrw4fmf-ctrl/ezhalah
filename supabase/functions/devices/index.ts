// ─────────────────────────────────────────────────────────────────────────────
// devices — the caller's OWN signed-in sessions: list them, revoke one.
//
// WHY THIS EXISTS (owner Phase 2, 2026-08-29): «الأجهزة المسجّل عليها الدخول» in
// إدارة الحساب shows the REAL session registry GoTrue already keeps
// (auth.sessions) — no fake devices, no fingerprinting, no new tables. The auth
// schema is not PostgREST-exposed and supabase-js has no client listSessions,
// so this function is the one bridge, and it enforces two contracts:
//
//   IDENTITY (cloned from delete-account, the repo's security pattern): the
//   sessions listed/revoked belong to the user the ACCESS TOKEN proves — step 1
//   read the caller's JWT, step 2 auth.getUser validates it server-side, step 3
//   query/delete WITH that user_id. The request body is never trusted for
//   identity; a DELETE names a session id, and ownership is enforced in the SQL
//   itself (id AND user_id — see contract.ts DELETE_SQL).
//
//   PRIVACY (owner-locked): the response carries ONLY
//   { session_id, device_class, browser|null, created_at, refreshed_at }.
//   The stored user_agent is collapsed server-side through the same truthful
//   detector the app uses (deviceInfo.ts, byte-pinned to src/lib/deviceInfo.ts)
//   and the raw UA and ip never leave the server — they are not selected into
//   the response, not echoed, and not logged here.
//
// Revocation semantics (honest): deleting the auth.sessions row kills the
// session's refresh IMMEDIATELY (rotation fails), but an already-issued access
// token stays valid until its exp — up to ~1 hour. The UI says so; this
// function must not pretend instant eviction. Deleting an already-gone session
// returns { revoked: true, already: true } (a retry or a race is the clean
// "already signed out" state, not an error); a session that exists but belongs
// to someone else is REFUSED with 403 and touches nothing.
//
// DB access: SUPABASE_DB_URL (injected into every edge function) over the
// postgres driver — auth.sessions has no other sanctioned path. The connection
// is module-scoped and tiny (max 2); statements come ONLY from contract.ts.
// ─────────────────────────────────────────────────────────────────────────────
import postgres from 'npm:postgres@3.4.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DELETE_SQL, EXISTS_SQL, LIST_SQL, toClientSession, type SessionRow } from './contract.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const DB_URL = Deno.env.get('SUPABASE_DB_URL') ?? '';

const sql = DB_URL ? postgres(DB_URL, { max: 2, prepare: false, idle_timeout: 20, connect_timeout: 8 }) : null;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// WHO IS THIS TOKEN? Validated by Supabase, never parsed/trusted locally.
async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await asCaller.auth.getUser();
  return error ? null : data?.user?.id ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'DELETE') return json({ error: 'method_not_allowed' }, 405);
  if (!sql) return json({ error: 'not_configured' }, 500);

  const uid = await callerId(req);
  if (!uid) return json({ error: 'unauthenticated' }, 401);

  try {
    if (req.method === 'GET') {
      const rows = (await sql.unsafe(LIST_SQL, [uid])) as unknown as SessionRow[];
      return json({ sessions: rows.map(toClientSession) });
    }

    // DELETE — revoke ONE session. The id names which; ownership comes from the JWT.
    const body = (await req.json().catch(() => null)) as { session_id?: unknown } | null;
    const sid = typeof body?.session_id === 'string' ? body.session_id.trim() : '';
    if (!UUID_RE.test(sid)) return json({ error: 'bad_session_id' }, 400);

    const deleted = (await sql.unsafe(DELETE_SQL, [sid, uid])) as unknown as Array<{ id: string }>;
    if (deleted.length === 1) return json({ revoked: true });

    // Nothing deleted: either the session is already gone (clean state for the
    // caller) or it exists and is NOT the caller's (refuse, touch nothing).
    const [probe] = (await sql.unsafe(EXISTS_SQL, [sid])) as unknown as Array<{ found: boolean }>;
    if (probe?.found) return json({ error: 'forbidden' }, 403);
    return json({ revoked: true, already: true });
  } catch {
    // No UA/IP (or SQL error text that could embed them) is ever logged or echoed.
    return json({ error: 'devices_failed' }, 500);
  }
});
