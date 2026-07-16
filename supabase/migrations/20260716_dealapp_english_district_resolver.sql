-- Owner PERMANENT fix (2026-07-16): DealApp English-neighborhood -> canonical Arabic district.
--
-- ROOT CAUSE: DealApp stores district names in ENGLISH ("Al Awali Dist."). The recurring resolver that
-- handles DealApp (resolve_english_city_overlay) only ever set city_ar/region_ar, never a district. aqar
-- works only because its neighborhoods are already Arabic (Arabic-to-Arabic catalog match). Result:
-- ~2,342 production_ready DealApp listings were searchable but carried NO district and were unreachable
-- by any district filter.
--
-- FIX: a dedicated, idempotent, recurring resolver that converts DealApp's English neighborhood to the
-- canonical Arabic district under the STRICT hierarchy Region -> City -> District, never guessing:
--   * English neighborhood -> Arabic via the learned district_name_bridge,
--   * CONFIRMED against the authoritative loc_catalog_district for the row's OWN city_id (city-scoped:
--     this enforces "never match a district without confirming its city" AND "never guess when the same
--     district name exists in multiple cities"),
--   * assigns ONLY when exactly ONE distinct catalogued district results, else leaves it NULL (ambiguous
--     / unmatched stays honestly unresolved),
--   * writes into listings_arabic_locations, so the normal v1 -> v2 -> sync_search_listings_ar pipeline
--     carries it into the search index automatically.
--
-- Applied to production 2026-07-16: backfilled 1,394 listings (0 wrong-city, 0 ambiguous, verified via
-- the live anon endpoint); DealApp district coverage 40 -> 1,434. Scheduled every 10 min (jobid 41,
-- 'resolve-dealapp-districts', '3-59/10 * * * *') so NEW DealApp listings auto-resolve. Monitoring added
-- to location_pipeline_monitor: alerts if any production_ready DealApp row lacks a district despite a
-- unique catalogued match being available (silent-gap alarm), and the resolver's cron is health-checked.

-- 1) English-district normalizer.
CREATE OR REPLACE FUNCTION public.norm_en_district(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(t,'')), '\s*(dist\.?|district)\s*$', '', 'g'),
      '[-_]', ' ', 'g'),
    '^(al|an|ash|ad|as|ar|az|at)\s+', '', 'g'),
  '\s+', ' ', 'g'));
$$;

-- 2) The recurring resolver (idempotent; backfills on first run, keeps new listings resolved thereafter).
CREATE OR REPLACE FUNCTION public.resolve_dealapp_districts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare tbl text; total int := 0; n int;
begin
  drop table if exists _dealapp_en2cat;
  create temporary table _dealapp_en2cat on commit drop as
  select distinct norm_en_district(b.district_en) as en_norm, lc.city_id, lc.district_ar
  from district_name_bridge b
  join loc_catalog_district lc on lc.district_norm = normalize_ar(b.district_ar)
  where b.district_en !~ '[ء-ي]' and norm_en_district(b.district_en) <> '';
  create index on _dealapp_en2cat(en_norm, city_id);

  foreach tbl in array array['dealapp_residential_listings','dealapp_commercial_listings']
  loop
    execute format($q$
      with gap as (
        select r.id, s.city_id, s.platform, s.deal_ar, r.neighborhood,
               norm_en_district(r.neighborhood) as nb_norm
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and s.production_ready
          and (s.district_ar is null or btrim(s.district_ar) = '')
          and r.neighborhood is not null and btrim(r.neighborhood) <> ''
      ),
      resolved as (
        select g.id, g.city_id, g.platform, g.deal_ar, g.neighborhood,
               min(m.district_ar) as district_ar, count(distinct m.district_ar) as n_cat
        from gap g
        join _dealapp_en2cat m on m.en_norm = g.nb_norm and m.city_id = g.city_id
        where g.nb_norm <> ''
        group by g.id, g.city_id, g.platform, g.deal_ar, g.neighborhood
        having count(distinct m.district_ar) = 1
      ),
      ins as (
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose, raw_district, district_ar, matched, review_reason)
        select %2$L||':'||x.id::text, x.platform, %2$L, x.id,
               case when x.deal_ar='بيع' then 'buy' else 'rent' end,
               x.neighborhood, x.district_ar, true, 'dealapp_english_district'
        from resolved x
        on conflict (index_id) do update
          set raw_district = excluded.raw_district,
              district_ar  = excluded.district_ar,
              matched      = true,
              review_reason= 'dealapp_english_district'
          where public.listings_arabic_locations.district_ar is distinct from excluded.district_ar
        returning 1
      )
      select count(*) from ins
    $q$, tbl, tbl) into n;
    total := total + coalesce(n,0);
  end loop;
  return total;
