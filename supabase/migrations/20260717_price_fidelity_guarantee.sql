-- ============================================================================
-- Price Fidelity Guarantee (2026-07-16)
-- Ezhalah card price MUST always equal the source-platform price. Never modify,
-- guess, cache-stale, or display outdated prices (legal + trust requirement).
--
-- Three layers make this permanent:
--   1. PROPAGATION  — sync_search_listings_ar() re-syncs a row whenever its
--      price/area/bedrooms/property_age drift from source (v2 mirrors raw),
--      independent of last_updated (which is an unreliable freshness signal).
--   2. NO STALE PATH — the same drift predicate + existing delete anti-join
--      guarantee convergence every hourly sync; steady-state mismatch = 0.
--   3. MONITORING   — price_fidelity() measures search-vs-source price drift;
--      mon_detect_price_fidelity() raises an alert_event (dedup 'price_drift')
--      the moment a systemic mismatch reappears; cron runs it hourly at :45.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PROPAGATION: sync change-detection now watches price/area/bedrooms/age.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_search_listings_ar()
 RETURNS TABLE(upserted bigint, deleted bigint)
 LANGUAGE plpgsql
AS $function$
declare v_upserted bigint; v_deleted bigint; v_since timestamptz; v_del_pending bigint; v_total_now bigint; v_threshold bigint;
begin
  select coalesce(max(last_updated), now() - interval '30 days') - interval '2 hours'
    into v_since from search_listings_ar;
  insert into search_listings_ar (
    source_table, listing_id, platform, last_updated, region_id, city_id, region_ar, city_ar, district_ar,
    deal_ar, type_ar, rent_period_ar, price_total, price_annual, area_m2, bedrooms, bathrooms,
    furnished, property_age, direction_ar, tenant_ar, license_number, street_width_m, floor_number,
    elevator, parking, kitchen, air_conditioner, maid_room, driver_room, private_entrance, production_ready)
  select distinct on (v.source_table, v.listing_id)
    v.source_table, v.listing_id, v.platform, v.last_updated, v.region_id, v.city_id, v.region_ar, v.city_ar, v.district_ar,
    case when lower(v.transaction_type)='buy'  then 'بيع'
         when lower(v.transaction_type)='rent' then 'إيجار' end,
    normalize(case
                when t.ar is not null then t.ar
                when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'
                when v.property_type ~ '[A-Za-z]' then 'غير معروف'
                else v.property_type
              end, NFC),
    case when lower(v.transaction_type)='rent' then
      case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي' else null end end,
    v.price_total, v.price_annual, v.area_m2, v.bedrooms, v.bathrooms,
    case when v.source_table ~ '^(gathern|aqarmonthly)_' then true else v.furnished end,
    v.property_age,
    case when v.direction in ('شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي','شمالية','جنوبية','شرقية','غربية') then v.direction end,
    case when v.tenant_category in ('عزاب','عوائل') then v.tenant_category end,
    v.license_number,
    v.street_width_m, v.floor_number,
    v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance,
    v.production_ready
  from listing_native_location_v2 v
  left join type_label_ar t on t.en = v.property_type
  where lower(v.transaction_type) in ('buy','rent')
    and (v.last_updated is null or v.last_updated > v_since
     or not exists (select 1 from search_listings_ar s2
                    where s2.source_table = v.source_table and s2.listing_id = v.listing_id)
     or exists (select 1 from search_listings_ar s3
                where s3.source_table = v.source_table and s3.listing_id = v.listing_id
                  and (s3.city_id is distinct from v.city_id
                       or s3.region_id is distinct from v.region_id
                       or s3.district_ar is distinct from v.district_ar
                       or s3.production_ready is distinct from v.production_ready
                       or s3.region_ar is distinct from v.region_ar
                       or s3.city_ar is distinct from v.city_ar
                       or s3.deal_ar is distinct from (case when lower(v.transaction_type)='buy'  then 'بيع'
                                                            when lower(v.transaction_type)='rent' then 'إيجار' end)
                       or s3.price_total is distinct from v.price_total    -- [PRICE-FIDELITY 2026-07-16] price is a hard filter + primary display
                       or s3.price_annual is distinct from v.price_annual
                       or s3.area_m2 is distinct from v.area_m2
                       or s3.bedrooms is distinct from v.bedrooms
                       or s3.property_age is distinct from v.property_age)))
  order by v.source_table, v.listing_id, v.last_updated desc nulls last
  on conflict (source_table, listing_id) do update set
    platform=excluded.platform, last_updated=excluded.last_updated, region_id=excluded.region_id,
    city_id=excluded.city_id, region_ar=excluded.region_ar, city_ar=excluded.city_ar,
    district_ar=excluded.district_ar, deal_ar=excluded.deal_ar, type_ar=excluded.type_ar,
    rent_period_ar=excluded.rent_period_ar, price_total=excluded.price_total, price_annual=excluded.price_annual,
    area_m2=excluded.area_m2, bedrooms=excluded.bedrooms, bathrooms=excluded.bathrooms,
    furnished=excluded.furnished, property_age=excluded.property_age, direction_ar=excluded.direction_ar,
    tenant_ar=excluded.tenant_ar, license_number=excluded.license_number,
    street_width_m=excluded.street_width_m, floor_number=excluded.floor_number,
    elevator=excluded.elevator, parking=excluded.parking, kitchen=excluded.kitchen,
    air_conditioner=excluded.air_conditioner, maid_room=excluded.maid_room, driver_room=excluded.driver_room,
    private_entrance=excluded.private_entrance, production_ready=excluded.production_ready;
  get diagnostics v_upserted = row_count;
  select count(*) into v_del_pending from search_listings_ar s
    where not exists (select 1 from listing_native_location_v2 v
                      where v.source_table = s.source_table and v.listing_id = s.listing_id
                        and lower(v.transaction_type) in ('buy','rent'));
  select count(*) into v_total_now from search_listings_ar;
  v_threshold := greatest(2000::bigint, (v_total_now * 15 / 100));
  if v_del_pending > v_threshold then
    insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('sync_delete_circuit_breaker', v_del_pending,
              format('Sync DELETE aborted: %s rows absent from v2 exceed threshold %s (index total %s).', v_del_pending, v_threshold, v_total_now));
    v_deleted := 0;
  else
    delete from search_listings_ar s
      where not exists (select 1 from listing_native_location_v2 v
                        where v.source_table = s.source_table and v.listing_id = s.listing_id
                          and lower(v.transaction_type) in ('buy','rent'));
    get diagnostics v_deleted = row_count;
  end if;
  v_deleted := v_deleted + public.prune_inactive_from_search();
  perform refresh_district_name_bridge();
  perform refresh_city_name_bridge();
  return query select v_upserted, v_deleted;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. MONITORING: measurement + detector (alert_event spine, dedup 'price_drift')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.price_fidelity()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare v_mismatch bigint; v_by_platform jsonb; v_samples jsonb; v_last_sync timestamptz; v_sync_recent boolean;
