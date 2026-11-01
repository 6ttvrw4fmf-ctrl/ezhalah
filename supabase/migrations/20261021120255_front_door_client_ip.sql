-- SECURITY PHASE 4.3 (owner-approved plan, 2026-10-21): the front door may tell the database who the real visitor is.
--
-- Searches will move behind our own server (/sb on ezhalah-app.vercel.app, api/sb.ts). Once they do, Cloudflare in
-- front of Supabase sees OUR server's address, not the visitor's, and robot_gate's auto-block (20261021043158) would
-- block our own server, i.e. everyone. So the front door forwards the visitor's address in x-ezhalah-client-ip, and
-- the database believes it ONLY when the same request carries x-ezhalah-gate equal to the secret stored here. Anyone
-- else sending that header is ignored and judged by cf-connecting-ip as before (Cloudflare refuses a forged
-- cf-connecting-ip outright, measured 2026-10-21: 403).
--
-- INERT until a secret row exists: guard.front_door_client_ip() returns NULL, so behaviour is exactly as before.
-- The secret is written by .github/workflows/front-door-secret.yml from the EZ_GATE_SECRET repository secret (never
-- typed into a migration or a chat), and the same value goes into the Vercel project env for api/sb.ts.
-- Rollback: create or replace robot_gate from 20261021043158; drop table guard.front_door_secret; drop the function.
create table if not exists guard.front_door_secret (
  id int primary key default 1 check (id = 1),
  secret text not null check (length(secret) >= 32),
  set_at timestamptz not null default now()
);
revoke all on guard.front_door_secret from public, anon, authenticated;
grant select, insert, update on guard.front_door_secret to service_role;

create or replace function guard.front_door_client_ip(p_gate text, p_ip text)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when coalesce(p_gate, '') = '' or coalesce(p_ip, '') = '' then null
    when p_ip !~ '^[0-9A-Fa-f:.]{3,45}$' then null
    when exists (select 1 from guard.front_door_secret s where s.secret = p_gate) then p_ip
  end;
$fn$;
revoke all on function guard.front_door_client_ip(text, text) from public;
grant execute on function guard.front_door_client_ip(text, text) to anon, authenticated, service_role;

-- Writing the secret needs a callable path for the workflow (service_role only; the schema is not exposed by
-- PostgREST, so this one public wrapper is the door, and it is closed to the public roles).
create or replace function public.ops_set_front_door_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if length(coalesce(p_secret, '')) < 32 then raise exception 'secret too short'; end if;
  insert into guard.front_door_secret (id, secret, set_at) values (1, p_secret, now())
  on conflict (id) do update set secret = excluded.secret, set_at = now();
  return true;
end
$fn$;
revoke all on function public.ops_set_front_door_secret(text) from public, anon, authenticated;
grant execute on function public.ops_set_front_door_secret(text) to service_role;

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
  hdr json;
begin
  -- SCRAPE GUARD (20261021, owner decision): a caller the hourly scrape alarm caught pulling >= 100,000 listing rows is
  -- refused for 24 h. The caller is the visitor the front door vouches for (secret handshake), else Cloudflare's
  -- address. Fail-open by construction: any error in the lookup leaves blocked = false.
  begin
    if current_user::text in ('anon', 'authenticated') then
      hdr := current_setting('request.headers', true)::json;
      blocked := guard.ip_is_blocked(coalesce(
        guard.front_door_client_ip(hdr ->> 'x-ezhalah-gate', hdr ->> 'x-ezhalah-client-ip'),
        hdr ->> 'cf-connecting-ip',
        split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1)));
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
