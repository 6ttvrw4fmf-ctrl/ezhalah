-- district_contradicts_source respects the owner's location rules (owner, 2026-11-03).
--
-- Owner, asked «Some ads say one district in the district field but another in the title or on the map pin.
-- What should Ezhalah show?» → «Title/pin wins». Those two rules were built 2026-11-02 (backlog 1165 title
-- district, 1166 pin governorate decides the city and the district moves with it). Measured 2026-11-03: of the
-- 270 rows this view returned, 152 were served by the pin rule and 110 by the title rule — the alarm was
-- counting the owner's own decisions as defects, so it could never close. Every OTHER disagreement still
-- counts (8 rows that day: dealapp 3, ksaaqar 2, mustqr 1, aqar 1, haraj 0…), so the alarm still fires on a
-- district nobody decided.
--   * pin rule: the served city IS the pin-corrected city (listing_city_correction.city_source =
--     'pin_governorate', same city_id) — the district then comes from refresh_pin_city_correction()'s proof
--     on that city's official list, or is NULL;
--   * title rule: district_recovery decided this district from the ad's OWN title (basis = 'title') and it
--     is the one served.
-- Re-read from the live definition 2026-11-03; only the two NOT EXISTS clauses are added.
create or replace view public.mon_district_contradicts_source as
 WITH text_disagrees AS MATERIALIZED (
         SELECT s.source_table,
            s.listing_id,
            s.platform,
            s.city_ar,
            s.city_id,
            sd.source_district_ar AS source_says,
            s.district_ar AS we_display
           FROM (search_listings_ar s
             JOIN listing_source_district_ar_fleet sd ON (((sd.source_table = s.source_table) AND (sd.listing_id = s.listing_id))))
          WHERE ((s.district_ar IS NOT NULL) AND (norm_district_tok(s.district_ar) <> norm_district_tok(sd.source_district_ar)) AND (POSITION((norm_district_tok(s.district_ar)) IN (norm_district_tok(sd.source_district_ar))) = 0) AND (POSITION((norm_district_tok(sd.source_district_ar)) IN (norm_district_tok(s.district_ar))) = 0) AND (NOT ((district_hajar_ordinal(s.district_ar) IS NOT NULL) AND (district_hajar_ordinal(s.district_ar) = district_hajar_ordinal(sd.source_district_ar)))) AND (regexp_replace(norm_district_tok(s.district_ar), '\s'::text, ''::text, 'g'::text) <> regexp_replace(norm_district_tok(sd.source_district_ar), '\s'::text, ''::text, 'g'::text)))
        )
 SELECT source_table,
    listing_id,
    platform,
    city_ar,
    source_says,
    we_display
   FROM text_disagrees t
  WHERE ((NOT COALESCE((loc_display_district_ar(city_id, source_says) = we_display), false)) AND (NOT ((platform = 'aqar'::text) AND (EXISTS ( SELECT 1
           FROM ( SELECT aqar_residential_listings.id,
                    aqar_residential_listings.listing_url
                   FROM aqar_residential_listings
                  WHERE (t.source_table = 'aqar_residential_listings'::text)
                UNION ALL
                 SELECT aqar_commercial_listings.id,
                    aqar_commercial_listings.listing_url
                   FROM aqar_commercial_listings
                  WHERE (t.source_table = 'aqar_commercial_listings'::text)) a
          WHERE ((a.id = t.listing_id) AND (loc_display_district_ar(t.city_id, aqar_address_district(a.listing_url)) = t.we_display)))))))
    -- owner rule 2026-11-03 «Title/pin wins»: the map-pin city correction decided this city (and its district)
    AND NOT EXISTS (SELECT 1 FROM listing_city_correction x
                     WHERE x.source_table = t.source_table AND x.listing_id = t.listing_id
                       AND x.city_source = 'pin_governorate' AND x.city_id = t.city_id)
    -- owner rule 2026-11-03 «Title/pin wins»: the ad's own title decided the district that is served
    AND NOT EXISTS (SELECT 1 FROM district_recovery d
                     WHERE d.source_table = t.source_table AND d.listing_id = t.listing_id
                       AND d.basis = 'title'
                       AND (d.district_ar = t.we_display
                            OR loc_display_district_ar(t.city_id, d.district_ar) = t.we_display));