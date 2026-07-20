-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260716202131, name 'dealapp_district_resolver_and_monitor'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 b90e53a2c50c8d989d0805e4f5e0f2a1).

-- Owner PERMANENT fix (2026-07-16): dealapp stores district names in ENGLISH ("Al Awali Dist.")
-- but the resolver that handles dealapp (resolve_english_city_overlay) only ever set city_ar/region_ar,
-- never a district — so ~2,342 production_ready dealapp listings were searchable but carried NO district
-- and were unreachable by any district filter. aqar works only because its neighborhoods are already
-- Arabic (Arabic-to-Arabic catalog match). This adds a dedicated, idempotent, recurring resolver that
-- converts dealapp's English neighborhood to the CANONICAL Arabic district under the STRICT hierarchy
-- Region -> City -> District, never guessing.

-- 1) English-district normalizer: lower, strip a trailing " Dist."/"District"/"Subdivision Plan"
--    marker, hyphens/underscores -> space, strip a leading Arabic-transliteration article (al/an/ash/...),
--    collapse whitespace. Mirrors norm_en_place's article stripping but adds the district-suffix handling
--    that dealapp/aqar English forms carry. IMMUTABLE so it can be used in joins.
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

-- 2) The resolver. For every dealapp listing that is production_ready (city already resolved) but has no
--    district in the search index, it:
--      a) reads the RAW English neighborhood from the dealapp source table,
--      b) finds candidate Arabic districts via the learned district_name_bridge (English -> Arabic),
--      c) CONFIRMS each candidate exists in the authoritative loc_catalog_district FOR THIS ROW'S OWN
--         city_id (city-scoped: this is what guarantees "never match a district without confirming its
--         city" and "never guess when the same district name exists in multiple cities"),
--      d) assigns ONLY when exactly ONE distinct catalogued district results (else leaves it NULL —
--         ambiguous/unmatched stays honestly unresolved),
--      e) upserts raw_district + district_ar into listings_arabic_locations (the same overlay table the
--         city resolver writes), so the normal v1 -> v2 -> sync_search_listings_ar pipeline carries it
--         into the search index automatically. Idempotent: safe to run repeatedly; it backfills on first
--         run and keeps NEW dealapp listings resolved on every scheduled run.
CREATE OR REPLACE FUNCTION public.resolve_dealapp_districts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare tbl text; total int := 0; n int;
begin
  -- Precompute English-normalized -> (city_id, district_ar) map, confirmed against the authoritative
  -- catalog. Built once per call into a temp table for speed.
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
        -- one row per listing, ONLY where the (neighborhood, city) maps to exactly ONE catalogued district
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

-- 3) MONITORING (requirement 8): extend the hourly location_pipeline_monitor so a NEW dealapp listing
--    can never silently stay district-less again. Alert when production_ready dealapp rows lack a district
--    DESPITE a catalogued match being available (i.e. the resolver should have caught them but hasn't —
--    a stalled/failed resolver or a regression), and add the resolver's cron job to the health check.
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

  -- NEW: dealapp district-resolution gap — production_ready dealapp rows with NO district that DO have a
  -- unique catalogued match available (so they SHOULD be resolved). >0 means the resolver stalled/failed
  -- or a new bridge/catalog case regressed. Rows with no catalogued match are correctly excluded (they are
  -- honest-NULL, not a defect).
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
