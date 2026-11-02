-- Four listings take the city their own source names (2026-10-30). Evidence-backed repair, SOURCE IS TRUTH.
--
--   aqarmonthly 1097380 — served «المجمعة» under منطقة المدينة المنورة (city_region_mismatch). Source: city «Al Majmaah»,
--     region «Riyadh», pin 25.901249, 45.347893 (Al Majma'ah), URL «…حي-الملك-فهد-المجمعة-المجمعة-5708581». The catalog's
--     المجمعة (24) is in منطقة الرياض; listing_native_location_v1 carried region 3 with no city, and v2 took that region
--     over the fallback city's own. Pinning city 24 makes v2 take the region from the city (منطقة الرياض).
--   aqar 67479, 69085, 428844 — served «الاحساء» (3677) (aqar_proven_wrong_resolution). Source city «Hofuf»; their
--     districts «حي المعلمين الشرقية» / «حي الفاضلية» are catalog districts of الهفوف (12) only.
--
-- listing_city_correction is read by listing_native_location_v2 (city, city name and region from the corrected city);
-- 'source_proven_city' rows are not touched by refresh_listing_city_correction() / refresh_retired_place_remap().

insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm) values
  ('aqarmonthly_residential_listings', 1097380, 24, 'source_proven_city', 'source_proven_city'),
  ('aqar_residential_listings',        67479,   12, 'source_proven_city', 'source_proven_city'),
  ('aqar_residential_listings',        69085,   12, 'source_proven_city', 'source_proven_city'),
  ('aqar_residential_listings',        428844,  12, 'source_proven_city', 'source_proven_city')
on conflict (source_table, listing_id) do update set city_id = excluded.city_id, city_source = excluded.city_source,
  corrected_at = now();

do $chk$
begin
  if (select count(*) from public.listing_native_location_v2 v
       where (v.source_table, v.listing_id) in (('aqarmonthly_residential_listings', 1097380::bigint))
         and v.city_id = 24 and v.region_id = 1) <> 1 then
    raise exception 'aqarmonthly 1097380 does not resolve to المجمعة / منطقة الرياض in listing_native_location_v2';
  end if;
  if (select count(*) from public.listing_native_location_v2 v
       where v.source_table = 'aqar_residential_listings' and v.listing_id in (67479, 69085, 428844) and v.city_id = 12) <> 3 then
    raise exception 'the three Hofuf listings do not resolve to الهفوف (12) in listing_native_location_v2';
  end if;
end
$chk$;
