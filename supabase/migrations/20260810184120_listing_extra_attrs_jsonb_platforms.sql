-- ===========================================================================
-- MULTI-PLATFORM EXTRACTION: read the jsonb payloads we already store.
--
-- After the fleet-wide rewrite, sanadak / aqarcity / dealapp / aqaratikom / satel
-- still delivered nothing, because the generic branch reads TYPED COLUMNS and all
-- of their structured data lives in jsonb (source_capture / additional_info) that
-- the raw schema has no column for. Their typed columns were also (correctly)
-- NULLed by the Safety Barrier, since the values there were DEFAULT residue.
--
-- No re-scraping: every value below is already in the database.
--
-- Value semantics were read from the live data, not assumed:
--   sanadak kitchenStatus  1='لا'(79) -> false, 2='نعم - راكب'(164) -> true,
--                          3='نعم - تأسيس فقط'(12) -> true (a kitchen exists)
--   sanadak acType         Split/Central/Window/Duct -> true (unit installed);
--                          'SplitFoundationNI' = «تأسيس» (prepped, NO unit) -> false;
--                          'None' -> false. Both are source-published negatives.
--   satel   kitchen        'with-appliances'(164) and 'without-appliances'(47) BOTH
--                          mean a kitchen exists -> true. (I previously called this
--                          a manufactured positive; that was wrong - the value
--                          describes the kitchen, it does not deny one.)
--   satel   furnishing     'Unfurnished' -> false, 'Fully/Partially furnished' -> true
--   satel   ac type        split/both/concealed all mean a system exists -> true
--
-- Directions go through canon_direction_ar() so every platform lands on the same
-- 8 bearings, and anything that is not a bearing becomes NULL.
-- ===========================================================================
do $$
declare t text; branches text := ''; c text;
  special text[] := array['wasalt_residential_listings','wasalt_commercial_listings',
                          'sanadak_residential_listings','sanadak_commercial_listings',
                          'aqarcity_residential_listings','aqarcity_commercial_listings',
                          'dealapp_residential_listings','dealapp_commercial_listings',
                          'aqaratikom_residential_listings','aqaratikom_commercial_listings',
                          'satel_residential_listings'];
