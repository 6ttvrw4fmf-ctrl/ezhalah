-- support_messages — the durable receipt for «تواصل معنا» (owner request, 2026-09-02).
--
-- Before this, the Support screen showed two mailto-style address cards and nothing else: a user
-- with a problem had to leave the app, open a mail client and type the address by hand. The owner
-- asked for an in-app form that reaches support@ezhalah.com.
--
-- WHAT THIS TABLE IS. The message itself, stored inside the project's own Postgres — which lives in
-- Supabase region ap-northeast-1 (Tokyo), NOT in the Kingdom. An earlier draft of this comment said
-- "Saudi-hosted"; that was false, and a false residency note in a support-inbox migration is exactly
-- the sentence someone later repeats in a PDPL answer. Residency is an OPEN item, not a fact.
-- It is the receipt: once a row lands here the message is NOT lost, whether or not an email is ever
-- sent. Email delivery is a SEPARATE, later step that needs a credential this project does not have
-- (no Resend/SendGrid/SMTP secret exists anywhere in the repo or the function environment) — the
-- `support-message` function sends only when that secret appears, and records the outcome in
-- `delivery_status`. Nothing here ever claims a message was emailed when it was not.
--
-- PDPL. Data minimisation, which is what this table CAN promise today (residency, per above, it
-- cannot). The row holds what the user typed plus the reply address they gave — no browsing history,
-- no listing activity, no location. The requester's IP is NEVER stored: only a salted SHA-256 of it,
-- and only so a flood from one source can be rate-limited. Retention is the same promise the About
-- screen makes about account data: deleting the account does not orphan these rows to a stranger,
-- because user_id is ON DELETE SET NULL — the message survives as an anonymous support ticket.
--
-- ACCESS. RLS is ON and there is deliberately NO policy. That is not an oversight: with RLS enabled
-- and zero policies, anon and authenticated clients can neither read nor write a single row, and the
-- ONLY way in is the service-role key (which bypasses RLS and lives only in the edge function's
-- environment). A support inbox must never be publicly readable — it is other people's email
-- addresses and problems — and it must never be publicly writable, or it becomes a spam sink.
create table if not exists public.support_messages (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  user_id         uuid references auth.users(id) on delete set null,
  reply_email     text not null,
  subject         text not null,
  body            text not null,
  locale          text not null default 'ar',
  app_version     text,
  user_agent      text,
  ip_hash         text,
  delivery_status text not null default 'stored',  -- stored | emailed | email_failed
  delivery_error  text,
  handled_at      timestamptz
);

alter table public.support_messages enable row level security;

-- The rate-limit lookup (ip_hash within the last hour) and the owner's "what is unhandled" read.
create index if not exists support_messages_ip_recent_idx on public.support_messages (ip_hash, created_at desc);
create index if not exists support_messages_unhandled_idx on public.support_messages (created_at desc) where handled_at is null;

comment on table public.support_messages is
  'In-app «تواصل معنا» messages. Service-role only (RLS on, no policies). ip_hash is a salted hash, never a raw IP.';
