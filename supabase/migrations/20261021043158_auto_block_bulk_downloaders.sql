-- SECURITY PHASE 4.2 (owner decision 2026-10-21: "block at 100,000 now, lower later"): bulk downloaders are blocked
-- automatically for 24 hours.
--
-- scripts/scrape-alarm.ts (hourly) writes an address here when it pulled >= 100,000 listing rows or >= 6,000 requests
-- in one hour. Measured before choosing the bar (24 h to 2026-10-21): the busiest real visitor pulled 8,009 rows in an
-- hour; the owner asked for 5,000 and 10,000 and was shown why those would block real searchers (each search loads
-- ~1,000 rows); the bar is lowered after searches load smaller batches.
--
-- The check lives in the PostgREST pre-request hook (robot_gate), so it covers every REST and RPC call from the public
-- and signed-in roles. It FAILS OPEN: if the lookup itself errors, the request goes through (a broken guard must never
-- take the whole API down — AGENTS.md "our own robots must not take production down"). A blocked caller gets HTTP 429.
-- service_role (our robots, scrapers, CI with the service key) is never checked.
--
-- Unblock one address: delete from public.ops_blocked_ip where ip = '<address>';
-- Rollback: restore robot_gate from 20261004223632, drop schema guard cascade, drop table public.ops_blocked_ip.
create table if not exists public.ops_blocked_ip (
  ip text primary key,
  blocked_until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.ops_blocked_ip enable row level security;
revoke all on public.ops_blocked_ip from public, anon, authenticated;
grant select, insert, update, delete on public.ops_blocked_ip to service_role;

-- A schema PostgREST does not expose, so the lookup is not itself a public API.
create schema if not exists guard;
revoke all on schema guard from public;
grant usage on schema guard to anon, authenticated, service_role;

create or replace function guard.ip_is_blocked(p_ip text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(p_ip, '') <> ''
     and exists (select 1 from public.ops_blocked_ip b where b.ip = p_ip and b.blocked_until > now());
$fn$;
revoke all on function guard.ip_is_blocked(text) from public;
grant execute on function guard.ip_is_blocked(text) to anon, authenticated, service_role;

create or replace function public.robot_gate()
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  -- ponytail: one global pool of 2 lanes and a 6 s wait (under authenticator's 8 s statement_timeout),
  -- then fail-open. Tune these two numbers if robots start timing out or users still feel them.
  robot_lanes constant int := 2;
  robot_max_wait constant interval := interval '6 seconds';
  give_up_at timestamptz;
  blocked boolean := false;
begin
  -- SCRAPE GUARD (20261021, owner decision): a caller the hourly scrape alarm caught pulling >= 100,000 listing rows is
  -- refused for 24 h. Fail-open by construction: any error in the lookup leaves blocked = false.
  begin
    if current_user::text in ('anon', 'authenticated') then
      blocked := guard.ip_is_blocked(coalesce(
        current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
        split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)));
    end if;
  exception when others then
    blocked := false;
  end;
  if blocked then
    raise sqlstate 'PT429' using message = 'Too many requests',
      detail = 'This connection is paused for up to 24 hours after downloading listings in bulk.';
  end if;

  begin
    if not public.robot_gate_applies(
         current_setting('request.headers', true)::json ->> 'user-agent', current_user::text) then
      return;
    end if;
    give_up_at := clock_timestamp() + robot_max_wait;
    loop
      for lane in 1..robot_lanes loop
        if pg_try_advisory_xact_lock(hashtext('ezhalah:robot_gate'), lane) then
          return;
        end if;
      end loop;
      exit when clock_timestamp() >= give_up_at;
      perform pg_sleep(0.1);
    end loop;
  exception when others then
    return;
  end;
end
$function$;