begin
  -- ---------- generic: typed columns, catalogue-driven ----------
  for t in
    select table_name from information_schema.tables
    where table_schema='public'
      and (table_name like '%\_residential\_listings' or table_name like '%\_commercial\_listings')
      and table_name not like '%backup%'
    order by table_name
  loop
    if t = any(special) then continue; end if;
    branches := branches || case when branches='' then '' else E'\nUNION ALL\n' end ||
      format($b$select %L::text as source_table, x.id as listing_id, %s as furnished, %s as property_age,
        public.canon_direction_ar(%s) as direction, %s as street_width_m, %s as floor_number,
        %s as tenant_category, %s as license_number, %s as elevator, %s as parking, %s as kitchen,
        %s as air_conditioner, %s as maid_room, %s as driver_room, %s as private_entrance
        from public.%I x where x.active$b$,
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

  -- ---------- wasalt: Arabic ar_data first, English panel fallback ----------
  foreach c in array array['wasalt_residential_listings','wasalt_commercial_listings'] loop
    branches := branches || E'\nUNION ALL\n' || format($b$select %L::text, w.id,
      coalesce(
        case w.ar_data->'attributes'->>'furnishingType'
          when 'مفروشة' then true when 'مفروش' then true
          when 'غير مفروشة' then false when 'غير مفروش' then false else null end,
        case (select e.value->>'value' from jsonb_array_elements(w.additional_info) e
               where e.value->>'key'='furnishingType' limit 1)
          when 'Furnished' then true when 'Un-Furnished' then false else null end),
      (case (select e.value->>'value' from jsonb_array_elements(w.additional_info) e
              where e.value->>'key'='completionYear' limit 1)
         when 'New' then 0 when '<1 year' then 0 when '1 year' then 1 when '2 years' then 2
         when '3 years' then 3 when '4 years' then 4 when '5 years' then 5 when '6 years' then 6
         when '7 years' then 7 when '8 years' then 8 when '9 years' then 9
         when '10 years' then 10 when '10+ years' then 10 else null end)::smallint,
      public.canon_direction_ar((select e.value->>'value' from jsonb_array_elements(w.ar_data->'additionalAttributes') e
                                  where e.value->>'key'='propertyFacade' limit 1)),
      (select nullif(regexp_replace(e.value->>'value','[^0-9]','','g'),'')::smallint
         from jsonb_array_elements(w.ar_data->'additionalAttributes') e
        where e.value->>'key'='propertyStreetWidth' and e.value->>'value' ~ '[0-9]' limit 1),
      (select case when e.value->>'value' in ('Ground','أرضي') then 0
                   when e.value->>'value' ~ '^\d{1,2}$' then (e.value->>'value')::integer else null end
         from jsonb_array_elements(w.ar_data->'additionalAttributes') e
        where e.value->>'key'='floorNumber' limit 1),
      null::text,
      (select nullif(btrim(f.value->>'value'),'')
         from jsonb_array_elements(case when jsonb_typeof(w.ar_data->'regaVerifiedInfo')='array' then w.ar_data->'regaVerifiedInfo' else '[]'::jsonb end) s,
              jsonb_array_elements(case when jsonb_typeof(s.value->'fields')='array' then s.value->'fields' else '[]'::jsonb end) f
        where f.value->>'key'='adLicenseNumber' limit 1),
      w.elevator, w.parking, w.kitchen, w.air_conditioner, w.maid_room, w.driver_room, w.private_entrance
      from public.%I w where w.active$b$, c, c);
  end loop;

  -- ---------- sanadak: rich source_capture ----------
  foreach c in array array['sanadak_residential_listings','sanadak_commercial_listings'] loop
    branches := branches || E'\nUNION ALL\n' || format($b$select %L::text, s.id,
      case s.source_capture->>'isFurnished' when 'true' then true when 'false' then false else null end,
      null::smallint,
      public.canon_direction_ar(s.source_capture->>'propertyFacingDirection'),
      nullif((case when s.source_capture->>'streetWidth' ~ '^[0-9]+(\.[0-9]+)?$'
                   then (s.source_capture->>'streetWidth')::numeric else null end)::smallint, 0),
      case when s.source_capture->>'floorNo' ~ '^[0-9]{1,2}$' then (s.source_capture->>'floorNo')::integer end,
      null::text,
      nullif(btrim(coalesce(s.source_capture->>'advertisementNumber', s.source_capture->>'adNumber','')),''),
      case when s.source_capture->>'numberElevators' ~ '^[0-9]+$'
           then (s.source_capture->>'numberElevators')::int > 0 end,
      case when s.source_capture->>'numberParkingAreas' ~ '^[0-9]+$'
           then (s.source_capture->>'numberParkingAreas')::int > 0 end,
      case s.source_capture->>'kitchenStatus' when '1' then false when '2' then true when '3' then true else null end,
      case s.source_capture->>'acType'
        when 'None' then false when 'SplitFoundationNI' then false
        when 'Split' then true when 'Central' then true when 'Window' then true when 'Duct' then true
        else null end,
      case when s.source_capture->>'numberMaidRooms' ~ '^[0-9]+$'
           then (s.source_capture->>'numberMaidRooms')::int > 0 end,
      case s.source_capture->>'isDriverRoomAvailable' when 'true' then true when 'false' then false else null end,
      null::boolean
      from public.%I s where s.active$b$, c, c);
  end loop;

  -- ---------- aqarcity / dealapp / aqaratikom: additional_info ----------
  foreach c in array array['aqarcity_residential_listings','aqarcity_commercial_listings',
                           'dealapp_residential_listings','dealapp_commercial_listings',
                           'aqaratikom_residential_listings','aqaratikom_commercial_listings'] loop
    branches := branches || E'\nUNION ALL\n' || format($b$select %L::text, a.id,
      null::boolean, null::smallint,
      public.canon_direction_ar(a.additional_info->>'facade'),
      case when coalesce(a.additional_info->>'street_width', a.additional_info->>'street_width_m') ~ '^[0-9]+(\.[0-9]+)?$'
           then (coalesce(a.additional_info->>'street_width', a.additional_info->>'street_width_m'))::numeric::smallint end,
      null::integer, null::text,
      nullif(btrim(coalesce(a.additional_info->>'rega_ad_license_number','')),''),
      a.elevator, a.parking, a.kitchen, a.air_conditioner, a.maid_room, a.driver_room, a.private_entrance
      from public.%I a where a.active$b$, c, c);
  end loop;

  -- ---------- satel: additional_info ----------
  branches := branches || E'\nUNION ALL\n' || $b$select 'satel_residential_listings'::text, t.id,
      case t.additional_info->>'furnishing'
        when 'Unfurnished' then false
        when 'Fully furnished' then true when 'Partially furnished' then true else null end,
      null::smallint, null::text, null::smallint, null::integer, null::text, null::text,
      t.elevator,
      case when nullif(btrim(coalesce(t.additional_info->>'parking_type','')),'') is not null then true else t.parking end,
      case when t.additional_info->>'kitchen' in ('with-appliances','without-appliances') then true else t.kitchen end,
      case when nullif(btrim(coalesce(t.additional_info->>'air_conditioning_type','')),'') is not null then true else t.air_conditioner end,
      t.maid_room, t.driver_room, t.private_entrance
    from public.satel_residential_listings t where t.active$b$;

  execute 'create or replace view public.listing_extra_attrs as ' || branches;
end $$;
