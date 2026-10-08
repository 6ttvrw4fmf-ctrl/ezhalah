-- New Listings Engineer, 2026-10-08 (owner order 10-07 22:32 UTC): an English-city arrival must carry
-- its city (and its district) on its FIRST search-index sync.
--
-- Measured: the hourly chain is :10 district recovery (job 45) -> :20 v1/active matviews (job 17) ->
-- :22 sync (job 28) -> :50 English-city overlay (job 35). The overlay reads its candidates FROM
-- search_listings_ar, so an arrival at 05:16 (arkaan 16136653 «Hofuf», muktamel 16138487 «Riyadh») is
-- served city-less at 05:22, gets its city row at 05:50, reaches v1 at 06:20 and search at 06:22; job
-- 45 needs v1's city, so its district is recovered at 07:10 and served at 07:22. Two hours unfindable
-- by district, 1-2 h by city (3,468 wasalt rows on 10-07 22:35 UTC).
--
-- Fix, inside job 17 (it already holds the location-pipeline lock the sync waits on):
--   1. resolve_english_city_before_sync(): the SAME pin as the overlay (one canonical city, unique
--      inside the region loc_city_map assigns) on raw rows scraped in the last 3 days with no matched
--      city yet, whether or not they are in search - BEFORE the matviews refresh;
--   2. refresh_district_recovery() right AFTER listing_native_location_v1 refreshes, so the :22 sync
--      reads a district recovered from this hour's v1. Job 45 (:10) and job 35 (:50) stay as backstops.
-- mon_detect_english_city_arrival_lag() pages if a served row older than 70 min still has no city
-- although its English city pins uniquely.
CREATE OR REPLACE FUNCTION public.resolve_english_city_before_sync()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t record; total int := 0; n int;
begin
  for t in
    select tb.table_name tn from information_schema.tables tb
    where tb.table_schema='public' and tb.table_name like '%\_listings'
      and tb.table_name not like 'deal\_%' and tb.table_name !~ '^aqar_' and tb.table_type='BASE TABLE'
      and (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=tb.table_name
            and c.column_name in ('id','city','active','scraped_at','transaction_type')) = 5
  loop
    begin
      execute format($q$
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
        select %2$L||':'||r.id::text, regexp_replace(%2$L, '_(residential|commercial)_listings$', ''), %2$L, r.id,
               case when lower(r.transaction_type)='buy' then 'buy' else 'rent' end,
               btrim(r.city), pin.city_ar, pin.region_ar, true, 'english_map_overlay'
        from public.%1$I r
        join lateral (
          select min(cc.city_ar) as city_ar, min(cr.region_ar) as region_ar
          from public.loc_city_map cm
          join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
          join public.loc_catalog_city cc on cc.region_id = cr.region_id
               and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
                    or exists (select 1 from public.loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
          where cm.city_key = lower(btrim(r.city))
          having count(distinct cc.city_id) = 1
        ) pin on true
        where r.active
          and r.scraped_at > now() - interval '3 days'
          and r.city ~ '[A-Za-z]'
          and lower(r.transaction_type) in ('buy','rent')
          and not exists (select 1 from public.search_listings_ar s
                          where s.source_table = %2$L and s.listing_id = r.id and s.city_id is not null)
          and not exists (select 1 from public.listings_arabic_locations l
                          where l.index_id = %2$L||':'||r.id::text and l.matched and l.city_ar is not null)
        on conflict (index_id) do update
          set city_ar = excluded.city_ar, region_ar = excluded.region_ar, raw_city_en = excluded.raw_city_en,
              matched = true, review_reason = 'english_map_overlay'
          where public.listings_arabic_locations.city_ar is null or public.listings_arabic_locations.matched is not true
      $q$, t.tn, t.tn);
      get diagnostics n = row_count;
      total := total + n;
    exception when others then null;
    end;
  end loop;
  return total;
end $function$;

create or replace function public.mon_detect_english_city_arrival_lag()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_bad bigint := 0; v_one bigint; t record; v_ex jsonb := '[]'::jsonb;
begin
  for t in
    select distinct s.source_table tn from public.search_listings_ar s
    where s.city_id is null and s.first_seen_at > now() - interval '3 days'
      and s.first_seen_at < now() - interval '70 minutes'
      and exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=s.source_table and c.column_name='city')
  loop
    execute format($q$
      select count(*) from public.search_listings_ar s
      join public.%1$I r on r.id = s.listing_id
      where s.source_table = %1$L and s.city_id is null
        and s.first_seen_at > now() - interval '3 days' and s.first_seen_at < now() - interval '70 minutes'
        and r.city ~ '[A-Za-z]'
        and (select count(distinct cc.city_id)
               from public.loc_city_map cm
               join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
               join public.loc_catalog_city cc on cc.region_id = cr.region_id
                    and (normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
                         or exists (select 1 from public.loc_catalog_city_alias al where al.alias_norm = normalize_ar(cm.city_ar) and al.city_id = cc.city_id))
              where cm.city_key = lower(btrim(r.city))) = 1
    $q$, t.tn) into v_one;
    if v_one > 0 then
      v_bad := v_bad + v_one;
      v_ex := v_ex || jsonb_build_object('table', t.tn, 'rows', v_one);
    end if;
  end loop;

  if v_bad > 0 then
    live := live || 'english_city_arrival_lag:unresolved'::text;
    n := n + public.mon_raise('P1', 'english_city_arrival_lag', 'fleet', 'english_city_arrival_lag:unresolved',
      jsonb_build_object('rows', v_bad, 'by_table', v_ex,
        'why', 'Served arrivals older than 70 min still have no city although their English city has one unique catalog pin: no customer can find them by city.',
        'action', 'Job 17 must run resolve_english_city_before_sync() before its matview refresh; check it ran and that the table has id/city/active/scraped_at/transaction_type.'));
  end if;
  perform public.mon_resolve_stale_keys('english_city_arrival_lag', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_english_city_arrival_lag' in src) > 0 then
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',',
    E'    ''mon_detect_aldarim_saas_unfilled_block_false'',\n    ''mon_detect_english_city_arrival_lag'',');
  if out_def = src then
    raise exception 'roster anchor not found';
  end if;
  execute out_def;
end $$;

do $$
declare cmd text; out_cmd text;
begin
  select command into cmd from cron.job where jobid = 17;
  if position('resolve_english_city_before_sync' in cmd) > 0 then
    return;
  end if;
  out_cmd := replace(cmd,
    'select pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh'')); set statement_timeout to ''900s''; ',
    'select pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh'')); set statement_timeout to ''900s''; select public.resolve_english_city_before_sync(); ');
  out_cmd := replace(out_cmd,
    'analyze public.listing_native_location_v1; ',
    'analyze public.listing_native_location_v1; select public.refresh_district_recovery(); ');
  if out_cmd = cmd or position('resolve_english_city_before_sync' in out_cmd) = 0
     or position('refresh_district_recovery' in out_cmd) = 0 then
    raise exception 'job 17 anchors not found - refusing to guess';
  end if;
  perform cron.alter_job(17, command => out_cmd);
end $$;

do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobid = 17;
  if position('resolve_english_city_before_sync' in cmd) = 0
     or position('resolve_english_city_before_sync' in cmd) > position('refresh materialized view concurrently public.active_listing_ids_v2' in cmd)
     or position('refresh_district_recovery' in cmd) < position('refresh materialized view concurrently public.listing_native_location_v1' in cmd) then
    raise exception 'job 17 does not resolve English cities before, and districts after, the v1 refresh';
  end if;
  if position('mon_detect_english_city_arrival_lag' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'detector not in roster';
  end if;
end $$;
