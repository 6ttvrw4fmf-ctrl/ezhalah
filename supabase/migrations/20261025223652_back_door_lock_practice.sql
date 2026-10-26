-- SECURITY PHASE 4.6 (owner 2026-10-23: «how to lock the back door», «u do it»): the back-door lock, in PRACTICE mode.
--
-- The database will serve the public roles (anon, authenticated) only to callers carrying the secret handshake
-- x-ezhalah-gate = guard.front_door_secret: real visitors through the front door (api/sb.ts adds it), our robots
-- (scripts/lib/gateFetch.mjs, robotPassCore.mjs), our helpers (middleware.ts, api/share-card.ts, safe-deploy.sh,
-- schema-drift-gate.sh, af_score.py). service_role (scrapers, edge functions, cron) is never checked.
--
-- MODE (guard.gate_lock_mode): 'watch' (today: refuses NOBODY; every call that would be refused is written to the
-- Postgres log as «ezhalah_gate_missing role=… ua=… path=…», which the API logs can't do because they never see the
-- handshake header), 'lock' (HTTP 403 «Please use ezhalah-app.vercel.app»), 'off'. The switch to 'lock' happens only
-- with the owner present, after the watch log shows nothing of ours.
--
-- Fail-open: an error while checking leaves the caller allowed (a broken check must never take the API down).
-- Rollback: update guard.gate_lock_mode set mode = 'off';  (instant)
create table if not exists guard.gate_lock_mode (
  id int primary key default 1 check (id = 1),
  mode text not null default 'watch' check (mode in ('off', 'watch', 'lock')),
  set_at timestamptz not null default now()
);
revoke all on guard.gate_lock_mode from public, anon, authenticated;
grant select, update on guard.gate_lock_mode to service_role;
insert into guard.gate_lock_mode (id, mode) values (1, 'watch') on conflict (id) do nothing;

create or replace function guard.gate_valid(p_gate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(p_gate, '') <> '' and exists (select 1 from guard.front_door_secret s where s.secret = p_gate);
$fn$;
revoke all on function guard.gate_valid(text) from public;
grant execute on function guard.gate_valid(text) to anon, authenticated, service_role;

create or replace function guard.gate_lock_mode_now()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$ select coalesce((select mode from guard.gate_lock_mode where id = 1), 'off'); $fn$;
revoke all on function guard.gate_lock_mode_now() from public;
grant execute on function guard.gate_lock_mode_now() to anon, authenticated, service_role;

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
  visitor text;
  net text;
  net_mode text := 'off';
  lock_mode text := 'off';
  has_gate boolean := true;
begin
  -- SCRAPE GUARD (20261021, owner decision): a caller the hourly scrape alarm caught pulling >= 100,000 listing rows is
  -- refused for 24 h. The caller is the visitor the front door vouches for (secret handshake), else Cloudflare's
  -- address. NETWORK GUARD (20261021, owner): a vouched visitor on Tor / VPN / a server network is counted (watch) or
  -- refused (block). BACK-DOOR LOCK (20261023, owner): the public roles need the secret handshake (watch: log only;
  -- lock: refuse). Fail-open by construction: any error in the lookups leaves every caller allowed.
  begin
    if current_user::text in ('anon', 'authenticated') then
      hdr := current_setting('request.headers', true)::json;
      visitor := guard.front_door_client_ip(hdr ->> 'x-ezhalah-gate', hdr ->> 'x-ezhalah-client-ip');
      blocked := guard.ip_is_blocked(coalesce(visitor, hdr ->> 'cf-connecting-ip',
        split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1)));
      if visitor is not null and coalesce(hdr ->> 'x-ezhalah-robot', '') <> '1' then
        net_mode := guard.network_mode();
        if net_mode <> 'off' then net := guard.network_source(visitor); end if;
      end if;
      lock_mode := guard.gate_lock_mode_now();
      if lock_mode <> 'off' then has_gate := guard.gate_valid(hdr ->> 'x-ezhalah-gate'); end if;
    end if;
  exception when others then
    blocked := false;
    net := null;
    has_gate := true;
  end;
  if blocked then
    raise sqlstate 'PT429' using message = 'Too many requests',
      detail = 'This connection is paused for up to 24 hours after downloading listings in bulk.';
  end if;
  if not has_gate then
    if lock_mode = 'lock' then
      raise sqlstate 'PT403' using message = 'Please use ezhalah-app.vercel.app',
        detail = 'Ezhalah''s data is available through the Ezhalah app.';
    end if;
    begin
      raise log 'ezhalah_gate_missing role=% ua=% path=%', current_user,
        left(coalesce(hdr ->> 'user-agent', ''), 60), left(coalesce(current_setting('request.path', true), ''), 80);
    exception when others then null;
    end;
  end if;
  if net is not null then
    if net_mode = 'block' then
      raise sqlstate 'PT403' using message = 'This network is not supported',
        detail = 'Ezhalah is not available over VPN, Tor or server networks. Please turn off your VPN and try again.';
    end if;
    begin perform guard.count_network_hit(net); exception when others then null; end;
  end if;

  begin
    -- FRONT DOOR (2026-10-23): browsers reach us through api/sb.ts with user-agent «node». A visitor the front door
    -- vouches for skips the robot lanes unless it carries the robot pass (our own robots: always queue).
    -- TEST COPIES (2026-10-23): our robots' direct database calls carry the handshake and the «ezhalah-gate» log
    -- marker (scripts/lib/robotPassCore.mjs, gateFetch.mjs) with no vouched visitor — they queue as robots too.
    if coalesce(hdr ->> 'x-ezhalah-robot', '') = '1'
       or (visitor is null and coalesce(hdr ->> 'x-ezhalah-gate', '') <> ''
           and coalesce(hdr ->> 'x-client-info', '') like '%ezhalah-gate%') then
      null;
    elsif visitor is not null or not public.robot_gate_applies(
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
