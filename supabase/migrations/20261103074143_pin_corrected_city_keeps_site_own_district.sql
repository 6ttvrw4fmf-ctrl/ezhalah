-- 🆕 New Listings Engineer 2026-11-03 — THE SITE'S OWN DISTRICT SURVIVES A PIN-CORRECTED CITY.
-- listing_native_location_v2 serves a pin-corrected city (listing_city_correction.city_source = 'pin_governorate',
-- 20261102182629 … 20261102183913) with ONLY the correction's district_norm, which refresh_pin_city_correction()
-- fills from the title («حي X») or the pin's OSM shape — never from the site's own district field. When neither
-- answered it stores '' (20261102183913), and the view then threw away district_recovery's verbatim source district.
-- Measured 07:45 UTC: 413 served pin-corrected ads carry a recovered district and serve none; 100 of them (all
-- dealapp, all verbatim, 8 first seen in the last 24 h) name a district ON THE CORRECTED CITY'S OWN LIST — e.g.
-- dealapp 23256894 «ارض للبيع في خليص», neighbourhood «حي السلام» (خليص 1105 lists حي السلام), served no district.
-- Owner rule (2026-10-25): the site's own district always wins. Needle: when the correction carries no district,
-- fall back to the VERBATIM recovered district, served only if it is on the corrected city's list, in the list's
-- spelling. A correction that has a district keeps it; the 313 names not on the corrected city's list stay blank.
do $mig$
declare
  v_def  text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  v_old  constant text := 'WHERE ((kd.city_id = xcc.city_id) AND (kd.district_norm = xcc.district_norm) AND (kd.retired_at IS NULL))';
  v_new  constant text := 'WHERE ((kd.city_id = xcc.city_id) AND (kd.district_norm = COALESCE(NULLIF(xcc.district_norm, ''''::text), CASE WHEN dr.verbatim THEN norm_district_tok(dr.district_ar) ELSE NULL::text END)) AND (kd.retired_at IS NULL))';
  v_hits int := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
begin
  if v_hits <> 1 then
    raise exception 'needle found % times in listing_native_location_v2 (expected 1)', v_hits;
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || replace(v_def, v_old, v_new);
end
$mig$;

-- Check block: EXECUTE the view on the measured case and on a guard case.
do $chk$
declare
  v_d text;
begin
  select district_ar into v_d from public.listing_native_location_v2
   where source_table = 'dealapp_residential_listings' and listing_id = 23256894;
  if v_d is distinct from 'حي السلام' then
    raise exception 'dealapp 23256894 should serve حي السلام under خليص, got %', coalesce(v_d, 'NULL');
  end if;
  -- no pin-corrected row may serve a district that is not on its corrected city's list
  if exists (select 1 from public.listing_native_location_v2 v
               join public.listing_city_correction x on x.source_table = v.source_table and x.listing_id = v.listing_id
              where x.city_source = 'pin_governorate' and v.district_ar is not null
                and not exists (select 1 from public.loc_catalog_district kd
                                 where kd.city_id = x.city_id and kd.retired_at is null and kd.district_ar = v.district_ar)) then
    raise exception 'a pin-corrected row serves a district off its corrected city''s list';
  end if;
end
$chk$;