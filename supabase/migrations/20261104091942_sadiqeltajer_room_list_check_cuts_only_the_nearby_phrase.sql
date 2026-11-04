CREATE OR REPLACE FUNCTION public.sadiqeltajer_own_text(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(regexp_replace(p,
    '(^|[[:space:][:punct:]،؛])و?(يلي|مقابل|بجوار|بجانب|جنب|قريب|قريبه|قريبة|بالقرب|مجاور|يجاور|امام|أمام|خلف|على شارع|علي شارع)(?=$|[[:space:][:punct:]،؛])([[:space:]]+[^[:space:]،,.;؛|()-]+){0,4}',
    ' ', 'g'), '')
$function$;
-- sadiqeltajer_af_outside_room_list: drop only the NEARBY PHRASE, never the whole description (🔬 2026-11-04, alert 11153).
-- The check split the description on punctuation and threw away any clause holding a near-word — but these ads are one
-- long unpunctuated clause, and the near-words matched INSIDE other words («جنب» in «الجنوبي», «امام» in «امامية»,
-- «على شارع» in «على شارعين»). So every one of the 11 rows seen in the last 3 days was flagged although its own text
-- states the yes: «تتكون من ثلاث غرف نوم وصاله ومطبخ», «البيع شامل الاثاث والمكيفات», «مكان غسيل». Now a near-word
-- (whole word, optional «و») and the up-to-4 words after it are cut out; everything else in the ad still counts.
CREATE OR REPLACE FUNCTION public.sadiqeltajer_af_outside_room_list()
 RETURNS TABLE(tbl text, id bigint, col text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with t as (
    select 'sadiqeltajer_residential_listings'::text tbl, r.id, coalesce(r.additional_info->>'components','') c,
           case when r.property_type in ('Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm') then ''
                else public.sadiqeltajer_own_text(r.description) end d,
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_residential_listings r
    union all
    select 'sadiqeltajer_commercial_listings', r.id, coalesce(r.additional_info->>'components',''),
           case when r.property_type in ('Residential Land','Commercial Land','Raw Land','Agricultural Land','Farm') then ''
                else public.sadiqeltajer_own_text(r.description) end,
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