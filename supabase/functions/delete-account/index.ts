// ─────────────────────────────────────────────────────────────────────────────
// delete-account — permanently delete the CALLER'S OWN Supabase auth user.
//
// WHY THIS EXISTS (owner report, 2026-08-17): "Delete my account" wiped on-device
// state and signed out, but made no server call at all. The account survived, so
// signing in again with the same phone/Google returned the same user — and the
// About screen's PDPL copy ("your searches and account are kept until you delete
// your account, then permanently removed") was not true.
//
// THE ONE SECURITY RULE HERE: the account deleted is the one the ACCESS TOKEN
// proves, never an id supplied by the caller. The request body is ignored on
// purpose — accepting a user id would turn this into "delete any account you can
// name", which is exactly the shape of an account-takeover primitive. The flow is:
//   1. read the caller's own JWT from the Authorization header,
//   2. ask Supabase who that token belongs to (auth.getUser — validates signature
//      AND expiry server-side; a forged or stale token resolves to nobody),
//   3. delete THAT id with the service-role key.
// There is no path where step 3 receives an id that did not come from step 2.
//
// The service-role key never leaves the function: it is read from the environment
// (set as a Supabase function secret), used for the single admin call, and is
// never returned, logged, or echoed.
//
// Idempotent by design: deleting an already-deleted account returns 200. The
// client treats "gone" as success either way, so a retry after a dropped
// connection can't strand the user in a half-deleted state.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Misconfiguration must never read as "deleted" — the client would tell the
    // user their account is gone while it is very much still there.
    return json({ error: "not_configured" }, 500);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthenticated" }, 401);

  // WHO IS THIS TOKEN? Validated by Supabase, not parsed by us — never trust a
  // client-decoded JWT for an irreversible action.
  const asCaller = createClient(SUPABASE_URL, ANON_KEY || SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await asCaller.auth.getUser();
  const uid = who?.user?.id;
  if (whoErr || !uid) return json({ error: "unauthenticated" }, 401);

  // Delete exactly that id. `uid` came from the validated token above and from
  // nowhere else — in particular, not from the request body, which is unread.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);

  if (delErr) {
    // Already gone (a retry, or a second tab) is a success from the user's side.
    const msg = (delErr.message ?? "").toLowerCase();
    if (msg.includes("not found") || msg.includes("user_not_found")) {
      return json({ deleted: true, already: true });
    }
    return json({ error: "delete_failed" }, 500);
  }

  return json({ deleted: true });
});
