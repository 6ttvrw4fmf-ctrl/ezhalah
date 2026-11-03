-- 🔬 2026-11-03 (alert 11153, 275 rows): sadiqeltajer_af_outside_room_list() judged every amenity yes against the
-- «المكونات» row alone, but since backlog 794 (2026-10-23/24) the parser ALSO reads the ad's own description box
-- («تفاصيل الإعلان») for a BUILT unit, dropping any clause that names a neighbour («يليه / مقابل / بجوار …») and
-- never for land (scrapers/sadiqeltajer/run.py unit_description_text). Measured: of the 275 flagged values, 211
-- sit on rows whose stored description names the amenity (e.g. 21639796 «مكونة من : … مطبخ», kitchen yes). The
-- checker now accepts the same two sources the parser reads, under the same two exclusions (land, neighbour
-- clauses). Replay before apply: 275 -> 62; the 62 left carry no stored description (scraped before the box was
-- stored on 2026-10-30) or name the word only in a neighbour clause, and stay flagged.
create or replace function public.sadiqeltajer_af_outside_room_list()
 returns table(tbl text, id bigint, col text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with t as (
    select 'sadiqeltajer_residential_listings'::text tbl, r.id, coalesce(r.additional_info->>'components','') c,
           case when r.property_type in ('Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm') then ''
                else coalesce((select string_agg(cl, ' / ') from regexp_split_to_table(r.description, '[\n\r،,.;؛|()\-]+') cl
                                where cl !~ 'يلي|مقابل|بجوار|بجانب|جنب|قريب|بالقرب|مجاور|يجاور|امام|أمام|خلف|على شارع|علي شارع'), '') end d,
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_residential_listings r
    union all
    select 'sadiqeltajer_commercial_listings', r.id, coalesce(r.additional_info->>'components',''),
           case when r.property_type in ('Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm') then ''
                else coalesce((select string_agg(cl, ' / ') from regexp_split_to_table(r.description, '[\n\r،,.;؛|()\-]+') cl
                                where cl !~ 'يلي|مقابل|بجوار|بجانب|جنب|قريب|بالقرب|مجاور|يجاور|امام|أمام|خلف|على شارع|علي شارع'), '') end,
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_commercial_listings r)
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
