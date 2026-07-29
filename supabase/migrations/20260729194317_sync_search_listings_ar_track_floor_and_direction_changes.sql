-- 2026-07-29: sync_search_listings_ar()'s incremental-sync change-detection (the `exists (select 1
-- from search_listings_ar s3 where ... and (s3.X is distinct from v.X))` clause) never checked
-- floor_number or direction_ar. Confirmed live: after fixing aqar_parse()'s region-fallback bug and
-- backfilling aqar_residential_listings/aqar_commercial_listings directly, calling
-- sync_search_listings_ar() did NOT propagate the correction into search_listings_ar (still showed
-- 7,264 stale/garbage residential floor_number rows, including impossible values like 22000 and 207)
-- because none of the OTHER tracked fields (city_id/region_id/district_ar/production_ready/
-- region_ar/city_ar/deal_ar/price_total/price_annual/area_m2/bedrooms/property_age) happened to
-- change at the same time. Applied a one-off direct UPDATE to fix the already-stale rows; this
-- migration prevents the same silent-propagation-gap from recurring for floor_number/direction_ar
-- specifically. (Other untracked fields -- bathrooms, furnished, tenant_ar, license_number,
-- street_width_m, elevator/parking/kitchen/etc, type_ar, rent_period_ar -- have the same latent gap
-- and are NOT addressed here; flagged separately as a broader follow-up, not fixed in this pass.)
create or replace function public.sync_search_listings_ar()
 returns TABLE(upserted bigint, deleted bigint)
 language plpgsql
as $function$
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
    canon_type_ar(normalize(case
                when t.ar is not null then t.ar
                when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'
                when v.property_type ~ '[A-Za-z]' then 'غير معروف'
                else v.property_type
              end, NFC)),
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
                       or s3.price_total is distinct from v.price_total
                       or s3.price_annual is distinct from v.price_annual
                       or s3.area_m2 is distinct from v.area_m2
                       or s3.bedrooms is distinct from v.bedrooms
                       or s3.property_age is distinct from v.property_age
                       or s3.floor_number is distinct from v.floor_number
                       or s3.direction_ar is distinct from (case when v.direction in ('شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي','شمالية','جنوبية','شرقية','غربية') then v.direction end))))
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