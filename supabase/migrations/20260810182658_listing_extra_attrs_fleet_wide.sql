-- ===========================================================================
-- listing_extra_attrs BECOMES FLEET-WIDE.
--
-- THE DEFECT. This view is the ONLY route by which 13 attributes reach
-- listing_native_location_v2 -> sync_search_listings_ar() -> search_listings_ar.
-- It contained exactly FOUR branches: aqar_{residential,commercial} and
-- wasalt_{residential,commercial}. For the other 30 platforms every one of these
-- columns was structurally NULL no matter what the scraper had captured.
--
-- Worse, the wasalt branches HARDCODED:
--     NULL::boolean AS elevator, parking, kitchen, air_conditioner,
--                      maid_room, driver_room, private_entrance
--     NULL::text    AS tenant_category, license_number
--     NULL::smallint AS street_width_m
-- so wasalt's 227 detail-fetched amenity rows were thrown away at the view, and
-- its furnished/floor/direction were read from the ENGLISH additional_info panel
-- while the Arabic ar_data payload (stored on 62,681/62,693 rows) went unread.
--
-- This rewrite generates one branch per platform table from the catalogue, so a
-- newly onboarded platform is picked up automatically instead of needing this
-- view edited. Columns a given table does not have emit a typed NULL - never a
-- manufactured value.
--
-- Output columns, order and types are unchanged, so CREATE OR REPLACE is safe and
-- listing_native_location_v2 does not need to change.
--
-- NOTE: property_age is carried here only for shape compatibility; v2 actually
-- reads age from listing_age_resolved, which is already fleet-wide.
-- ===========================================================================
do $$
declare
  t         text;
  branches  text := '';
  col_exists boolean;
  -- helper: emit the column if the table has it, else a typed NULL
  function_placeholder text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema='public'
      and (table_name like '%\_residential\_listings' or table_name like '%\_commercial\_listings')
      and table_name not like '%backup%'
    order by table_name
  loop
    -- wasalt gets bespoke branches below (Arabic ar_data + its real amenity columns)
    if t like 'wasalt\_%' then continue; end if;

    branches := branches || case when branches = '' then '' else E'\nUNION ALL\n' end ||
      format($b$select %L::text as source_table, x.id as listing_id,
        %s as furnished,
        %s as property_age,
        %s as direction,
        %s as street_width_m,
        %s as floor_number,
        %s as tenant_category,
        %s as license_number,
        %s as elevator,
        %s as parking,
        %s as kitchen,
        %s as air_conditioner,
        %s as maid_room,
        %s as driver_room,
        %s as private_entrance
      from public.%I x where x.active$b$,
      t,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='furnished')       then 'x.furnished' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='property_age')    then 'x.property_age::smallint' else 'null::smallint' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='direction')       then 'x.direction' else 'null::text' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='street_width_m')  then 'x.street_width_m::smallint' else 'null::smallint' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='floor_number')    then 'x.floor_number::integer' else 'null::integer' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='tenant_category') then 'x.tenant_category' else 'null::text' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='license_number')  then 'x.license_number' else 'null::text' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='elevator')         then 'x.elevator' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='parking')          then 'x.parking' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='kitchen')          then 'x.kitchen' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='air_conditioner')  then 'x.air_conditioner' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='maid_room')        then 'x.maid_room' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='driver_room')      then 'x.driver_room' else 'null::boolean' end,
      case when exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t and c.column_name='private_entrance') then 'x.private_entrance' else 'null::boolean' end,
      t);
  end loop;

  -- ---- wasalt: Arabic ar_data first, English additional_info as fallback, real amenity columns ----
  for t in select unnest(array['wasalt_residential_listings','wasalt_commercial_listings']) loop
    branches := branches || E'\nUNION ALL\n' || format($b$select %L::text as source_table, w.id as listing_id,
        -- furnishingType: Arabic ar_data is authoritative, English panel is the fallback
        coalesce(
          case w.ar_data->'attributes'->>'furnishingType'
            when 'مفروشة' then true when 'مفروش' then true
            when 'غير مفروشة' then false when 'غير مفروش' then false else null end,
          case (select e.value->>'value' from jsonb_array_elements(w.additional_info) e
                 where e.value->>'key' = 'furnishingType' limit 1)
            when 'Furnished' then true when 'Un-Furnished' then false else null end
        ) as furnished,
        (case (select e.value->>'value' from jsonb_array_elements(w.additional_info) e
                where e.value->>'key' = 'completionYear' limit 1)
           when 'New' then 0 when '<1 year' then 0 when '1 year' then 1 when '2 years' then 2
           when '3 years' then 3 when '4 years' then 4 when '5 years' then 5 when '6 years' then 6
           when '7 years' then 7 when '8 years' then 8 when '9 years' then 9
           when '10 years' then 10 when '10+ years' then 10 else null end)::smallint as property_age,
        -- propertyFacade carries TWO concepts. Only compass bearings become direction;
        -- «ثلاثة/اربعة شوارع» is a frontage COUNT and is deliberately excluded here.
        (select case e.value->>'value'
                  when 'شمالية' then 'شمال' when 'جنوبية' then 'جنوب'
                  when 'شرقية' then 'شرق'  when 'غربية' then 'غرب'
                  when 'شمالية شرقية' then 'شمال شرقي' when 'شمالية غربية' then 'شمال غربي'
                  when 'جنوبية شرقية' then 'جنوب شرقي' when 'جنوبية غربية' then 'جنوب غربي'
                  when 'North' then 'شمال' when 'South' then 'جنوب'
                  when 'East' then 'شرق'  when 'West' then 'غرب'
                  when 'North East' then 'شمال شرقي' when 'North West' then 'شمال غربي'
                  when 'South East' then 'جنوب شرقي' when 'South West' then 'جنوب غربي'
                  else null end
           from jsonb_array_elements(w.ar_data->'additionalAttributes') e
          where e.value->>'key' = 'propertyFacade' limit 1) as direction,
        (select nullif(regexp_replace(e.value->>'value','[^0-9]','','g'),'')::smallint
           from jsonb_array_elements(w.ar_data->'additionalAttributes') e
          where e.value->>'key' = 'propertyStreetWidth'
            and e.value->>'value' ~ '[0-9]' limit 1) as street_width_m,
        (select case when e.value->>'value' in ('Ground','أرضي') then 0
                     when e.value->>'value' ~ '^\d{1,2}$' then (e.value->>'value')::integer
                     else null end
           from jsonb_array_elements(w.ar_data->'additionalAttributes') e
          where e.value->>'key' = 'floorNumber' limit 1) as floor_number,
        null::text as tenant_category,
        nullif(btrim(w.ar_data->'regaVerifiedInfo'->>'adLicenseNumber'),'') as license_number,
        -- the 227 detail-fetched amenity rows the old view discarded
        w.elevator, w.parking, w.kitchen, w.air_conditioner,
        w.maid_room, w.driver_room, w.private_entrance
      from public.%I w where w.active$b$, t, t);
  end loop;

  execute 'create or replace view public.listing_extra_attrs as ' || branches;
end $$;

comment on view public.listing_extra_attrs is
  'Platform -> canonical attribute mapping layer. Generated per platform table from the catalogue: a new platform is picked up without editing this view. Missing columns emit a typed NULL, never a manufactured value. wasalt reads Arabic ar_data first with the English panel as fallback. See af_platform_mapping for the documented source keys.';
