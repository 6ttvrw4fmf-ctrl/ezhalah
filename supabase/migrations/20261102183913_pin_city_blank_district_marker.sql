-- listing_city_correction.district_norm is NOT NULL: a pin-corrected ad with no provable district stores '' (no
-- catalogue district has an empty name, so listing_native_location_v2 resolves it to a NULL district). Live patch.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure);
  old_txt constant text := $o$    select e.source_table, e.listing_id, e.to_city_id, 'pin_governorate', e.to_district_norm$o$;
  new_txt constant text := $n$    select e.source_table, e.listing_id, e.to_city_id, 'pin_governorate', coalesce(e.to_district_norm, '')$n$;
begin
  if position(old_txt in d) = 0 then raise exception 'refresh_pin_city_correction: correction insert not found'; end if;
  execute replace(d, old_txt, new_txt);
  if position('coalesce(e.to_district_norm, '''')' in pg_get_functiondef('public.refresh_pin_city_correction(boolean)'::regprocedure)) = 0 then
    raise exception 'refresh_pin_city_correction: blank marker patch did not land';
  end if;
end
$mig$;
