-- SECURITY PHASE 4.4 (owner 2026-10-21: «if someone uses VPN we can't», «aqar and those websites also don't work with
-- VPN»): visitors on Tor, VPN or server (datacenter) networks are refused, the way Aqar refuses them.
--
-- Lists, refreshed daily by .github/workflows/network-block-lists.yml through ops_replace_network_block():
--   tor        https://check.torproject.org/torbulkexitlist      (1,224 exits on 2026-10-21)
--   vpn        X4BNet/lists_vpn output/vpn/ipv4.txt              (11,018 ranges)
--   datacenter X4BNet/lists_vpn output/datacenter/ipv4.txt       (44,611 ranges)
--
-- WHO IS CHECKED: only a visitor the front door vouches for (api/sb.ts, secret handshake, 20261021120255). For
-- front-door traffic Cloudflare's address is our own server, which the datacenter list contains, so checking it would
-- block everyone. Our own browser robots carry a robot pass the front door verifies (x-ezhalah-robot: 1) and are never
-- checked.
--
-- MODE (guard.network_block_mode): 'watch' (default: nobody is refused; matches are counted per day in
-- ops_network_block_hits, on POST/RPC calls only, because GETs run read-only), 'block' (HTTP 403 «This network is not
-- supported»), 'off'. The owner asked for a day of watching, then blocking.
-- Rollback: update guard.network_block_mode set mode = 'off'; (instant), or restore robot_gate from 20261021120255.
create table if not exists public.ops_network_block (
  cidr cidr not null,
  source text not null check (source in ('tor', 'vpn', 'datacenter')),
  primary key (source, cidr)
);
create index if not exists ops_network_block_cidr on public.ops_network_block using gist (cidr inet_ops);
alter table public.ops_network_block enable row level security;
revoke all on public.ops_network_block from public, anon, authenticated;
grant select, insert, delete on public.ops_network_block to service_role;

create table if not exists public.ops_network_block_hits (
  day date not null default current_date,
  source text not null,
  n bigint not null default 0,
  primary key (day, source)
);
alter table public.ops_network_block_hits enable row level security;
revoke all on public.ops_network_block_hits from public, anon, authenticated;
grant select on public.ops_network_block_hits to service_role;

create table if not exists guard.network_block_mode (
  id int primary key default 1 check (id = 1),
  mode text not null default 'watch' check (mode in ('off', 'watch', 'block')),
  set_at timestamptz not null default now()
);
revoke all on guard.network_block_mode from public, anon, authenticated;
grant select, update on guard.network_block_mode to service_role;
insert into guard.network_block_mode (id, mode) values (1, 'watch') on conflict (id) do nothing;

-- Which list a visitor's address is on (tor first), or NULL. Never raises.
create or replace function guard.network_source(p_ip text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare r text;
begin
  select b.source into r from public.ops_network_block b
   where b.cidr >>= p_ip::inet
   order by case b.source when 'tor' then 0 when 'vpn' then 1 else 2 end
   limit 1;
  return r;
exception when others then
  return null;
end
$fn$;
revoke all on function guard.network_source(text) from public;
grant execute on function guard.network_source(text) to anon, authenticated, service_role;

create or replace function guard.network_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$ select coalesce((select mode from guard.network_block_mode where id = 1), 'off'); $fn$;
revoke all on function guard.network_mode() from public;
grant execute on function guard.network_mode() to anon, authenticated, service_role;

create or replace function guard.count_network_hit(p_source text)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.ops_network_block_hits as h (day, source, n) values (current_date, p_source, 1)
  on conflict (day, source) do update set n = h.n + 1;
$fn$;
revoke all on function guard.count_network_hit(text) from public;
grant execute on function guard.count_network_hit(text) to anon, authenticated, service_role;

-- The daily list refresh (service_role only). Refuses a list that shrank to almost nothing: a failed download must
-- never empty the block list (A FAILED FETCH IS NOT AN EMPTY ANSWER).
create or replace function public.ops_replace_network_block(p_source text, p_cidrs text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare n int;
begin
  if p_source not in ('tor', 'vpn', 'datacenter') then raise exception 'unknown source %', p_source; end if;
  if coalesce(array_length(p_cidrs, 1), 0) < (case p_source when 'tor' then 300 else 3000 end) then
    raise exception 'refusing a % list of % entries: too small to be real', p_source, coalesce(array_length(p_cidrs, 1), 0);
  end if;
  delete from public.ops_network_block where source = p_source;
  insert into public.ops_network_block (cidr, source)
    select distinct c::cidr, p_source from unnest(p_cidrs) c where c ~ '^[0-9.]+(/[0-9]{1,2})?$'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end
$fn$;
revoke all on function public.ops_replace_network_block(text, text[]) from public, anon, authenticated;
grant execute on function public.ops_replace_network_block(text, text[]) to service_role;

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
begin
  -- SCRAPE GUARD (20261021, owner decision): a caller the hourly scrape alarm caught pulling >= 100,000 listing rows is
  -- refused for 24 h. The caller is the visitor the front door vouches for (secret handshake), else Cloudflare's
  -- address. NETWORK GUARD (20261021, owner): a vouched visitor on Tor / VPN / a server network is counted (watch) or
  -- refused (block). Fail-open by construction: any error in the lookups leaves blocked = false and net = null.
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
    end if;
  exception when others then
    blocked := false;
    net := null;
  end;
  if blocked then
    raise sqlstate 'PT429' using message = 'Too many requests',
      detail = 'This connection is paused for up to 24 hours after downloading listings in bulk.';
  end if;
  if net is not null then
    if net_mode = 'block' then
      raise sqlstate 'PT403' using message = 'This network is not supported',
        detail = 'Ezhalah is not available over VPN, Tor or server networks. Please turn off your VPN and try again.';
    end if;
    begin perform guard.count_network_hit(net); exception when others then null; end;
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
