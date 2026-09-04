// ─────────────────────────────────────────────────────────────────────────────
// devices/contract.ts — the PRIVACY CONTRACT of the devices endpoint, as code.
//
// Owner-locked (2026-08-29): the client receives ONLY
//   { session_id, device_class, browser|null, created_at, refreshed_at }
// per session. The raw user_agent and the ip NEVER leave the server — the UA is
// mapped through the SAME truthful detector the account menu uses
// (src/lib/deviceInfo.ts; the copy here is barrier-pinned byte-identical), and
// no model strings exist anywhere in the vocabulary.
//
// PURE on purpose: no Deno globals, no network, no driver — so the barrier
// (scripts/verify-devices-contract.ts) EXECUTES toClientSession() under Node
// against rows that carry user_agent + ip and proves the output shape exactly.
// index.ts is the only consumer at runtime and maps rows ONLY through here.
//
// `refreshed_at` truth (proven live 2026-08-29 against production GoTrue): the
// sessions row's refreshed_at is written on every refresh-token rotation and is
// NULL until the first one — so COALESCE(refreshed_at, created_at) is the last
// server-observed activity (signing in is itself observed activity). Both
// timestamps are UTC; refreshed_at is stored without a zone, so the SQL below
// serializes BOTH to explicit-Z ISO strings — no driver timezone guessing.
// ─────────────────────────────────────────────────────────────────────────────
import { detectDevice, type Browser, type DeviceClass } from './deviceInfo.ts';

export type SessionRow = {
  id: string;
  user_agent: string | null;
  created_at: string; // ISO, already UTC-explicit from LIST_SQL
  refreshed_at: string; // ISO, already coalesced + UTC-explicit from LIST_SQL
};

export type ClientSession = {
  session_id: string;
  device_class: DeviceClass | null;
  browser: Browser | null;
  created_at: string;
  refreshed_at: string;
};

// Live sessions of ONE user — the user_id parameter comes from the caller's own
// validated JWT (auth.getUser in index.ts), never from the request.
export const LIST_SQL = `
  select id::text as id, user_agent,
    to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
    to_char(coalesce(refreshed_at, created_at at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as refreshed_at
  from auth.sessions
  where user_id = $1 and (not_after is null or not_after > now())
  order by 4 desc, 3 desc`;

// Revocation is CALLER-OWNED BY CONSTRUCTION: the row must match BOTH the
// session id and the caller's user_id — a session belonging to anyone else is
// untouchable no matter what id the request names.
export const DELETE_SQL =
  'delete from auth.sessions where id = $1 and user_id = $2 returning id::text as id';

// Only consulted after a 0-row delete, to tell "already signed out" (gone —
// the clean state) apart from "not yours" (explicit refusal).
export const EXISTS_SQL = 'select exists(select 1 from auth.sessions where id = $1) as found';

export function toClientSession(row: SessionRow): ClientSession {
  // Server-side UA→class mapping through the ONE detector. A stored UA cannot
  // carry maxTouchPoints, so an OTHER device that is an iPad in desktop mode
  // truthfully reads Mac here (accepted limit — the CURRENT device self-corrects
  // locally in the client, and per-session hint storage is explicitly out of scope).
  const d = detectDevice({ userAgent: row.user_agent ?? '', platform: '', maxTouchPoints: 0 });
  return {
    session_id: row.id,
    device_class: d.deviceClass,
    browser: d.browser,
    created_at: row.created_at,
    refreshed_at: row.refreshed_at,
  };
}
