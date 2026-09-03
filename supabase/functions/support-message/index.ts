// ─────────────────────────────────────────────────────────────────────────────
// support-message — receive one «تواصل معنا» message from the app and make it durable.
//
// WHY THIS EXISTS (owner request, 2026-09-02): the Support screen showed two address cards and
// nothing more. A user with a problem had to leave Ezhalah, open a mail client, and retype
// support@ezhalah.com by hand. This function is the in-app path.
//
// THE HONEST BOUNDARY. This project has NO email provider. There is no Resend/SendGrid/Postmark
// key, no SMTP host, no send-mail function anywhere in the repo or in this function's environment —
// that was checked before a line of this was written. So the contract here is deliberate and
// narrow: the message is STORED in the project's own Saudi-hosted Postgres, which is a real,
// durable receipt, and email is attempted ONLY if a RESEND_API_KEY secret exists. The row records
// which of the two happened (delivery_status: stored | emailed | email_failed). The response never
// tells the client an email was sent, and the UI copy says «وصلتنا رسالتك» — we received it — which
// is true whether or not the mail leg is configured. The day the owner adds the secret, delivery
// starts on its own with no code change.
//
// SPAM / ABUSE, in layers, cheapest first:
//   1. honeypot — a field no human can see; if it is filled we accept-and-drop (200, nothing
//      stored) so a bot learns nothing from the response.
//   2. shape validation — every field length-bounded before it can reach the database.
//   3. rate limit — at most MAX_PER_HOUR messages per source per hour, counted on a SALTED HASH of
//      the IP. The raw IP is never stored or logged: PDPL says collect the minimum, and the minimum
//      here is "is this the same source as a minute ago", which a hash answers.
//
// The service-role key never leaves the function: it is read from the environment, used for the
// single insert (RLS is ON with no policies, so service-role is the ONLY way in), and is never
// returned, logged, or echoed.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// Absent today. Present the moment the owner adds it — see THE HONEST BOUNDARY above.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPPORT_INBOX = "support@ezhalah.com";
const MAIL_FROM = Deno.env.get("SUPPORT_MAIL_FROM") ?? "Ezhalah <support@ezhalah.com>";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

// Bounds are the SAME numbers the client validator uses. The client's copy is for the keyboard —
// this one is the authority, because anything can POST here.
const SUBJECT_MIN = 3, SUBJECT_MAX = 120;
const BODY_MIN = 10, BODY_MAX = 4000;
const EMAIL_MAX = 254;
const MAX_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

// ponytail: fixed salt, not a secret. The hash exists to BUCKET requests for rate limiting, not to
// resist reversal by whoever already holds the database. Swap in a secret salt only if these rows
// ever have to survive a database read by someone who should not learn the source addresses.
const IP_SALT = "ezhalah-support-v1";

async function hashIp(req: Request): Promise<string | null> {
  const raw = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (!raw) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(IP_SALT + raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// WHO IS THIS TOKEN? Validated by Supabase, never parsed or trusted locally. A support message from
// a signed-out user is legitimate, so this is optional context — never a gate.
async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  // The app sends the publishable/anon key as the bearer when signed out; that is not a user token.
  if (token === ANON_KEY || token.startsWith("sb_publishable_")) return null;
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await asCaller.auth.getUser();
  return error ? null : data?.user?.id ?? null;
}

async function sendEmail(row: { reply_email: string; subject: string; body: string; id: string }): Promise<string | null> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [SUPPORT_INBOX],
      reply_to: row.reply_email,
      subject: `[Ezhalah] ${row.subject}`,
      text: `${row.body}\n\n— from ${row.reply_email} (ticket ${row.id})`,
    }),
  });
  if (r.ok) return null;
  return `resend ${r.status}: ${(await r.text()).slice(0, 300)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "not_configured" }, 500);

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  // 1. Honeypot. A real form never fills this — the input is hidden from humans and unlabelled for
  // screen readers. Answer 200 so a bot cannot tell a drop from a delivery and tune around it.
  if (str(payload.website, 200)) return json({ ok: true, dropped: true });

  // 2. Shape.
  const subject = str(payload.subject, SUBJECT_MAX);
  const body = str(payload.message, BODY_MAX);
  const replyEmail = str(payload.email, EMAIL_MAX).toLowerCase();
  const locale = payload.locale === "en" ? "en" : "ar";
  if (subject.length < SUBJECT_MIN) return json({ error: "subject_too_short" }, 400);
  if (body.length < BODY_MIN) return json({ error: "message_too_short" }, 400);
  if (!EMAIL_RE.test(replyEmail)) return json({ error: "bad_email" }, 400);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. Rate limit. Fails OPEN on a counting error: a database hiccup must not swallow a real user's
  // support request — losing a message is the worse failure here than accepting one extra.
  const ipHash = await hashIp(req);
  if (ipHash) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count, error } = await db
      .from("support_messages")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if (!error && (count ?? 0) >= MAX_PER_HOUR) return json({ error: "rate_limited" }, 429);
  }

  const { data, error } = await db
    .from("support_messages")
    .insert({
      user_id: await callerId(req),
      reply_email: replyEmail,
      subject,
      body,
      locale,
      app_version: str(payload.appVersion, 40) || null,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300) || null,
      ip_hash: ipHash,
    })
    .select("id")
    .single();

  if (error || !data) return json({ error: "store_failed" }, 500);

  // 4. Email, only if the credential exists. A failure here does NOT fail the request: the message
  // is already durable, and telling the user "try again" would duplicate a stored ticket.
  if (RESEND_API_KEY) {
    let err: string | null = null;
    try {
      err = await sendEmail({ id: data.id, reply_email: replyEmail, subject, body });
    } catch (e) {
      err = String(e).slice(0, 300);
    }
    await db
      .from("support_messages")
      .update({ delivery_status: err ? "email_failed" : "emailed", delivery_error: err })
      .eq("id", data.id);
  }

  return json({ ok: true, id: data.id });
});
