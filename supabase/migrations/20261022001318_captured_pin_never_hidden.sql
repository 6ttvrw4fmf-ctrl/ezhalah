-- A pin we hold is never hidden behind a district border again (owner 2026-10-21: «whenever we have a district
-- border, suspect a bug on our end, especially the big sites … make sure we never get those again»).
--
-- The same day turned up the class three times: Wasalt commercial (2,070 ads, pin in ar_data, the view read
-- additional_info), Aqar Monthly (~690 pins ERASED by a crawl that never asked for them, PR #8132), and the
-- four tables below, whose own captured source record carries the ad's pin while their listing_rich_attrs arm
-- reads only additional_info, which their scrapers never fill:
--   sanadak_commercial_listings   156  source_capture.latitude (the residential arm already reads it: 682/684)
--   aqargate_residential/commercial 149  source_capture.property_meta.advertisement_response.location — the
--                                      site's public API (wp-json/wp/v2/properties) prints the same pair per ad
--   amlakalahsa_residential_listings 254  source_capture."pw-map" — the ad's own map field (plus-code address)
--   tuba_residential_listings      10  source_capture.rega.location (older rows; new crawls fill additional_info)
-- None of the four is a shared default: 244, 50, 111 and 10 distinct points.
--
-- Part 1 repairs those arms (live-viewdef replace, scoped to each arm, anchor counts asserted).
-- Part 2 is the barrier the owner asked for, two daily detectors on mon_run_all_detectors' roster:
--   mon_detect_captured_pin_not_served — any served ad with NO pin whose own stored row holds a Saudi
--     coordinate pair (≥3 decimals), minus what the guards strip on purpose (far-from-city register, the
--     default-pin register, a point shared by ≥10 ads across ≥3 districts) and minus a reviewed waiver.
--     P1 per table at ≥10 ads. Full fleet: ~5 s (measured 2026-10-22), so it is gated to once a day.
--   mon_detect_pin_share_drop — a daily per-table snapshot of served vs pinned; P1 when a table loses ≥50
--     pins and ≥3 points of pin share since the previous snapshot. A crawl that erases pins (Aqar Monthly)
--     cannot hide inside a still-healthy row count.
set local statement_timeout = '5min';

create or replace function public._rich_attrs_arm_pin_from(v text, p_table text, p_lat text, p_lng text)
returns text language plpgsql immutable as $f$
declare
  o_lat text := $q$COALESCE((x.additional_info ->> 'latitude'::text), (x.additional_info ->> 'lat'::text))$q$;
  o_lng text := $q$COALESCE((x.additional_info ->> 'longitude'::text), (x.additional_info ->> 'lng'::text))$q$;
  p int; q int; head text; arm text; rest text;
begin
  p := position(format('%L::text AS source_table', p_table) in v);
  if p = 0 then raise exception '% arm not found', p_table; end if;
  head := substring(v from 1 for p - 1);
  rest := substring(v from p);
  q := position(format('FROM %s x', p_table) in rest);
  if q = 0 then raise exception '% FROM x not found', p_table; end if;
  arm := substring(rest from 1 for q - 1);
  rest := substring(rest from q);
  if position(p_lat in arm) > 0 then return v; end if;          -- already reads it
  if (length(arm) - length(replace(arm, o_lat, ''))) / length(o_lat) <> 2 then raise exception '% lat anchor', p_table; end if;
  if (length(arm) - length(replace(arm, o_lng, ''))) / length(o_lng) <> 2 then raise exception '% lng anchor', p_table; end if;
  arm := replace(arm, o_lat, format('COALESCE((x.additional_info ->> ''latitude''::text), (x.additional_info ->> ''lat''::text), %s)', p_lat));
  arm := replace(arm, o_lng, format('COALESCE((x.additional_info ->> ''longitude''::text), (x.additional_info ->> ''lng''::text), %s)', p_lng));
  return head || arm || rest;
end $f$;

do $m$
declare v text; i int;
begin
  v := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  v := public._rich_attrs_arm_pin_from(v, 'sanadak_commercial_listings',
         $q$(x.source_capture ->> 'latitude'::text)$q$, $q$(x.source_capture ->> 'longitude'::text)$q$);
  v := public._rich_attrs_arm_pin_from(v, 'aqargate_residential_listings',
         $q$(x.source_capture #>> '{property_meta,advertisement_response,location,latitude}'::text[])$q$,
         $q$(x.source_capture #>> '{property_meta,advertisement_response,location,longitude}'::text[])$q$);
  v := public._rich_attrs_arm_pin_from(v, 'aqargate_commercial_listings',
         $q$(x.source_capture #>> '{property_meta,advertisement_response,location,latitude}'::text[])$q$,
         $q$(x.source_capture #>> '{property_meta,advertisement_response,location,longitude}'::text[])$q$);
  v := public._rich_attrs_arm_pin_from(v, 'amlakalahsa_residential_listings',
         $q$(x.source_capture #>> '{pw-map,lat}'::text[])$q$, $q$(x.source_capture #>> '{pw-map,lng}'::text[])$q$);
  v := public._rich_attrs_arm_pin_from(v, 'tuba_residential_listings',
         $q$(x.source_capture #>> '{rega,location,latitude}'::text[])$q$, $q$(x.source_capture #>> '{rega,location,longitude}'::text[])$q$);
  for i in 1..20 loop
    begin
      set local lock_timeout = '3s';
      execute 'create or replace view public.listing_rich_attrs as ' || v;
      exit;
    exception when lock_not_available then
      if i = 20 then raise; end if;
      perform pg_sleep(2);
    end;
  end loop;
end $m$;

-- ── Barrier 1: a pin we hold must be served ──────────────────────────────────────────────────────────────
create table if not exists public.ops_captured_pin_waiver (
  source_table text primary key,
  reason       text not null check (length(reason) > 20),
  evidence     jsonb not null,
  created_at   timestamptz not null default now()
);
alter table public.ops_captured_pin_waiver enable row level security;
comment on table public.ops_captured_pin_waiver is
  'A table whose stored rows carry a coordinate that is NOT the ad''s pin (adjudicated against the source page). mon_detect_captured_pin_not_served skips it. Evidence is required.';

create or replace function public.captured_pin_not_served(p_table text)
returns table(hits bigint, example_listing_id bigint, example_pin text)
language plpgsql stable set search_path to 'public' as $f$
begin
  return query execute format($q$
    with s as (
      select s.listing_id, s.district_ar,
             (regexp_match(j, '"(?:lat|latitude)"\s*:\s*"?((?:1[6-9]|2[0-9]|3[0-2])\.[0-9]{3,})'))[1]::numeric la,
             (regexp_match(j, '"(?:lng|lon|long|longitude)"\s*:\s*"?((?:3[4-9]|4[0-9]|5[0-6])\.[0-9]{3,})'))[1]::numeric lo
        from public.search_listings_ar s
        join public.%1$I x on x.id = s.listing_id
        cross join lateral (select to_jsonb(x)::text j) jj
       where s.source_table = %1$L and s.production_ready and s.latitude is null
         and not exists (select 1 from public.ops_far_pin_register f where f.source_table = %1$L and f.listing_id = s.listing_id)),
    p as (select * from s where la is not null and lo is not null),
    shared as (select round(la,4) a, round(lo,4) b from p group by 1,2 having count(*) >= 10 and count(distinct district_ar) >= 3),
    real as (select p.* from p
              where not exists (select 1 from shared where shared.a = round(p.la,4) and shared.b = round(p.lo,4))
                and not exists (select 1 from public.ops_default_pin_register d
                                 where round(d.lat::numeric,4) = round(p.la,4) and round(d.lng::numeric,4) = round(p.lo,4)))
    select count(*)::bigint, min(listing_id)::bigint, min(la || ',' || lo) from real$q$, p_table);
end $f$;

create or replace function public.mon_detect_captured_pin_not_served()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  n int := 0; live text[] := '{}'; t text; r record; scanned int := 0;
begin
  if not public.mon_claim_daily_slot('mon_detect_captured_pin_not_served') then
    return 0;
  end if;
  for t in select distinct s.source_table from public.search_listings_ar s
            where s.production_ready and s.latitude is null
              and to_regclass('public.' || s.source_table) is not null
              and not exists (select 1 from public.ops_captured_pin_waiver w where w.source_table = s.source_table) loop
    scanned := scanned + 1;
    select * into r from public.captured_pin_not_served(t);
    if r.hits >= 10 then
      live := live || ('captured_pin_not_served:' || t);
      n := n + public.mon_raise('P1', 'captured_pin_not_served', split_part(t, '_', 1), 'captured_pin_not_served:' || t,
        jsonb_build_object('source_table', t, 'rows', r.hits, 'example_listing_id', r.example_listing_id, 'example_pin', r.example_pin,
          'why', 'These served ads show NO pin (a district border) although their own stored source record holds a coordinate pair. Owner 2026-10-21: suspect our end first.',
          'action', 'Open the example ad on the source: if the pair is the ad''s pin, make that table''s listing_rich_attrs arm (or its scraper) read it; if it is not, add ops_captured_pin_waiver with the evidence.'));
    end if;
  end loop;
  if scanned = 0 then
    live := live || 'captured_pin_not_served:BLIND'::text;
    n := n + public.mon_raise('P2', 'captured_pin_not_served', 'fleet', 'captured_pin_not_served:BLIND',
      jsonb_build_object('blind', true, 'why', 'No served table has a pin-less ad to scan, which is not plausible; the detector cannot see anything.'));
  end if;
  perform public.mon_resolve_stale_keys('captured_pin_not_served', live);
  return n;
end
$function$;

-- ── Barrier 2: a table's pins must not quietly drop ──────────────────────────────────────────────────────
create table if not exists public.ops_platform_pin_daily (
  day          date not null,
  source_table text not null,
  served       int  not null,
  pinned       int  not null,
  primary key (day, source_table)
);
alter table public.ops_platform_pin_daily enable row level security;

create or replace function public.pin_share_drops(p_day date default current_date, p_min_lost int default 50, p_min_pp numeric default 3)
returns table(source_table text, prev_day date, prev_pinned int, prev_served int, pinned int, served int)
language sql stable set search_path to 'public' as $f$
  select c.source_table, p.day, p.pinned, p.served, c.pinned, c.served
    from public.ops_platform_pin_daily c
    join lateral (select * from public.ops_platform_pin_daily q
                   where q.source_table = c.source_table and q.day < c.day order by q.day desc limit 1) p on true
   where c.day = p_day
     and p.pinned - c.pinned >= p_min_lost
     and p.served > 0 and c.served > 0
     and 100.0 * p.pinned / p.served - 100.0 * c.pinned / c.served >= p_min_pp;
$f$;

create or replace function public.mon_detect_pin_share_drop()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; r record; snap int;
begin
  if not public.mon_claim_daily_slot('mon_detect_pin_share_drop') then
    return 0;
  end if;
  insert into public.ops_platform_pin_daily(day, source_table, served, pinned)
  select current_date, s.source_table, count(*), count(s.latitude)
    from public.search_listings_ar s where s.production_ready group by s.source_table having count(*) >= 100
  on conflict (day, source_table) do update set served = excluded.served, pinned = excluded.pinned;
  get diagnostics snap = row_count;
  if snap = 0 then
    live := live || 'pin_share_drop:BLIND'::text;
    n := n + public.mon_raise('P2', 'pin_share_drop', 'fleet', 'pin_share_drop:BLIND',
      jsonb_build_object('blind', true, 'why', 'The served index produced no per-table snapshot.'));
  end if;
  for r in select * from public.pin_share_drops() loop
    live := live || ('pin_share_drop:' || r.source_table);
    n := n + public.mon_raise('P1', 'pin_share_drop', split_part(r.source_table, '_', 1), 'pin_share_drop:' || r.source_table,
      jsonb_build_object('source_table', r.source_table, 'prev_day', r.prev_day, 'prev_pinned', r.prev_pinned, 'prev_served', r.prev_served,
        'pinned', r.pinned, 'served', r.served,
        'why', 'This table lost pins faster than it lost ads since the last snapshot: a crawl or a sync is erasing or not reading pins (Aqar Monthly 2026-10-21 erased ~690).',
        'action', 'Compare a lost ad with its source page; check the scraper''s last run for a pin field it stopped asking for.'));
  end loop;
  perform public.mon_resolve_stale_keys('pin_share_drop', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_captured_pin_not_served' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_wasalt_page_pin_not_read'',',
    E'    ''mon_detect_wasalt_page_pin_not_read'',\n    ''mon_detect_captured_pin_not_served'',\n    ''mon_detect_pin_share_drop'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- ── Proofs ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Every repaired arm now answers a pin for every active row whose record carries one.
do $proof$
declare bad bigint;
begin
  select count(*) into bad from public.listing_rich_attrs r join public.aqargate_residential_listings x on x.id = r.listing_id
   where r.source_table = 'aqargate_residential_listings' and r.latitude is null
     and x.source_capture #>> '{property_meta,advertisement_response,location,latitude}' ~ '^[1-3][0-9]\.[0-9]+$';
  if bad > 0 then raise exception 'PROOF: % aqargate rows still read no pin', bad; end if;
  select count(*) into bad from public.listing_rich_attrs r join public.sanadak_commercial_listings x on x.id = r.listing_id
   where r.source_table = 'sanadak_commercial_listings' and r.latitude is null and x.source_capture ->> 'latitude' ~ '^[1-3][0-9]\.[0-9]+$';
  if bad > 0 then raise exception 'PROOF: % sanadak commercial rows still read no pin', bad; end if;
  select count(*) into bad from public.listing_rich_attrs r join public.amlakalahsa_residential_listings x on x.id = r.listing_id
   where r.source_table = 'amlakalahsa_residential_listings' and r.latitude is null and x.source_capture #>> '{pw-map,lat}' ~ '^[1-3][0-9]\.[0-9]+$';
  if bad > 0 then raise exception 'PROOF: % amlakalahsa rows still read no pin', bad; end if;
end $proof$;

-- 2. Mutation: hide 12 real Wasalt commercial pins from the served index → barrier 1 must count them.
do $proof$
declare before bigint; after bigint; d text;
begin
  select hits into before from public.captured_pin_not_served('wasalt_commercial_listings');
  begin
    update public.search_listings_ar set latitude = null, longitude = null
     where source_table = 'wasalt_commercial_listings'
       and listing_id in (select listing_id from public.search_listings_ar
                           where source_table = 'wasalt_commercial_listings' and production_ready and latitude is not null
                           order by listing_id limit 12);
    select hits into after from public.captured_pin_not_served('wasalt_commercial_listings');
    raise exception using errcode = 'P0001', message = 'rollback-mutation', detail = after::text;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'rollback-mutation' then raise; end if;
    get stacked diagnostics d = pg_exception_detail;
    after := d::bigint;
  end;
  if after < before + 10 then
    raise exception 'PROOF: barrier 1 saw % hidden pins (before %), expected ≥ % — it cannot catch the Wasalt shape', after, before, before + 10;
  end if;
end $proof$;

-- 3. Mutation: a table that loses half its pins overnight → barrier 2 must name it; a healthy one must not.
do $proof$
declare got int; healthy int;
begin
  begin
    insert into public.ops_platform_pin_daily values
      (current_date - 1, '__proof_drop', 1000, 950), (current_date, '__proof_drop', 1000, 500),
      (current_date - 1, '__proof_ok',   1000, 950), (current_date, '__proof_ok',   990, 945);
    select count(*) filter (where source_table = '__proof_drop'), count(*) filter (where source_table = '__proof_ok')
      into got, healthy from public.pin_share_drops();
    raise exception using errcode = 'P0001', message = 'rollback-mutation', detail = got || ',' || healthy;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'rollback-mutation' then raise; end if;
    declare d text; begin
      get stacked diagnostics d = pg_exception_detail;
      got := split_part(d, ',', 1)::int; healthy := split_part(d, ',', 2)::int;
    end;
  end;
  if got <> 1 or healthy <> 0 then
    raise exception 'PROOF: barrier 2 named the dropping table % time(s) and the healthy one % time(s) (want 1 and 0)', got, healthy;
  end if;
end $proof$;
