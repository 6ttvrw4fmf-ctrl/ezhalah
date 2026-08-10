-- ===========================================================================
-- RICH ATTRIBUTE MAPPING LAYER.
--
-- The 26 rich columns on search_listings_ar exist but are empty. This view maps
-- each platform's published value onto them, from data ALREADY STORED (ar_data /
-- source_capture / additional_info / typed columns). No re-scraping.
--
-- Concepts stay apart, per af_field_registry.concept_note:
--   air_conditioner (availability)   vs  ac_type
--   parking (availability)           vs  parking_count  vs  parking_type
--   kitchen (boolean)                vs  kitchen_status
--   furnished (boolean)              vs  furnishing_level
--   direction_ar (compass)           vs  frontage_count
--   living_rooms (صالة)              vs  majlis_rooms (مجلس)
--   floor_number (unit)              vs  total_floors (building)
--
-- INSTALMENTS - the rule that matters most:
--   installment_available is TRUE only where the SOURCE published an offer.
--   wasalt's monthlyRentEMI is a CALCULATOR quote (annual rent x1.10/1.13/1.15 / 12,
--   sigma 0.006, enable-flags null on all 8,577 rows) and is deliberately NOT read
--   here. Treating it as an offer would manufacture 8,577 false positives.
--   An annual lease payable in instalments stays إيجار/سنوي - this view never
--   touches rent_period_ar.
create or replace view public.listing_rich_attrs as
-- ---------------- aqar ----------------
select 'aqar_residential_listings'::text as source_table, a.id as listing_id,
  null::text as ac_type,
  null::text as kitchen_status,
  null::text as furnishing_level,
  null::smallint as parking_count,
  null::text as parking_type,
  a.rent_now_pay_later as installment_available,
  case when a.rent_now_pay_later then a.rent_now_pay_later_monthly::numeric end as installment_amount,
  null::smallint as installment_count,
  a.separate_electricity_meter, a.separate_water_meter,
  a.electricity, a.water_supply, a.sanitation,
  a.balcony_terrace as balcony, a.laundry_room,
  null::boolean as pool, null::boolean as gym, null::boolean as garden,
  a.halls::smallint as living_rooms,
  a.reception_rooms_majlis::smallint as majlis_rooms,
  null::smallint as total_floors,
  null::smallint as frontage_count,
  null::numeric as latitude, null::numeric as longitude,
  null::text as rega_license_status,
  nullif(btrim(coalesce(a.zip_code,'')),'') as postal_code
from public.aqar_residential_listings a where a.active

