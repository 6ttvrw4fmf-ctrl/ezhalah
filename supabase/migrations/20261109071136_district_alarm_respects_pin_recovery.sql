-- district_contradicts_source: the pin half of «Title/pin wins» (owner 2026-11-03), 🆕 2026-11-09, backlog 1576.
--
-- Why the alarm kept coming back (4 P1s open since 11-06/07, «reopened 5 times in 7 days»): 20261103170826 taught it
-- the TITLE half of the owner's rule (district_recovery.basis = 'title') but not the PIN half. Measured 2026-11-09
-- 07:1x UTC: all 41 rows the view returned were served the district district_recovery decided from the map pin
-- (basis = 'pin'), and the source's «district» on them is its own town or a town-wide bucket
-- («حي الدرعية الجديدة» in الدرعية, «حي بيش» in بيش, «حي بقعاء» in بقعاء — owner 2026-10-26: a town is not its own
-- district). The ad's own address agrees with what we serve: aqar 40214 title «… حي ظهره العودة غرب, مدينة الدرعية»
-- (served حي ظهرة العودة غرب), aqar 39979 «… مدينة العمارية» (served العمارية), aqar 156570 «حي مخطط الحفل»
-- (served حي الحفل). Every OTHER disagreement still counts: the clause exempts a row only when the district
-- served IS the one the pin/title decided.
-- Re-read from the live definition 2026-11-09; only the basis list of the last NOT EXISTS changes.
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
    -- owner rule 2026-11-03 «Title/pin wins»: the ad's own title OR its map pin decided the district that is served
    AND NOT EXISTS (SELECT 1 FROM district_recovery d
                     WHERE d.source_table = t.source_table AND d.listing_id = t.listing_id
                       AND d.basis IN ('title', 'pin')
                       AND (d.district_ar = t.we_display
                            OR loc_display_district_ar(t.city_id, d.district_ar) = t.we_display));

do $chk$
declare v text := pg_get_viewdef('public.mon_district_contradicts_source'::regclass);
begin
  if position('''pin''::text' in v) = 0 or position('''title''::text' in v) = 0 then
    raise exception 'pin/title owner rule did not land in mon_district_contradicts_source';
  end if;
end $chk$;