begin
  with mm as (
    select s.platform
    from public.search_listings_ar s
    join public.listing_native_location_v2 v
      on v.source_table = s.source_table and v.listing_id = s.listing_id
    where s.price_total  is distinct from v.price_total
       or s.price_annual is distinct from v.price_annual
  )
  select count(*), coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb)
    into v_mismatch, v_by_platform
  from (select platform, count(*) cnt from mm group by platform) q;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_samples from (
    select s.source_table, s.listing_id,
           s.price_total as search_price_total, v.price_total as source_price_total,
           s.price_annual as search_price_annual, v.price_annual as source_price_annual
    from public.search_listings_ar s
    join public.listing_native_location_v2 v on v.source_table=s.source_table and v.listing_id=s.listing_id
    where s.price_total is distinct from v.price_total or s.price_annual is distinct from v.price_annual
    limit 10) x;

  select max(end_time) into v_last_sync from cron.job_run_details where jobid = 28 and status = 'succeeded';
  v_sync_recent := v_last_sync is not null and v_last_sync > now() - interval '90 minutes';

  return jsonb_build_object('mismatches', v_mismatch, 'by_platform', v_by_platform, 'samples', v_samples,
    'last_successful_sync_at', v_last_sync, 'sync_recent', v_sync_recent,
    'source_of_truth', 'listing_native_location_v2 (mirrors raw *_listings; price is a hard filter + primary display)',
    'measured_at', now());
end $fn$;

CREATE OR REPLACE FUNCTION public.mon_detect_price_fidelity()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare s jsonb; v_mismatch bigint; v_target text; v_open_sev text; n int := 0;
begin
  s := public.price_fidelity();
  v_mismatch := (s->>'mismatches')::bigint;
  -- Steady-state is 0 (sync converges every hour). A climbing count => the
  -- propagation guarantee regressed (e.g. the price condition dropped from sync).
  -- Thresholds sit above transient in-flight lag, far below the 9,912-row regression class.
  if    v_mismatch > 250 then v_target := 'P1';
  elsif v_mismatch >  25 then v_target := 'P2';
  else  v_target := null; end if;

  select severity into v_open_sev from public.alert_event
   where dedup_key = 'price_drift' and resolved_at is null order by created_at desc limit 1;

  if v_target is null then
    if v_open_sev is not null then perform public.mon_resolve('price_drift','price_fidelity'); end if;
  elsif v_open_sev is distinct from v_target then
    if v_open_sev is not null then perform public.mon_resolve('price_drift','price_fidelity'); end if;
    n := n + public.mon_raise(v_target, 'price_drift', 'price_fidelity', 'price_drift',
      s || jsonb_build_object('why','Ezhalah card price diverged from the source platform price; search is serving stale/incorrect prices. Source of truth = raw listing via listing_native_location_v2.'));
  end if;
  return n;
end $fn$;

-- ---------------------------------------------------------------------------
-- Schedule the detector hourly at :45 (30 min after the :15 search sync, jobid 28).
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  PERFORM cron.unschedule('mon-price-fidelity');
EXCEPTION WHEN OTHERS THEN NULL;
END $cron$;
SELECT cron.schedule('mon-price-fidelity', '45 * * * *', $$select public.mon_detect_price_fidelity();$$);
