-- SHARE A WHOLE CHAT AS A COPY (owner 2026-10-17). A signed-in user's «مشاركة» saves a SNAPSHOT of the
-- conversation here under a short code; the link is /s/<code>. Whoever opens it signs in (Google/Apple),
-- and the chat is copied into THEIR own history — a copy, never live-synced back. The card speaks the
-- sender's APP language (locale), not the language they typed in.
--
-- No table policies: every read and write goes through the three functions below.
--   create_shared_chat  authenticated  size-capped, rate-capped, returns the short code
--   get_shared_chat     authenticated  the whole snapshot (the recipient must be signed in)
--   shared_chat_card    anon           name + locale + query only — what the WhatsApp card needs
create table if not exists public.shared_chat (
  code        text primary key check (code ~ '^[A-Za-z0-9]{8}$'),
  created_by  uuid not null references auth.users(id) on delete cascade,
  sender_name text not null check (char_length(sender_name) between 1 and 60),
  locale      text not null check (locale in ('ar', 'en')),
  query       jsonb not null,
  transcript  jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists shared_chat_created_by_idx on public.shared_chat (created_by, created_at desc);
alter table public.shared_chat enable row level security;
revoke all on public.shared_chat from anon, authenticated;

create or replace function public.create_shared_chat(
  p_sender_name text, p_locale text, p_query jsonb, p_transcript jsonb
) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_name text := btrim(coalesce(p_sender_name, ''));
begin
  if v_uid is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'sender name required' using errcode = '22023'; end if;
  if p_locale not in ('ar', 'en') then raise exception 'bad locale' using errcode = '22023'; end if;
  if jsonb_typeof(p_query) <> 'object' or jsonb_typeof(p_transcript) <> 'object' then
    raise exception 'bad payload' using errcode = '22023';
  end if;
  -- A saved chat is at most ~1.3 MB (500 cards, chatTranscript.ts); 3 MB leaves room and stops abuse.
  if octet_length(p_transcript::text) > 3000000 then raise exception 'chat too large' using errcode = '22023'; end if;
  if (select count(*) from public.shared_chat where created_by = v_uid and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'too many shares, try again later' using errcode = '54000';
  end if;
  loop
    v_code := left(translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/=', ''), 8);
    begin
      insert into public.shared_chat (code, created_by, sender_name, locale, query, transcript)
      values (v_code, v_uid, left(v_name, 60), p_locale, p_query, p_transcript);
      return v_code;
    exception when unique_violation then
      -- astronomically rare; draw again
    end;
  end loop;
end;
$$;

create or replace function public.get_shared_chat(p_code text)
returns table (sender_name text, locale text, query jsonb, transcript jsonb)
language sql stable security definer set search_path = public
as $$
  select s.sender_name, s.locale, s.query, s.transcript
  from public.shared_chat s
  where auth.uid() is not null and s.code = p_code;
$$;

create or replace function public.shared_chat_card(p_code text)
returns table (sender_name text, locale text, query jsonb)
language sql stable security definer set search_path = public
as $$
  select s.sender_name, s.locale, s.query from public.shared_chat s where s.code = p_code;
$$;

revoke all on function public.create_shared_chat(text, text, jsonb, jsonb) from public, anon;
revoke all on function public.get_shared_chat(text) from public, anon;
revoke all on function public.shared_chat_card(text) from public;
grant execute on function public.create_shared_chat(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.get_shared_chat(text) to authenticated;
grant execute on function public.shared_chat_card(text) to anon, authenticated;
