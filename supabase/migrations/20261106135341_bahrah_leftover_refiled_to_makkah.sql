-- 🔧 2026-11-06 — the last Jazan-labelled Bahrah ad (alert 13409 jazan_label_pin_far_north, P1 since 07:59).
-- Owner decision 2026-10-22 (migration 20261022004255_bahrah_is_in_makkah): Bahrah on the Jeddah–Makkah road is
-- catalogue city 1882 «بحرة المجاهدين» (region 2), and every served ad labelled Jazan's «بحرة» (3504) whose own pin
-- sits at 20.5–22.5 N moves there. That repair matched aqarmonthly rows on additional_info->>'latitude'; aqarmonthly
-- 1097285 (AQM5112418, slug «…-المحاميد-بحرة-5112418», served pin 21.4669 N 39.4211 E in search_listings_ar) keeps
-- its pin elsewhere, so it stayed at 3504 and the nightly re-upsert never rewrites a city it already has.
-- Same rule, same evidence (the served pin), applied through the index's own latitude. One row today; the WHERE is
-- general so any twin the same way is re-filed too. The 10-22 detector closes itself on the next sweep.
do $bahrah$
declare n int;
begin
  update public.aqarmonthly_residential_listings x
     set city_id = 1882, region_id = 2, city_ar = 'بحرة المجاهدين'
   where x.city_id = 3504
     and exists (select 1 from public.search_listings_ar s
                  where s.source_table = 'aqarmonthly_residential_listings' and s.listing_id = x.id
                    and s.latitude between 20.5 and 22.5);
  get diagnostics n = row_count;
  if n < 1 then raise exception 'expected at least 1 Jazan-labelled Bahrah row with a Makkah pin, found %', n; end if;
  raise notice 'bahrah leftover re-filed: % row(s)', n;
end
$bahrah$;