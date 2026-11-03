-- source_district_dropped respects the owner's PIN rule (owner 2026-11-03 «Title/pin wins»; 1166 pin governorate
-- decides the city and the district moves with it).
--
-- Measured 2026-11-03 19:50 UTC: «dropped» jumped from 11 (alert 12679, 11-02) to 1,460 aqar rows after the pin
-- correction refilled at 01:00 and 16:00. All 1,290 checked are served under a pin-corrected city
-- (listing_city_correction.city_source = 'pin_governorate', same city_id) whose correction carries no district; 1,277
-- of them name a district that is NOT on that corrected city's official list (e.g. aqar «حي بنبان» — a Riyadh district
-- — on an ad whose pin sits in ملهم). listing_native_location_v2 then serves NULL ON PURPOSE (20261103074143: a
-- pin-corrected row serves only a district on its corrected city's list). The alarm was counting the owner's rule as
-- a dropped source district, exactly the shape removed the same day from mon_district_contradicts_source (district_alarm_respects_title_pin_owner_rule).
--
-- Needle: a row is not «dropped» when its city is the pin-corrected one AND the source word is off that city's list.
-- A pin-corrected row whose word IS on the corrected city's list still counts (34 aqar that day — a real drop), and
-- every non-pin row is judged exactly as before.
do $mig$
declare
  d text := pg_get_functiondef('public.source_district_dropped_rows'::regproc);
  a_old constant text := E'as city_only\n        from public.search_listings_ar s';
  a_new constant text := E'as city_only,\n'
    || E'               exists (select 1 from public.listing_city_correction x\n'
    || E'                        where x.source_table = s.source_table and x.listing_id = s.listing_id\n'
    || E'                          and x.city_source = ''pin_governorate'' and x.city_id = s.city_id) as pin_city\n'
    || E'        from public.search_listings_ar s';
  b_old constant text := 'and not city_only and (last_updated is null';
  b_new constant text := 'and not city_only'
    || ' and not (pin_city and not exists (select 1 from public.loc_catalog_district kd'
    || ' where kd.city_id = k.city_id and kd.retired_at is null and kd.district_norm = public.norm_district_tok(w)))'
    || ' and (last_updated is null';
begin
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
     or (length(d) - length(replace(d, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'source_district_dropped_rows: anchors not found exactly once';
  end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end
$mig$;