end $$;

-- 3) Monitoring: extend location_pipeline_monitor with the DealApp district-gap alarm + cron health.
CREATE OR REPLACE FUNCTION public.location_pipeline_monitor()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_drift bigint; v_dup bigint; v_deal_gap bigint;
begin
  select count(*) into v_drift from search_listings_ar s
    join listing_native_location_v2 v on v.source_table=s.source_table and v.listing_id=s.listing_id
    where s.city_id is distinct from v.city_id or s.region_id is distinct from v.region_id
       or s.district_ar is distinct from v.district_ar or s.production_ready is distinct from v.production_ready;
  if v_drift > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('search_v2_drift', v_drift, 'search index disagrees with resolver (v2) on location for '||v_drift||' row(s)');
  end if;

  select count(*) into v_dup from (select source_table, listing_id from listing_native_location_v2 group by 1,2 having count(*)>1) d;
  if v_dup > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('v2_duplicate_pk', v_dup, 'listing_native_location_v2 emits '||v_dup||' duplicate (source_table,listing_id) row(s)');
  end if;

  with gap as (
    select s.source_table, s.listing_id, s.city_id, r.neighborhood
    from search_listings_ar s
    join dealapp_residential_listings r on r.id = s.listing_id and s.source_table='dealapp_residential_listings'
    where s.production_ready and (s.district_ar is null or btrim(s.district_ar)='')
      and r.neighborhood is not null and btrim(r.neighborhood)<>''
    union all
    select s.source_table, s.listing_id, s.city_id, r.neighborhood
    from search_listings_ar s
    join dealapp_commercial_listings r on r.id = s.listing_id and s.source_table='dealapp_commercial_listings'
    where s.production_ready and (s.district_ar is null or btrim(s.district_ar)='')
      and r.neighborhood is not null and btrim(r.neighborhood)<>''
  ),
  resolvable as (
    select g.source_table, g.listing_id
    from gap g
    join district_name_bridge b on norm_en_district(b.district_en) = norm_en_district(g.neighborhood) and b.district_en !~ '[ء-ي]'
    join loc_catalog_district lc on lc.city_id = g.city_id and lc.district_norm = normalize_ar(b.district_ar)
    group by g.source_table, g.listing_id
    having count(distinct lc.district_ar) = 1
  )
  select count(*) into v_deal_gap from resolvable;
  if v_deal_gap > 0 then
    insert into location_pipeline_alerts(alert_type, metric, detail)
      values ('dealapp_district_unresolved', v_deal_gap, v_deal_gap||' production_ready dealapp listing(s) lack a district despite a unique catalogued match — resolver may be stalled');
  end if;

  insert into location_pipeline_alerts(alert_type, metric, detail)
  select 'cron_job_unhealthy', j.jobid,
         'jobid '||j.jobid||' ('||j.jobname||') last status='||coalesce(r.status,'never run')||' ended '||coalesce(r.end_time::text,'n/a')
  from cron.job j
  left join lateral (select status, end_time from cron.job_run_details d where d.jobid=j.jobid order by start_time desc limit 1) r on true
  where j.jobname in ('refresh_listing_native_location_v1','resolve-aqar-locations','sync-search-listings-ar','resolve-dealapp-districts')
    and (r.status is distinct from 'succeeded' or r.end_time < now() - interval '150 minutes');
end $$;

-- 4) Schedule the resolver every 10 min (offset +3 so the city overlay resolves the city first).
--    Guarded so a repeat apply is a no-op.
do $do$
begin
  if not exists (select 1 from cron.job where jobname='resolve-dealapp-districts') then
    perform cron.schedule('resolve-dealapp-districts', '3-59/10 * * * *', 'select public.resolve_dealapp_districts();');
  end if;
end $do$;
