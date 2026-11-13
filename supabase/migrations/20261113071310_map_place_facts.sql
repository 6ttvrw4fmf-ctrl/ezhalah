-- THE MAP BOX FROM CITY LEVEL TO DISTRICT LEVEL (owner 2026-11-13: «this fact shows from city level to district level …
-- user doesn't need to select something»). At area-label zoom the pill names a city or a district with that place's own
-- count; counting a whole city live on every pan is too slow (~1 s for Riyadh), so every place's facts are PREPARED
-- hourly from one read of the map (map_place_facts), by deal, for the unfiltered view the area labels show:
--   n_ads, new30 (site posting date, copies once), gone30 (confirmed removals, once ready), cuts30 (once ready),
--   top_type / top_ppm = the most common type with ≥ 10 priced ads and its median asking price per metre (10–200,000 SAR)
--   — named, so prices are never mixed — and, for districts, nb_ppm = the 4 nearest districts' median for that type.
-- Every build checks 5 random districts another way; a failed check, or a build older than 3 h, serves nothing and pages.

create table if not exists public.map_place_facts (
  level text not null, city_ar text not null, district_ar text not null default '', deal text not null,
  n_ads integer not null, new30 integer not null, gone30 integer, cuts30 integer,
  top_type text, top_ppm bigint, top_ppm_n integer, nb_ppm bigint, nb_names text[],
  built_at timestamptz not null, primary key (level, city_ar, district_ar, deal));
alter table public.map_place_facts enable row level security;

create table if not exists public.map_place_facts_build (
  id bigserial primary key, built_at timestamptz not null default now(), rows integer not null, checked integer not null,
  failed integer not null, examples jsonb not null default '[]'::jsonb, ms integer);
alter table public.map_place_facts_build enable row level security;

create or replace function public.map_fact_build_place_facts()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_short text[]; v_ready boolean; v_cuts_ready boolean; v_rows int; v_t0 timestamptz := clock_timestamp();
  r record; n1 bigint; n2 bigint; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb;
begin
  v_short := public.map_fact_short_pairs();
  v_ready := public.map_view_facts_gone_ready();
  v_cuts_ready := exists (select 1 from public.map_fact_source_start ss where ss.source = 'price_diary' and ss.started_at <= now() - interval '30 days');
  drop table if exists _pf_base;
  create temp table _pf_base on commit drop as
    select y.*, (y.price is null or y.area_m2 is null
                 or y.platform = min(y.platform) over (partition by y.deal, y.type_ar, y.price, y.area_m2, y.city_ar, y.district_ar)) as own
    from (select s.source_table, s.listing_id, s.platform, s.city_ar, s.district_ar, s.type_ar, s.area_m2, s.posted_at, x.deal,
                 case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price
          from public.map_listing_points_ar s
          cross join lateral (select case when s.deal_ar = 'بيع' then 'buy'
                                          when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                                          when s.deal_ar = 'إيجار' then 'rent' end as deal) x
          where s.latitude is not null and s.longitude is not null and x.deal is not null and s.city_ar is not null
            and not exists (select 1 from public.ops_default_pin_register d
                            where d.source_table = s.source_table and d.lat = round(s.latitude::numeric, 5) and d.lng = round(s.longitude::numeric, 5))) y;
  create index on _pf_base (city_ar, district_ar, type_ar);

  truncate public.map_place_facts;
  with counts as (
    select case when grouping(b.district_ar) = 1 then 'city' else 'district' end as level, b.city_ar, coalesce(b.district_ar, '') as district_ar, b.deal,
           count(*) as n_ads,
           count(*) filter (where b.own and b.posted_at >= now() - interval '30 days' and b.posted_at <= now() + interval '1 day') as new30
    from _pf_base b
    group by grouping sets ((b.city_ar, b.deal), (b.city_ar, b.district_ar, b.deal))
  ), types as (
    select case when grouping(b.district_ar) = 1 then 'city' else 'district' end as level, b.city_ar, coalesce(b.district_ar, '') as district_ar, b.type_ar,
           count(*) as n, percentile_cont(0.5) within group (order by b.price / b.area_m2) as ppm
    from _pf_base b
    where b.deal = 'buy' and b.own and b.price > 0 and b.area_m2 > 0 and b.type_ar is not null
    group by grouping sets ((b.city_ar, b.type_ar), (b.city_ar, b.district_ar, b.type_ar))
  ), top as (
    select distinct on (t.level, t.city_ar, t.district_ar) t.level, t.city_ar, t.district_ar, t.type_ar, t.n, t.ppm
    from types t where t.n >= 10
    order by t.level, t.city_ar, t.district_ar, t.n desc, t.type_ar
  ), gone_rows as (
    select r.*, (r.price is null or r.area_m2 is null
                 or r.platform = min(r.platform) over (partition by r.deal, r.type_ar, r.price, r.area_m2, r.city_ar, r.district_ar)) as own
    from public.map_fact_removal r
    where v_ready and r.left_at >= now() - interval '30 days' and r.city_ar is not null
      and not exists (select 1 from public.ops_default_pin_register d
                      where d.source_table = r.source_table and d.lat = round(r.latitude::numeric, 5) and d.lng = round(r.longitude::numeric, 5))
  ), gone as (
    select case when grouping(g.district_ar) = 1 then 'city' else 'district' end as level, g.city_ar, coalesce(g.district_ar, '') as district_ar, g.deal, count(*) as n
    from gone_rows g where g.own
    group by grouping sets ((g.city_ar, g.deal), (g.city_ar, g.district_ar, g.deal))
  ), cuts as (
    select case when grouping(b.district_ar) = 1 then 'city' else 'district' end as level, b.city_ar, coalesce(b.district_ar, '') as district_ar, count(*) as n
    from _pf_base b
    where v_cuts_ready and b.own and b.deal = 'buy'
      and exists (select 1 from public.listing_price_history h
                  where h.source_table = b.source_table and h.listing_id = b.listing_id and h.event = 'price'
                    and h.at >= now() - interval '30 days' and h.price_total > 0 and h.old_price_total > 0
                    and h.price_total < h.old_price_total and h.price_total >= h.old_price_total * 0.5)
    group by grouping sets ((b.city_ar), (b.city_ar, b.district_ar))
  )
  insert into public.map_place_facts (level, city_ar, district_ar, deal, n_ads, new30, gone30, cuts30, top_type, top_ppm, top_ppm_n, built_at)
  select c.level, c.city_ar, c.district_ar, c.deal, c.n_ads, c.new30,
         case when v_ready then coalesce(g.n, 0) end,
         case when v_cuts_ready and c.deal = 'buy' then coalesce(k.n, 0) end,
         case when c.deal = 'buy' and t.ppm between 10 and 200000 then t.type_ar end,
         case when c.deal = 'buy' and t.ppm between 10 and 200000 then round(t.ppm)::bigint end,
         case when c.deal = 'buy' and t.ppm between 10 and 200000 then t.n end,
         now()
  from counts c
  left join top t on t.level = c.level and t.city_ar = c.city_ar and t.district_ar = c.district_ar
  left join gone g on g.level = c.level and g.city_ar = c.city_ar and g.district_ar = c.district_ar and g.deal = c.deal
  left join cuts k on k.level = c.level and k.city_ar = c.city_ar and k.district_ar = c.district_ar
  where not (c.level = 'district' and c.district_ar = '');
  get diagnostics v_rows = row_count;

  -- «أحياء قريبة» for districts: the 4 nearest districts' median for the district's own top type (same bounds as live)
  update public.map_place_facts p set nb_ppm = x.ppm, nb_names = x.names
  from (select p2.city_ar, p2.district_ar, nb.neighbors as names,
               round(percentile_cont(0.5) within group (order by b.price / b.area_m2))::bigint as ppm, count(*) as n
        from public.map_place_facts p2
        join public.map_district_neighbors nb on nb.city_ar = p2.city_ar and nb.district_ar = p2.district_ar and nb.built_at >= now() - interval '36 hours'
        join _pf_base b on b.city_ar = p2.city_ar and b.district_ar = any (nb.neighbors) and b.type_ar = p2.top_type
                       and b.deal = 'buy' and b.own and b.price > 0 and b.area_m2 > 0
        where p2.level = 'district' and p2.deal = 'buy' and p2.top_type is not null
        group by p2.city_ar, p2.district_ar, nb.neighbors) x
  where p.level = 'district' and p.deal = 'buy' and p.city_ar = x.city_ar and p.district_ar = x.district_ar
    and x.n >= 10 and x.ppm between 10 and 200000 and abs(p.top_ppm - x.ppm) <= 2 * x.ppm;

  -- the check: 5 random districts recounted another way, straight from the index (search_listings_ar)
  for r in select * from public.map_place_facts where level = 'district' and deal = 'buy' order by random() limit 5 loop
    checked := checked + 1;
    select count(*), count(*) filter (where s.posted_at >= now() - interval '30 days' and s.posted_at <= now() + interval '1 day') into n1, n2
    from public.search_listings_ar s
    where s.city_ar = r.city_ar and s.district_ar = r.district_ar and s.deal_ar = 'بيع' and s.latitude is not null and s.longitude is not null
      and not exists (select 1 from public.map_stray_pin st where st.source_table = s.source_table and st.listing_id = s.listing_id)
      and not exists (select 1 from public.ops_default_pin_register d
                      where d.source_table = s.source_table and d.lat = round(s.latitude::numeric, 5) and d.lng = round(s.longitude::numeric, 5));
    -- the index moves every 10 minutes: a recount may differ by a few new ads, never by more than 3% or more than it holds
    if abs(n1 - r.n_ads) > greatest(3, r.n_ads * 0.03) or r.new30 > r.n_ads or r.new30 > n2 + greatest(3, n2 * 0.03) then
      failed := failed + 1;
      ex := ex || jsonb_build_object('city', r.city_ar, 'district', r.district_ar, 'n_ads', r.n_ads, 'recount', n1, 'new30', r.new30, 'new30_raw_recount', n2);
    end if;
  end loop;
  insert into public.map_place_facts_build (rows, checked, failed, examples, ms)
  values (v_rows, checked, failed, ex, extract(milliseconds from clock_timestamp() - v_t0)::int);
  return jsonb_build_object('rows', v_rows, 'checked', checked, 'failed', failed, 'ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end
$function$;
revoke all on function public.map_fact_build_place_facts() from public, anon, authenticated;

-- what the browser calls at area-label zoom: one place, one deal; nothing when switched off, stale or failed its check
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('map_place_facts_ar', '{anon,authenticated}', 'map box at city/district label zoom (owner 2026-11-13): prepared facts for one named place and deal. Read-only STABLE; a guest gets only yes/no flags.')
on conflict do nothing;
create or replace function public.map_place_facts_ar(p_level text, p_city text, p_district text default null, p_deals text[] default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare r record; b record;
begin
  if not coalesce((select ff.enabled from public.ops_feature_flags ff where ff.name = 'map_view_facts'), false) then return null; end if;
  if p_level not in ('city', 'district') or p_city is null or p_deals is null or cardinality(p_deals) <> 1 then return null; end if;
  select * into b from public.map_place_facts_build order by built_at desc limit 1;
  if b.built_at is null or b.built_at < now() - interval '3 hours' or b.failed > 0 then return null; end if;
  select * into r from public.map_place_facts pf
   where pf.level = p_level and pf.city_ar = p_city and pf.district_ar = coalesce(p_district, '') and pf.deal = p_deals[1];
  if not found then return null; end if;
  if auth.uid() is null then
    return jsonb_build_object('locked', true, 'any', r.n_ads, 'place', true,
      'has_new', r.new30 > 0, 'has_gone', coalesce(r.gone30, 0) > 0, 'has_ppm', r.top_ppm is not null,
      'has_cmp', r.nb_ppm is not null, 'has_cuts', coalesce(r.cuts30, 0) > 0);
  end if;
  return jsonb_build_object('any', r.n_ads, 'place', true, 'new30', r.new30, 'gone30', r.gone30, 'cuts30', r.cuts30,
    'top_type', r.top_type, 'top_ppm', r.top_ppm, 'nb_ppm', r.nb_ppm, 'nb_names', to_jsonb(r.nb_names),
    'nb_kind', case when r.nb_ppm is not null then 'near' end, 'city_ar', r.city_ar, 'updated_at', r.built_at);
end;
$function$;
revoke all on function public.map_place_facts_ar(text, text, text, text[]) from public;
grant execute on function public.map_place_facts_ar(text, text, text, text[]) to anon, authenticated;

-- hourly, as one more step of bundle-hourly-monitors (:43) — every minute of the hour already starts its two allowed
-- jobs (scripts/verify-cron-slot-discipline.ts); a bundle step gets its own subtransaction and its own P1 on failure
select cron.schedule('bundle-hourly-monitors', '43 * * * *', $cmd$set statement_timeout to '900s'; select public.ops_run_cron_bundle('bundle-hourly-monitors',
  $s$select public.mon_detect_remediation_worker_stale()$s$,
  $s$select public.mon_detect_alert_flapping()$s$,
  $s$select public.mon_check_normal_filter_barrier()$s$,
  $s$select public.detect_novel_property_types()$s$,
  $s$select public.mon_scan_pii_capture_batch(15000)$s$,
  $s$select public.mon_af_predicate_parity()$s$,
  $s$select public.mon_detect_cron_starvation_risk()$s$,
  $s$select public.mon_detect_wasalt_enrich_backlog()$s$,
  $s$select public.mon_detect_sync_ran_against_stale_snapshot()$s$,
  $s$select public.mon_detect_district_resolution()$s$,
  $s$select public.mon_watchdog_detector_job()$s$,
  $s$select public.mon_check_filter_parity_legacy()$s$,
  $s$select public.mon_resolve_ended_scrape_blocks()$s$,
  $s$select public.mon_detect_search_writer_starved()$s$,
  $s$select public.ops_liveness_snapshot_refresh()$s$,
  $s$select public.mon_detect_aqar_ppm_as_total()$s$,
  $s$select public.map_fact_build_place_facts()$s$,
  $s$select public.trigger_gh_workflow('alert-dispatch.yml')$s$,
  $s$select public.trigger_gh_workflow('migration-drift-guard.yml')$s$,
  $s$select public.trigger_gh_workflow('repair-enrollment-guard.yml')$s$,
  $s$select public.trigger_gh_workflow('af-robot.yml')$s$,
  $s$select public.trigger_gh_workflow('facts-words.yml')$s$,
  $s$select public.trigger_gh_workflow('auto-deploy-merged-fixes.yml')$s$,
  $s$select public.trigger_gh_workflow('site-speed-live.yml')$s$);$cmd$);

-- the alarm also watches the prepared facts: missing, older than 3 h, or a failed check
create or replace function public.mon_detect_map_view_facts()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; a record; nb_at timestamptz; pb record;
begin
  if not exists (select 1 from public.map_fact_capture_run where ok and run_at >= now() - interval '36 hours') then
    live := live || 'map_view_facts:capture_not_run'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:capture_not_run',
      jsonb_build_object('why', 'The nightly removal log for the map box did not run; «اختفى» stops showing after 36 h.',
        'action', 'Check cron job map-view-facts; run select public.map_fact_capture_removals();'));
  end if;
  select max(built_at) into nb_at from public.map_district_neighbors;
  if nb_at is null or nb_at < now() - interval '36 hours' then
    live := live || 'map_view_facts:neighbors_stale'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:neighbors_stale',
      jsonb_build_object('built_at', nb_at, 'why', 'The map box «أحياء قريبة» table is empty or older than 36 h; the comparison is hidden until it is rebuilt.',
        'action', 'Check cron job map-view-facts; run select public.map_fact_build_neighbors();'));
  end if;
  select * into pb from public.map_place_facts_build order by built_at desc limit 1;
  if pb.built_at is null or pb.built_at < now() - interval '3 hours' then
    live := live || 'map_view_facts:place_facts_stale'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:place_facts_stale',
      jsonb_build_object('built_at', pb.built_at, 'why', 'The prepared city/district facts are missing or older than 3 h; the box is hidden at area-label zoom.',
        'action', 'Check cron job map-place-facts; run select public.map_fact_build_place_facts();'));
  elsif pb.failed > 0 then
    live := live || 'map_view_facts:place_facts_check_failed'::text;
    n := n + public.mon_raise('P1', 'map_view_facts', 'fleet', 'map_view_facts:place_facts_check_failed',
      jsonb_build_object('failed', pb.failed, 'checked', pb.checked, 'examples', pb.examples,
        'why', 'The prepared city/district facts failed their own recount; nothing is served at area-label zoom until a clean build.',
        'action', 'Compare map_fact_build_place_facts() with the recount in its examples; fix the builder, never the check.'));
  end if;
  select * into a from public.map_view_facts_audit order by run_at desc limit 1;
  if a.run_at is null or a.run_at < now() - interval '36 hours' then
    live := live || 'map_view_facts:audit_not_run'::text;
    n := n + public.mon_raise('P2', 'map_view_facts', 'fleet', 'map_view_facts:audit_not_run',
      jsonb_build_object('why', 'The independent checker of the map box numbers did not run.',
        'action', 'Check cron job map-view-facts; run select public.audit_map_view_facts();'));
  elsif a.failed > 0 then
    live := live || 'map_view_facts:disagree'::text;
    n := n + public.mon_raise('P1', 'map_view_facts', 'fleet', 'map_view_facts:disagree',
      jsonb_build_object('checked', a.checked, 'failed', a.failed, 'examples', a.examples,
        'why', 'The checker could not reproduce the map box numbers; the facts were switched off before users saw more.',
        'action', 'Compare map_view_facts_core() with audit_map_view_facts() for the examples; fix the builder, never the checker.'));
  end if;
  perform public.mon_resolve_stale_keys('map_view_facts', live);
  return n;
end
$function$;
revoke execute on function public.mon_detect_map_view_facts() from public, anon, authenticated;
