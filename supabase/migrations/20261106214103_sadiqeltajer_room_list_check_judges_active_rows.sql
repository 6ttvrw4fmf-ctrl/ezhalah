-- sadiqeltajer_af_outside_room_list judges only ACTIVE rows (🔬 2026-11-06, backlog 1384, alert 11153).
-- All 10 rows the P2 carried on 11-05/11-06 were inactive and absent from search_listings_ar: no customer could
-- see them, yet the alert stayed open and buried any real served yes. An inactive row that comes back is judged
-- again the hour it turns active. Body otherwise unchanged from 20261104091942.
create or replace function public.sadiqeltajer_af_outside_room_list()
 returns table(tbl text, id bigint, col text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with t as (
    select 'sadiqeltajer_residential_listings'::text tbl, r.id, coalesce(r.additional_info->>'components','') c,
           case when r.property_type in ('Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm') then ''
                else public.sadiqeltajer_own_text(r.description) end d,
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_residential_listings r
     where r.active
    union all
    select 'sadiqeltajer_commercial_listings', r.id, coalesce(r.additional_info->>'components',''),
           case when r.property_type in ('Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm') then ''
                else public.sadiqeltajer_own_text(r.description) end,
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_commercial_listings r
     where r.active)
  select tbl, id, x.col from t, lateral (values
      ('kitchen', kitchen and c !~ 'مطبخ' and d !~ 'مطبخ'),
      ('air_conditioner', air_conditioner and c !~ 'مكيف|تكييف' and d !~ 'مكيف|تكييف'),
      ('parking', parking and c !~ 'موقف|مواقف|كراج|جراج' and d !~ 'موقف|مواقف|كراج|جراج'),
      ('furnished', furnished and c !~ 'مفروش|مؤثث' and d !~ 'مفروش|مؤثث|اثاث|أثاث'),
      ('maid_room', maid_room and c !~ 'خادم|شغال' and d !~ 'خادم|شغال'),
      ('driver_room', driver_room and c !~ 'سائق' and d !~ 'سائق'),
      ('private_entrance', private_entrance and c !~ 'مدخل' and d !~ 'مدخل'),
      ('laundry_room', laundry_room and c !~ 'غسيل' and d !~ 'غسيل'),
      ('elevator', elevator and c !~ 'مصعد|مصاعد' and d !~ 'مصعد|مصاعد'),
      ('balcony_terrace', balcony_terrace and c !~ 'بلكون|شرف|تراس' and d !~ 'بلكون|شرف|تراس')) x(col, bad)
  where x.bad
$function$;
