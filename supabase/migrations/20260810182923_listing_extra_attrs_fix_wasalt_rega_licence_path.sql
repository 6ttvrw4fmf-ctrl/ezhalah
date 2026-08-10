-- Correct the wasalt REGA licence extraction.
--
-- I had assumed regaVerifiedInfo was an object carrying adLicenseNumber. It is not:
-- it is an ARRAY of sections, each with a `fields` array of {key,label,value}. The
-- wrong path silently produced 0 licences for 11,859 rows that carry one - which is
-- exactly why af_platform_mapping records the precise source key, and why coverage
-- is measured after every mapping change instead of assumed.
--
-- Regenerates the whole view (identical shape) so the generic branches stay
-- catalogue-driven and a new platform is picked up without editing this file.
do $$
declare t text; branches text := ''; c text;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema='public'
      and (table_name like '%\_residential\_listings' or table_name like '%\_commercial\_listings')
      and table_name not like '%backup%'
    order by table_name
  loop
    if t like 'wasalt\_%' then continue; end if;
    branches := branches || case when branches='' then '' else E'\nUNION ALL\n' end ||
      format($b$select %L::text as source_table, x.id as listing_id, %s as furnished, %s as property_age,
        %s as direction, %s as street_width_m, %s as floor_number, %s as tenant_category, %s as license_number,
        %s as elevator, %s as parking, %s as kitchen, %s as air_conditioner, %s as maid_room, %s as driver_room,
        %s as private_entrance from public.%I x where x.active$b$,
      t,
      (select case when count(*)>0 then 'x.furnished'                else 'null::boolean'  end from information_schema.columns where table_schema='public' and table_name=t and column_name='furnished'),
      (select case when count(*)>0 then 'x.property_age::smallint'   else 'null::smallint' end from information_schema.columns where table_schema='public' and table_name=t and column_name='property_age'),
      (select case when count(*)>0 then 'x.direction'                else 'null::text'     end from information_schema.columns where table_schema='public' and table_name=t and column_name='direction'),
      (select case when count(*)>0 then 'x.street_width_m::smallint' else 'null::smallint' end from information_schema.columns where table_schema='public' and table_name=t and column_name='street_width_m'),
      (select case when count(*)>0 then 'x.floor_number::integer'    else 'null::integer'  end from information_schema.columns where table_schema='public' and table_name=t and column_name='floor_number'),
      (select case when count(*)>0 then 'x.tenant_category'          else 'null::text'     end from information_schema.columns where table_schema='public' and table_name=t and column_name='tenant_category'),
      (select case when count(*)>0 then 'x.license_number'           else 'null::text'     end from information_schema.columns where table_schema='public' and table_name=t and column_name='license_number'),
      (select case when count(*)>0 then 'x.elevator'         else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='elevator'),
      (select case when count(*)>0 then 'x.parking'          else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='parking'),
      (select case when count(*)>0 then 'x.kitchen'          else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='kitchen'),
      (select case when count(*)>0 then 'x.air_conditioner'  else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='air_conditioner'),
      (select case when count(*)>0 then 'x.maid_room'        else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='maid_room'),
      (select case when count(*)>0 then 'x.driver_room'      else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='driver_room'),
      (select case when count(*)>0 then 'x.private_entrance' else 'null::boolean' end from information_schema.columns where table_schema='public' and table_name=t and column_name='private_entrance'),
      t);
  end loop;

  foreach c in array array['wasalt_residential_listings','wasalt_commercial_listings'] loop
    branches := branches || E'\nUNION ALL\n' || format($b$select %L::text as source_table, w.id as listing_id,
        coalesce(
          case w.ar_data->'attributes'->>'furnishingType'
            when 'مفروشة' then true when 'مفروش' then true
            when 'غير مفروشة' then false when 'غير مفروش' then false else null end,
          case (select e.value->>'value' from jsonb_array_elements(w.additional_info) e
                 where e.value->>'key'='furnishingType' limit 1)
            when 'Furnished' then true when 'Un-Furnished' then false else null end) as furnished,
        (case (select e.value->>'value' from jsonb_array_elements(w.additional_info) e
                where e.value->>'key'='completionYear' limit 1)
           when 'New' then 0 when '<1 year' then 0 when '1 year' then 1 when '2 years' then 2
           when '3 years' then 3 when '4 years' then 4 when '5 years' then 5 when '6 years' then 6
           when '7 years' then 7 when '8 years' then 8 when '9 years' then 9
           when '10 years' then 10 when '10+ years' then 10 else null end)::smallint as property_age,
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
          where e.value->>'key'='propertyFacade' limit 1) as direction,
        (select nullif(regexp_replace(e.value->>'value','[^0-9]','','g'),'')::smallint
           from jsonb_array_elements(w.ar_data->'additionalAttributes') e
          where e.value->>'key'='propertyStreetWidth' and e.value->>'value' ~ '[0-9]' limit 1) as street_width_m,
        (select case when e.value->>'value' in ('Ground','أرضي') then 0
                     when e.value->>'value' ~ '^\d{1,2}$' then (e.value->>'value')::integer else null end
           from jsonb_array_elements(w.ar_data->'additionalAttributes') e
          where e.value->>'key'='floorNumber' limit 1) as floor_number,
        null::text as tenant_category,
        (select nullif(btrim(f.value->>'value'),'')
           from jsonb_array_elements(case when jsonb_typeof(w.ar_data->'regaVerifiedInfo')='array'
                                          then w.ar_data->'regaVerifiedInfo' else '[]'::jsonb end) s,
                jsonb_array_elements(case when jsonb_typeof(s.value->'fields')='array'
                                          then s.value->'fields' else '[]'::jsonb end) f
          where f.value->>'key'='adLicenseNumber' limit 1) as license_number,
        w.elevator, w.parking, w.kitchen, w.air_conditioner,
        w.maid_room, w.driver_room, w.private_entrance
      from public.%I w where w.active$b$, c, c);
  end loop;

  execute 'create or replace view public.listing_extra_attrs as ' || branches;
end $$;
