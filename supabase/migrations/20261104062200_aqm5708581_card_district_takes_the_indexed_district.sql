-- AQM5708581: THE CARD'S DISTRICT LINE STILL CARRIED THE PRE-2026-09-21 GLUED PARSE (alert aqarmonthly_card_district_drift).
--
-- The one live aqarmonthly row whose card district (`neighborhood`) differs from the indexed district (`district_ar`):
--   neighborhood «حي الملك فهد المجمعة»  vs  district_ar «حي الملك فهد»  (search_listings_ar serves «حي الملك فهد», المجمعة).
-- Source: Aqar's own address for the ad is «شارع بدر ، حي الملك فهد ، المجمعة ، المجمعة» and its slug
-- «شارع-بدر-حي-الملك-فهد-المجمعة-المجمعة-5708581» — the district is «حي الملك فهد»; «المجمعة» is the city glued on by the
-- old 3-word «حي X» regex (the bug 2026-09-21 removed). The current writer, scrapers/aqarmonthly/run.py map_listing(), was
-- executed offline on this exact slug + address (catalog with المجمعة's four same-name towns, Aqar city 40 deliberately
-- unhinted) and writes ONE value, «حي الملك فهد», into both columns. So this is one leftover row, not a live writer bug.
-- Repair: the card column takes the indexed (source-proven) district. Anchored on the exact before-values, exactly one
-- row, fail closed. Watched by mon_detect_aqarmonthly_card_district_drift(), run at the end.
do $mig$
declare n int;
begin
  update public.aqarmonthly_residential_listings
     set neighborhood = district_ar
   where id = 1097380 and ad_number = 'AQM5708581'
     and neighborhood = 'حي الملك فهد المجمعة' and district_ar = 'حي الملك فهد';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'AQM5708581 repair: expected exactly 1 row with the measured before-values, got %', n;
  end if;
  perform public.mon_detect_aqarmonthly_card_district_drift();
end
$mig$;
