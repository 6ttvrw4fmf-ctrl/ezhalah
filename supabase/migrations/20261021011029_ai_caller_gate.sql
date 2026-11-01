-- SECURITY PHASE 1.7 (owner-approved plan, 2026-10-21): the AI chat has a per-connection limit.
--
-- The agent and translit edge functions accept the publishable key, so anyone can call them; the only brake was the
-- GLOBAL spend gate (ai_spend_gate), which stops everyone at once after one caller has burned the budget. This adds a
-- brake per caller: the edge function hashes the caller's connection address (never stored in the clear) and asks
-- ai_caller_gate() before calling the model. Per caller and per function: 60 calls a minute, 600 an hour — far above
-- a person typing, so only a script hits it. The edge function treats an unreachable gate as ALLOW and records it:
-- the global spend gate still fails closed behind it, so money stays bounded either way.
--
-- service_role only (the edge functions use the service key). Rows older than 2 hours are pruned as it runs.
-- Rollback: drop function public.ai_caller_gate(text, text); drop table public.ops_ai_caller_hits;
create table if not exists public.ops_ai_caller_hits (
  caller text not null,
  fn text not null,
  win_start timestamptz not null,
  win_len text not null check (win_len in ('minute', 'hour')),
  n int not null default 0,
  primary key (caller, fn, win_len, win_start)
);
alter table public.ops_ai_caller_hits enable row level security;
revoke all on public.ops_ai_caller_hits from public, anon, authenticated;
grant select, insert, update, delete on public.ops_ai_caller_hits to service_role;
create index if not exists ops_ai_caller_hits_win_start on public.ops_ai_caller_hits (win_start);

create or replace function public.ai_caller_gate(p_caller text, p_fn text)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  per_min constant int := 60;
  per_hour constant int := 600;
  m int; h int;
begin
  if coalesce(p_caller, '') = '' or coalesce(p_fn, '') = '' then
    return jsonb_build_object('allow', true, 'reason', 'no caller key');
  end if;
  insert into ops_ai_caller_hits as t (caller, fn, win_len, win_start, n)
    values (p_caller, p_fn, 'minute', date_trunc('minute', now()), 1)
    on conflict (caller, fn, win_len, win_start) do update set n = t.n + 1
    returning n into m;
  insert into ops_ai_caller_hits as t (caller, fn, win_len, win_start, n)
    values (p_caller, p_fn, 'hour', date_trunc('hour', now()), 1)
    on conflict (caller, fn, win_len, win_start) do update set n = t.n + 1
    returning n into h;
  if random() < 0.02 then
    delete from ops_ai_caller_hits where win_start < now() - interval '2 hours';
  end if;
  if m > per_min then return jsonb_build_object('allow', false, 'reason', 'per-minute limit', 'minute', m, 'hour', h); end if;
  if h > per_hour then return jsonb_build_object('allow', false, 'reason', 'per-hour limit', 'minute', m, 'hour', h); end if;
  return jsonb_build_object('allow', true, 'minute', m, 'hour', h);
end
$fn$;
revoke all on function public.ai_caller_gate(text, text) from public, anon, authenticated;
grant execute on function public.ai_caller_gate(text, text) to service_role;
