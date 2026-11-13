-- THE MAP PILL'S SECOND LINE (owner 2026-11-12: «whenever a user zooms in we show that message here», «آخر 30 يوما»,
-- «we need proper guards … it can't be wrong»). Under «N إعلان للبيع في حي الملقا» the pill says, for EXACTLY the ads the
-- pill counts (same box, same choices): «آخر 30 يوما: 🆕 120 إعلان جديد · ⚡ 85 اختفى · 💰 متوسط السعر 1.2 مليون».
--   🆕 new  = ads whose SITE published them in the last 30 days (search_listings_ar.posted_at, never first-seen),
--             a copy of the same ad on another site counted once.
--   ⚡ gone = ads that left the map in the last 30 days because their own page was re-opened and found removed
--             (DIRECT_REVISIT / CANDIDATE_PLUS_DIRECT sites only, row inactive with a deactivation stamp, never an
--             adjudicated withdrawal, dropped again if the ad comes back). Collected nightly from tonight; shown only
--             once 30 days of nightly collection exist and the last collection is under 36 h old.
--   💰 the median asking price (the home facts' «متوسط السعر المعروض» rule), sale only, only when every ad in view is
--             one type the user picked, from at least 10 priced ads.
-- Two counters: audit_map_view_facts() recounts 25 random views nightly through map_posted_window_counts_ar() and
-- separately written SQL; any disagreement turns the line off (ops_feature_flags.map_view_facts) and pages
-- (mon_detect_map_view_facts). Guests get no numbers from the server at all — only {locked, any}.

-- 1. what the map showed last night, and what has left it since
create table if not exists public.map_fact_points_snapshot (
  source_table text not null, listing_id bigint not null, platform text not null, deal text not null,
  type_ar text, unit_subtype_ar text, price numeric, area_m2 integer, city_ar text, district_ar text,
  latitude numeric not null, longitude numeric not null, posted_at timestamptz, taken_at timestamptz not null,
  primary key (source_table, listing_id));
alter table public.map_fact_points_snapshot enable row level security;

create table if not exists public.map_fact_removal (
  source_table text not null, listing_id bigint not null, platform text not null, deal text not null,
  type_ar text, unit_subtype_ar text, price numeric, area_m2 integer, city_ar text, district_ar text,
  latitude numeric not null, longitude numeric not null, posted_at timestamptz,
  deactivated_at timestamptz not null, left_at timestamptz not null, logged_at timestamptz not null default now(),
  primary key (source_table, listing_id));
create index if not exists map_fact_removal_box on public.map_fact_removal (latitude, longitude);
create index if not exists map_fact_removal_left on public.map_fact_removal (left_at);
alter table public.map_fact_removal enable row level security;

create table if not exists public.map_fact_capture_run (
  id bigserial primary key, run_at timestamptz not null default now(), ok boolean not null,
  prev_taken_at timestamptz, snapshot_rows integer, left_index integer, logged integer, reactivated_pruned integer);
alter table public.map_fact_capture_run enable row level security;

create table if not exists public.map_view_facts_audit (
  id bigserial primary key, run_at timestamptz not null default now(), checked integer not null, failed integer not null,
  examples jsonb not null default '[]'::jsonb);
alter table public.map_view_facts_audit enable row level security;

insert into public.ops_feature_flags (name, enabled, reason, changed_at) values
  ('map_view_facts', true, 'owner 2026-11-12: the map pill''s second line (new / gone / median price for the ads in view). Off = the pill shows only its count. The nightly checker turns it off by itself (reason «audit: …») when it cannot reproduce the numbers, and back on after a clean night.', now())
on conflict (name) do nothing;

-- 2. the deal word the map uses, shared by the snapshot (same rule as map_posted_window_counts_ar)
create or replace function public.map_fact_short_pairs()
returns text[] language plpgsql stable security definer set search_path to 'public' as $function$
declare v_short text[];
begin
  select coalesce(array_agg(p.k), '{}') into v_short from public.map_short_pairs_ar p;
  if not exists (select 1 from public.map_short_pairs_ar) then
    select coalesce(array_agg(k) filter (where pool = 'شهري'), '{}')
      into v_short
    from (select d.platform || '|' || coalesce(d.rent_period_ar, '') as k, public.rent_pool_ar(d.platform, d.rent_period_ar) as pool
          from (select distinct s.platform, s.rent_period_ar from public.search_listings_ar s where s.deal_ar = 'إيجار') d) x;
  end if;
  return v_short;
end
$function$;
revoke all on function public.map_fact_short_pairs() from public, anon, authenticated;

-- 3. nightly: log what left the map because its page was found removed, then retake the snapshot
create or replace function public.map_fact_capture_removals()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_prev timestamptz; v_short text[]; t text; c int; v_left int := 0; v_logged int := 0; v_pruned int := 0; v_rows int := 0;
begin
  select max(taken_at) into v_prev from public.map_fact_points_snapshot;
  v_short := public.map_fact_short_pairs();
  drop table if exists _mf_left;
  if v_prev is not null then
    create temp table _mf_left on commit drop as
      select p.* from public.map_fact_points_snapshot p
      where not exists (select 1 from public.search_listings_ar s where s.source_table = p.source_table and s.listing_id = p.listing_id);
    get diagnostics v_left = row_count;
    for t in select distinct g.source_table from _mf_left g loop
      if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
      execute format($q$
        insert into public.map_fact_removal (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                             city_ar, district_ar, latitude, longitude, posted_at, deactivated_at, left_at)
        select g.source_table, g.listing_id, g.platform, g.deal, g.type_ar, g.unit_subtype_ar, g.price, g.area_m2,
               g.city_ar, g.district_ar, g.latitude, g.longitude, g.posted_at, r.deactivated_at, now()
        from _mf_left g join public.%I r on r.id = g.listing_id
        where g.source_table = %L and r.active = false and r.deactivated_at is not null
          and r.deactivated_at >= %L::timestamptz - interval '1 day'
          and exists (select 1 from public.ops_liveness_registry lr
                      where lr.platform = regexp_replace(g.source_table, '_(residential|commercial)_listings$', '')
                        and lr.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT'))
          and not exists (select 1 from public.ops_adjudicated_listing j where j.tbl = %L and j.listing_id = r.id)
        on conflict (source_table, listing_id) do nothing$q$, t, t, v_prev, t);
      get diagnostics c = row_count; v_logged := v_logged + c;
    end loop;
  end if;
  -- an ad that came back is not gone
  for t in select distinct m.source_table from public.map_fact_removal m loop
    if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
    execute format('delete from public.map_fact_removal m using public.%I r where m.source_table = %L and r.id = m.listing_id and r.active', t, t);
    get diagnostics c = row_count; v_pruned := v_pruned + c;
  end loop;
  delete from public.map_fact_removal where left_at < now() - interval '45 days';
  truncate public.map_fact_points_snapshot;
  insert into public.map_fact_points_snapshot (source_table, listing_id, platform, deal, type_ar, unit_subtype_ar, price, area_m2,
                                               city_ar, district_ar, latitude, longitude, posted_at, taken_at)
  select distinct on (s.source_table, s.listing_id)
         s.source_table, s.listing_id, s.platform, x.deal, s.type_ar, s.unit_subtype_ar,
         case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end, s.area_m2,
         s.city_ar, s.district_ar, s.latitude, s.longitude, s.posted_at, now()
  from public.map_listing_points_ar s
  cross join lateral (select case when s.deal_ar = 'بيع' then 'buy'
                                  when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                                  when s.deal_ar = 'إيجار' then 'rent' end as deal) x
  where s.latitude is not null and s.longitude is not null and x.deal is not null;
  get diagnostics v_rows = row_count;
  insert into public.map_fact_capture_run (ok, prev_taken_at, snapshot_rows, left_index, logged, reactivated_pruned)
  values (true, v_prev, v_rows, v_left, v_logged, v_pruned);
  return jsonb_build_object('prev_taken_at', v_prev, 'snapshot_rows', v_rows, 'left_index', v_left, 'logged', v_logged, 'reactivated_pruned', v_pruned);
end
$function$;
revoke all on function public.map_fact_capture_removals() from public, anon, authenticated;

-- 4. ⚡ is shown only on a full, fresh 30-day log
create or replace function public.map_view_facts_gone_ready()
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.map_fact_capture_run where ok and prev_taken_at is null and run_at <= now() - interval '30 days')
     and exists (select 1 from public.map_fact_capture_run where ok and run_at >= now() - interval '36 hours');
$function$;
revoke all on function public.map_view_facts_gone_ready() from public, anon, authenticated;

-- 5. the numbers for exactly the ads the pill counts. The `kept` / `f` filter is map_posted_window_counts_ar()'s,
--    word for word (scripts/verify-map-view-facts.ts compares them), so `any` is the pill's count and `new30_raw` its d30.
create or replace function public.map_view_facts_core(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_short text[];
  v_geom extensions.geometry;
  v_plain boolean;
  v_ready boolean;
  v jsonb;
begin
  v_short := public.map_fact_short_pairs();
  v_geom := case when p_poly is null then null
                 else extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326) end;
  v_plain := p_poly is null and p_beds is null and p_area_min is null and p_area_max is null
             and p_price_min is null and p_price_max is null and p_furnished is null;
  v_ready := public.map_view_facts_gone_ready();
  with kept as (
    select case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal,
           case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price, s.posted_at,
           s.type_ar, s.platform, s.area_m2, s.city_ar, s.district_ar
    from public.map_listing_points_ar s
    where s.latitude is not null and s.longitude is not null
      and s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = s.source_table and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5))
      and (p_category is null or (p_category = 'residential' and s.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and s.source_table like '%\_commercial\_%'))
      and ( ((p_tables is null or s.source_table = any (p_tables))
             and (p_types is null or s.type_ar = any (p_types) or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
         or (p_tables2 is not null and p_types2 is not null and s.source_table = any (p_tables2)
             and (s.type_ar = any (p_types2) or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
      and (p_macro is null
           or (s.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
           or s.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
           or (s.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
               and (case p_macro when 'Residential' then s.source_table like '%\_residential\_listings'
                                 when 'Commercial' then s.source_table like '%\_commercial\_listings' else true end)))
      and (p_beds is null or s.bedrooms = any (p_beds)) and (p_furnished is null or s.furnished = p_furnished)
      and (p_area_min is null or s.area_m2 >= p_area_min) and (p_area_max is null or s.area_m2 <= p_area_max)
      and (v_geom is null or extensions.ST_Contains(v_geom, extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
  ), f as (
    select k.* from kept k
    where k.deal is not null and (p_deals is null or k.deal = any (p_deals))
      and (p_price_min is null or k.price >= p_price_min) and (p_price_max is null or k.price <= p_price_max)
  ), fd as (
    -- a copy of the same ad on ANOTHER site counts once: same deal, type, price, area and place; the alphabetically first
    -- site keeps it. An ad without a price or an area is never treated as anyone's copy.
    select f.*, (f.price is null or f.area_m2 is null
                 or f.platform = min(f.platform) over (partition by f.deal, f.type_ar, f.price, f.area_m2, f.city_ar, f.district_ar)) as own
    from f
  ), g as (
    select r.deal, r.type_ar, r.price, r.area_m2, r.city_ar, r.district_ar, r.platform
    from public.map_fact_removal r
    where v_plain and v_ready and r.left_at >= now() - interval '30 days'
      and r.latitude between p_s::numeric and p_n::numeric and r.longitude between p_w::numeric and p_e::numeric
      and (p_deals is null or r.deal = any (p_deals))
      and (p_category is null or (p_category = 'residential' and r.source_table like '%\_residential\_%')
                              or (p_category = 'commercial' and r.source_table like '%\_commercial\_%'))
      and ( ((p_tables is null or r.source_table = any (p_tables))
             and (p_types is null or r.type_ar = any (p_types) or (r.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types))))
         or (p_tables2 is not null and p_types2 is not null and r.source_table = any (p_tables2)
             and (r.type_ar = any (p_types2) or (r.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (p_types2)))) )
      and (p_macro is null
           or (r.unit_subtype_ar = 'أرض خام' and 'أرض خام' = any (coalesce(p_types, '{}'::text[]) || coalesce(p_types2, '{}'::text[])))
           or r.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = p_macro)
           or (r.type_ar in (select k.type_ar from public.known_type_ar k where k.macro = 'both')
               and (case p_macro when 'Residential' then r.source_table like '%\_residential\_listings'
                                 when 'Commercial' then r.source_table like '%\_commercial\_listings' else true end)))
  ), gd as (
    select g.*, (g.price is null or g.area_m2 is null
                 or g.platform = min(g.platform) over (partition by g.deal, g.type_ar, g.price, g.area_m2, g.city_ar, g.district_ar)) as own
    from g
  ), pr as (
    select fd.price from fd where fd.own and fd.deal = 'buy' and fd.price > 0
  )
  select jsonb_build_object(
    'any', (select count(*) from f),
    'new30_raw', (select count(*) from f where f.posted_at >= now() - make_interval(days => 30)),
    'new30', (select count(*) from fd where fd.own and fd.posted_at >= now() - make_interval(days => 30) and fd.posted_at <= now() + interval '1 day'),
    'priced', (select count(*) from pr),
    'median', case when p_deals = array['buy']::text[] and (p_types is not null or p_types2 is not null)
                        and (select count(distinct f.type_ar) from f) = 1 and (select count(*) from pr) >= 10
                   then (select round(percentile_cont(0.5) within group (order by pr.price))::bigint from pr) end,
    'gone30', case when v_plain and v_ready then (select count(*) from gd where gd.own) end,
    'gone_ready', v_ready,
    'plain', v_plain)
  into v;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_core(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public, anon, authenticated;

-- 6. what the browser calls: nothing when switched off, only {locked, any} for a guest
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('map_view_facts_ar', '{anon,authenticated}', 'map pill second line (owner 2026-11-12): new / gone / median price for the ads the pill counts. Read-only STABLE aggregates; a guest gets only {locked, any}.')
on conflict do nothing;
create or replace function public.map_view_facts_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare v jsonb;
begin
  if not coalesce((select ff.enabled from public.ops_feature_flags ff where ff.name = 'map_view_facts'), false) then
    return null;
  end if;
  v := public.map_view_facts_core(p_s, p_w, p_n, p_e, p_deals, p_poly, p_category, p_types, p_beds, p_area_min, p_area_max,
                                  p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro);
  if auth.uid() is null then
    return jsonb_build_object('locked', true, 'any', v -> 'any');
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public;
grant execute on function public.map_view_facts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) to anon, authenticated;

-- 7. the second counter: 25 random sale views a night, recounted another way
create or replace function public.audit_map_view_facts()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record; c jsonb; w jsonb; m numeric; gn bigint; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb; why text[];
  v_ready boolean := public.map_view_facts_gone_ready();
begin
  for r in select s.latitude::float8 as lat, s.longitude::float8 as lng, s.type_ar
           from public.map_listing_points_ar s
           where s.deal_ar = 'بيع' and s.type_ar is not null and s.type_ar <> 'أرض خام' and s.latitude is not null
           order by random() limit 25
  loop
    checked := checked + 1; why := '{}';
    c := public.map_view_facts_core(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    w := public.map_posted_window_counts_ar(r.lat - 0.02, r.lng - 0.02, r.lat + 0.02, r.lng + 0.02, array['buy'], null, null, array[r.type_ar]);
    if (c ->> 'any') is distinct from (w ->> 'any') then why := why || 'any'; end if;
    if (c ->> 'new30_raw') is distinct from (w ->> 'd30') then why := why || 'new30_raw'; end if;
    if (c ->> 'new30')::bigint > (c ->> 'new30_raw')::bigint or (c ->> 'new30')::bigint < 0 then why := why || 'new30_bounds'; end if;
    -- the median, written separately: sale ads of this type in the box, minus copies on another site
    select percentile_cont(0.5) within group (order by a.price_total) into m
    from (select p.price_total, p.platform, p.area_m2, p.city_ar, p.district_ar, p.type_ar
          from public.map_listing_points_ar p
          where p.deal_ar = 'بيع' and p.type_ar = r.type_ar and p.price_total > 0
            and p.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
            and p.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
            and not exists (select 1 from public.ops_default_pin_register d
                            where d.source_table = p.source_table and d.lat = round(p.latitude::numeric, 5) and d.lng = round(p.longitude::numeric, 5))) a
    where a.area_m2 is null
       or not exists (select 1 from public.map_listing_points_ar q
                      where q.deal_ar = 'بيع' and q.type_ar = a.type_ar and q.price_total = a.price_total and q.area_m2 = a.area_m2
                        and q.city_ar is not distinct from a.city_ar and q.district_ar is not distinct from a.district_ar
                        and q.platform < a.platform
                        and q.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
                        and q.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric
                        and not exists (select 1 from public.ops_default_pin_register d
                                        where d.source_table = q.source_table and d.lat = round(q.latitude::numeric, 5) and d.lng = round(q.longitude::numeric, 5)));
    if (c ->> 'median') is not null and abs((c ->> 'median')::numeric - round(m)) > 1 then why := why || 'median'; end if;
    if v_ready then
      select count(*) into gn from public.map_fact_removal x
      where x.deal = 'buy' and x.type_ar = r.type_ar and x.left_at >= now() - interval '30 days'
        and x.latitude between (r.lat - 0.02)::numeric and (r.lat + 0.02)::numeric
        and x.longitude between (r.lng - 0.02)::numeric and (r.lng + 0.02)::numeric;
      if (c ->> 'gone30')::bigint > gn then why := why || 'gone30_bounds'; end if;
    elsif (c ->> 'gone30') is not null then
      why := why || 'gone30_shown_before_ready';
    end if;
    if cardinality(why) > 0 then
      failed := failed + 1;
      if jsonb_array_length(ex) < 5 then
        ex := ex || jsonb_build_object('lat', r.lat, 'lng', r.lng, 'type', r.type_ar, 'why', to_jsonb(why), 'facts', c, 'windows', w, 'median_recount', m);
      end if;
    end if;
  end loop;
  insert into public.map_view_facts_audit (checked, failed, examples) values (checked, failed, ex);
  if failed > 0 then
    update public.ops_feature_flags set enabled = false, changed_at = now(),
           reason = 'audit: the nightly checker could not reproduce ' || failed || ' of ' || checked || ' map views on ' || now()::date || ' — the second line is hidden until a clean night.'
     where name = 'map_view_facts' and enabled;
  else
    update public.ops_feature_flags set enabled = true, changed_at = now(),
           reason = 'owner 2026-11-12: the map pill''s second line. Turned back on by a clean nightly check on ' || now()::date || '.'
     where name = 'map_view_facts' and not enabled and reason like 'audit:%';
  end if;
  return jsonb_build_object('checked', checked, 'failed', failed, 'examples', ex);
end
$function$;
revoke all on function public.audit_map_view_facts() from public, anon, authenticated;

-- 8. nightly at 01:15 Riyadh: collect, then check
select cron.schedule('map-view-facts', '15 22 * * *',
  $$set statement_timeout to '900s'; select public.map_fact_capture_removals(); select public.audit_map_view_facts();$$);

-- 9. the alarm, and its roster entry
create or replace function public.mon_detect_map_view_facts()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; a record;
begin
  if not exists (select 1 from public.map_fact_capture_run where ok and run_at >= now() - interval '36 hours') then
    live := live || 'map_view_facts:capture_not_run'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:capture_not_run',
      jsonb_build_object('why', 'The nightly removal log for the map pill did not run; ⚡ «اختفى» stops showing after 36 h.',
        'action', 'Check cron job map-view-facts; run select public.map_fact_capture_removals();'));
  end if;
  select * into a from public.map_view_facts_audit order by run_at desc limit 1;
  if a.run_at is null or a.run_at < now() - interval '36 hours' then
    live := live || 'map_view_facts:audit_not_run'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:audit_not_run',
      jsonb_build_object('why', 'The independent checker of the map pill numbers did not run.',
        'action', 'Check cron job map-view-facts; run select public.audit_map_view_facts();'));
  elsif a.failed > 0 then
    live := live || 'map_view_facts:disagree'::text;
    n := n + public.mon_raise('P1', 'map_view_facts', 'fleet', 'map_view_facts:disagree',
      jsonb_build_object('checked', a.checked, 'failed', a.failed, 'examples', a.examples,
        'why', 'The checker could not reproduce the map pill numbers; the line was switched off before users saw more.',
        'action', 'Compare map_view_facts_core() with audit_map_view_facts() for the examples; fix the builder, never the checker.'));
  end if;
  perform public.mon_resolve_stale_keys('map_view_facts', live);
  return n;
end
$function$;
revoke execute on function public.mon_detect_map_view_facts() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_map_view_facts' in src) > 0 then return; end if;
  if (length(src) - length(replace(src, '''mon_detect_welcome_insights_audit'',', ''))) / length('''mon_detect_welcome_insights_audit'',') <> 1 then
    raise exception 'roster anchor not found exactly once — refusing to guess where the entry belongs';
  end if;
  out_def := replace(src, '''mon_detect_welcome_insights_audit'',', '''mon_detect_welcome_insights_audit'', ''mon_detect_map_view_facts'',');
  execute out_def;
end $$;

-- 10. proof the pieces are in place
do $proof$
begin
  if position('mon_detect_map_view_facts' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
  if not exists (select 1 from cron.job where jobname = 'map-view-facts' and command like '%audit_map_view_facts%') then
    raise exception 'PROOF: the nightly job does not run the checker';
  end if;
  if public.map_view_facts_gone_ready() then
    raise exception 'PROOF: ⚡ reads as ready before a single night was collected';
  end if;
end
$proof$;