union all
-- ---------------- wasalt: ar_data ----------------
select 'wasalt_residential_listings', w.id,
  null::text,
  null::text,
  case w.ar_data->'attributes'->>'furnishingType'
    when 'مفروشة' then 'مفروش بالكامل' when 'مفروش' then 'مفروش بالكامل'
    when 'غير مفروشة' then 'غير مفروش' when 'غير مفروش' then 'غير مفروش'
    when 'مفروشة جزئيا' then 'مفروش جزئيا' else null end,
  (select nullif(regexp_replace(e.value->>'value','[^0-9]','','g'),'')::smallint
     from jsonb_array_elements(w.ar_data->'additionalAttributes') e
    where e.value->>'key'='noOfParkings' and e.value->>'value' ~ '[0-9]' limit 1),
  null::text,
  null::boolean,                              -- wasalt EMI is a calculator, NOT an offer
  null::numeric, null::smallint,
  (select case e.value->>'value' when 'نعم' then true when 'لا' then false end
     from jsonb_array_elements(w.ar_data->'additionalAttributes') e
    where e.value->>'key'='electricityMeter' limit 1),
  (select case e.value->>'value' when 'نعم' then true when 'لا' then false end
     from jsonb_array_elements(w.ar_data->'additionalAttributes') e
    where e.value->>'key'='waterMeter' limit 1),
  null::boolean, null::boolean, null::boolean,
  w.balcony_terrace, w.laundry_room,
  null::boolean, null::boolean, null::boolean,
  (select nullif(regexp_replace(a2.value->>'value','[^0-9]','','g'),'')::smallint
     from jsonb_array_elements(w.ar_data->'attributes') a2
    where a2.value->>'key'='noOfLivingrooms' and a2.value->>'value' ~ '[0-9]' limit 1),
  (select nullif(regexp_replace(a2.value->>'value','[^0-9]','','g'),'')::smallint
     from jsonb_array_elements(w.ar_data->'attributes') a2
    where a2.value->>'key'='noOfGuestrooms' and a2.value->>'value' ~ '[0-9]' limit 1),
  (select nullif(regexp_replace(e.value->>'value','[^0-9]','','g'),'')::smallint
     from jsonb_array_elements(w.ar_data->'additionalAttributes') e
    where e.value->>'key'='noOfFloors' and e.value->>'value' ~ '[0-9]' limit 1),
  -- frontage COUNT: «ثلاثة شوارع» = 3. Never merged into direction_ar.
  (select case e.value->>'value' when 'ثلاثة شوارع' then 3::smallint
                                 when 'اربعة شوارع' then 4::smallint
                                 when 'أربعة شوارع' then 4::smallint end
     from jsonb_array_elements(w.ar_data->'additionalAttributes') e
    where e.value->>'key'='propertyFacade' limit 1),
  case when (w.ar_data->>'latitude')  ~ '^-?[0-9.]+$' then (w.ar_data->>'latitude')::numeric  end,
  case when (w.ar_data->>'longitude') ~ '^-?[0-9.]+$' then (w.ar_data->>'longitude')::numeric end,
  (select nullif(btrim(f.value->>'value'),'')
     from jsonb_array_elements(case when jsonb_typeof(w.ar_data->'regaVerifiedInfo')='array' then w.ar_data->'regaVerifiedInfo' else '[]'::jsonb end) s,
          jsonb_array_elements(case when jsonb_typeof(s.value->'fields')='array' then s.value->'fields' else '[]'::jsonb end) f
    where f.value->>'key'='status' limit 1),
  (select nullif(btrim(e.value->>'value'),'')
     from jsonb_array_elements(w.ar_data->'additionalAttributes') e
    where e.value->>'key'='zipCode' limit 1)
from public.wasalt_residential_listings w where w.active

union all
-- ---------------- sanadak: source_capture ----------------
select 'sanadak_residential_listings', s.id,
  case s.source_capture->>'acType'
    when 'Split' then 'سبليت' when 'Central' then 'مركزي' when 'Window' then 'نافذة'
    when 'Duct' then 'دكت' when 'SplitFoundationNI' then 'تأسيس سبليت' when 'None' then 'لا يوجد' end,
  case s.source_capture->>'kitchenStatus'
    when '1' then 'لا يوجد' when '2' then 'راكب' when '3' then 'تأسيس' end,
  case s.source_capture->>'isFurnished' when 'true' then 'مفروش بالكامل' when 'false' then 'غير مفروش' end,
  case when s.source_capture->>'numberParkingAreas' ~ '^[0-9]+$'
       then (s.source_capture->>'numberParkingAreas')::smallint end,
  null::text,
  null::boolean, null::numeric, null::smallint,
  null::boolean,
  case s.source_capture->>'isSeparateWaterTank' when 'true' then true when 'false' then false end,
  null::boolean, null::boolean, null::boolean,
  null::boolean, null::boolean,
  case s.source_capture->>'isSwimmingPoolAvailable' when 'true' then true when 'false' then false end,
  case s.source_capture->>'isGymAvailable'          when 'true' then true when 'false' then false end,
  case s.source_capture->>'isGardenAvailable'       when 'true' then true when 'false' then false end,
  case when s.source_capture->>'numberLivingRooms' ~ '^[0-9]+$' then (s.source_capture->>'numberLivingRooms')::smallint end,
  case when s.source_capture->>'numberMenGuestRooms' ~ '^[0-9]+$' then (s.source_capture->>'numberMenGuestRooms')::smallint end,
  null::smallint, null::smallint,
  null::numeric, null::numeric,
  null::text, null::text
