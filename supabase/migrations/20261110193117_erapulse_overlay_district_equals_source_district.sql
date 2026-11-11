-- erapulse: the Arabic-location overlay kept an OLD copy of the source district (owner approved 2026-11-10).
--
-- MEASURED. listings_arabic_locations holds 40 erapulse rows with a district. 38 equal the source
-- table's own `neighborhood`. Two do not: 648057 («الرحاب - بريده», source «الرحاب») and 646396
-- («غرناطة محافظة النبهانبة», source «غرناطة»). The source table was re-read (last_seen 2026-11-10)
-- and carries the clean district; the overlay copy was written once and nothing refreshes it, so the
-- card showed the old label and a district search for «الرحاب» in بريدة missed the ad. Both ad pages
-- were opened on 2026-11-10 and name حي الرحاب / حي غرناطة.
--
-- THE REPAIR. The overlay district is a copy of the source district and nothing else: make every
-- erapulse copy equal the source row again. Source tables are untouched.
update public.listings_arabic_locations l
   set raw_district = t.neighborhood,
       district_ar  = t.neighborhood
  from public.erapulse_residential_listings t
 where l.source_table = 'erapulse_residential_listings'
   and l.listing_id = t.id
   and l.district_ar is not null
   and nullif(btrim(t.neighborhood), '') is not null
   and l.raw_district is distinct from t.neighborhood;
