-- FULL-CONVERSATION PERSISTENCE, server side (owner 2026-08-25: «treat Ezhalah's chat like ChatGPT
-- in terms of persistence» — a signed-in user's conversations must survive refresh, browser close,
-- and logging back in on any device; localStorage alone is explicitly not enough).
--
-- One row per sidebar chat. `meta` is the small HistoryItem envelope (title, starred, order, ts,
-- query, label — what the sidebar list needs); `transcript` is the full serialized conversation
-- (src/lib/chatTranscript.ts PersistedChat) and is deliberately a SEPARATE column so the sidebar
-- load can select metas only and hydrate a transcript lazily when its chat is opened.
--
-- PDPL: rows are keyed to auth.users with ON DELETE CASCADE, so the existing delete-account flow
-- (which deletes the auth user) wipes every conversation with it — no separate cleanup path to
-- forget. RLS restricts every operation to the owner; user_id defaults to auth.uid() server-side
-- so the client never asserts its own identity.

create table if not exists public.user_chats (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  meta jsonb not null,
  transcript jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists user_chats_user_recent on public.user_chats (user_id, updated_at desc);

alter table public.user_chats enable row level security;

drop policy if exists user_chats_own on public.user_chats;
create policy user_chats_own on public.user_chats
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Anon/public roles get nothing (RLS default-deny once enabled); authenticated users reach only
-- their own rows through the policy above.
grant select, insert, update, delete on public.user_chats to authenticated;