from public.sanadak_residential_listings s where s.active

union all
-- ---------------- satel: additional_info ----------------
select 'satel_residential_listings', t.id,
  case t.additional_info->>'air_conditioning_type'
    when 'split' then 'سبليت' when 'concealed' then 'مخفي' when 'both' then 'سبليت ومخفي' end,
  case t.additional_info->>'kitchen'
    when 'with-appliances' then 'راكب' when 'without-appliances' then 'راكب بدون أجهزة' end,
  case t.additional_info->>'furnishing'
    when 'Unfurnished' then 'غير مفروش' when 'Fully furnished' then 'مفروش بالكامل'
    when 'Partially furnished' then 'مفروش جزئيا' end,
  case when t.additional_info->>'parking_spots' ~ '^[0-9]+$' then (t.additional_info->>'parking_spots')::smallint end,
  case t.additional_info->>'parking_type'
    when 'underground' then 'تحت الأرض' when 'outdoor' then 'خارجي' when 'shadedOutdoor' then 'خارجي مظلل' end,
  null::boolean, null::numeric, null::smallint,
  null::boolean, null::boolean, null::boolean, null::boolean, null::boolean,
  null::boolean, null::boolean, null::boolean, null::boolean, null::boolean,
  null::smallint, null::smallint, null::smallint, null::smallint,
  case when t.additional_info->'geo'->>'lat' ~ '^-?[0-9.]+$' then (t.additional_info->'geo'->>'lat')::numeric end,
  case when t.additional_info->'geo'->>'lng' ~ '^-?[0-9.]+$' then (t.additional_info->'geo'->>'lng')::numeric end,
  null::text,
  nullif(btrim(coalesce(t.additional_info->>'postal_code','')),'')
from public.satel_residential_listings t where t.active

union all
-- ---------------- aqarcity: additional_info (services string) ----------------
select 'aqarcity_residential_listings', c.id,
  null::text, null::text, null::text, null::smallint, null::text,
  null::boolean, null::numeric, null::smallint,
  null::boolean, null::boolean,
  case when c.additional_info->>'services' like '%كهرباء%' then true end,
  case when c.additional_info->>'services' like '%مياه%'   then true end,
  case when c.additional_info->>'services' like '%صرف صحي%' then true end,
  null::boolean, null::boolean, null::boolean, null::boolean, null::boolean,
  null::smallint, null::smallint, null::smallint, null::smallint,
  case when c.additional_info->>'latitude'  ~ '^-?[0-9.]+$' then (c.additional_info->>'latitude')::numeric  end,
  case when c.additional_info->>'longitude' ~ '^-?[0-9.]+$' then (c.additional_info->>'longitude')::numeric end,
  nullif(btrim(coalesce(c.additional_info->>'rega_license_status','')),''),
  nullif(btrim(coalesce(c.additional_info->>'postal_code','')),'')
from public.aqarcity_residential_listings c where c.active

union all
-- ---------------- dealapp: additional_info ----------------
select 'dealapp_residential_listings', d.id,
  null::text, null::text, null::text, null::smallint, null::text,
  null::boolean, null::numeric, null::smallint,
  null::boolean, null::boolean, null::boolean, null::boolean, null::boolean,
  null::boolean, null::boolean, null::boolean, null::boolean, null::boolean,
  null::smallint, null::smallint, null::smallint, null::smallint,
  case when d.additional_info->>'latitude'  ~ '^-?[0-9.]+$' then (d.additional_info->>'latitude')::numeric  end,
  case when d.additional_info->>'longitude' ~ '^-?[0-9.]+$' then (d.additional_info->>'longitude')::numeric end,
  null::text, null::text
from public.dealapp_residential_listings d where d.active;

comment on view public.listing_rich_attrs is
  'Platform -> canonical RICH attribute mapping. Values come only from stored structured payloads. wasalt monthlyRentEMI is deliberately NOT mapped to installment_available: it is a finance calculator quote, not a published offer.';
