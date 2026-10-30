-- mon_district_contradicts_source: run the cheap text comparison FIRST, the display rule only on what survives
-- (2026-10-30, follow-up to 20261030064443 and 20261030064801, district_contradiction_alarm_reads_spelling_and_aqar_address).
--
-- The spelling / Aqar-address excusals call loc_display_district_ar(), which costs milliseconds per row
-- (district_place_hidden → place_km). On its own the view planned them after the cheap filters (~1,900 rows, 11 s),
-- but inside mon_detect_district_contradicts_source()'s GROUP BY the planner evaluated them across all ~417k served
-- rows and the detector hit the statement timeout. A MATERIALIZED CTE fences the cheap set so the expensive
-- excusals only ever see the rows that already disagree by text. Same predicate, same rows.

create or replace view public.mon_district_contradicts_source as
 WITH text_disagrees AS MATERIALIZED (
   SELECT s.source_table,
      s.listing_id,
      s.platform,
      s.city_ar,
      s.city_id,
      sd.source_district_ar AS source_says,
      s.district_ar AS we_display
     FROM search_listings_ar s
       JOIN listing_source_district_ar_fleet sd ON sd.source_table = s.source_table AND sd.listing_id = s.listing_id
    WHERE s.district_ar IS NOT NULL AND norm_district_tok(s.district_ar) <> norm_district_tok(sd.source_district_ar)
      AND POSITION((norm_district_tok(s.district_ar)) IN (norm_district_tok(sd.source_district_ar))) = 0
      AND POSITION((norm_district_tok(sd.source_district_ar)) IN (norm_district_tok(s.district_ar))) = 0
      AND NOT (district_hajar_ordinal(s.district_ar) IS NOT NULL AND district_hajar_ordinal(s.district_ar) = district_hajar_ordinal(sd.source_district_ar))
      AND regexp_replace(norm_district_tok(s.district_ar), '\s'::text, ''::text, 'g'::text) <> regexp_replace(norm_district_tok(sd.source_district_ar), '\s'::text, ''::text, 'g'::text)
 )
 SELECT t.source_table,
    t.listing_id,
    t.platform,
    t.city_ar,
    t.source_says,
    t.we_display
   FROM text_disagrees t
  -- spelling: the source's word, displayed by our own rule, IS the district we show (2026-10-30)
  WHERE NOT COALESCE(loc_display_district_ar(t.city_id, t.source_says) = t.we_display, false)
    -- Aqar: the ad's own address (listing URL) names the district we show (2026-10-30)
    AND NOT (t.platform = 'aqar' AND EXISTS (
          SELECT 1 FROM (SELECT id, listing_url FROM aqar_residential_listings WHERE t.source_table = 'aqar_residential_listings'
                         UNION ALL
                         SELECT id, listing_url FROM aqar_commercial_listings WHERE t.source_table = 'aqar_commercial_listings') a
           WHERE a.id = t.listing_id
             AND loc_display_district_ar(t.city_id, aqar_address_district(a.listing_url)) = t.we_display));
