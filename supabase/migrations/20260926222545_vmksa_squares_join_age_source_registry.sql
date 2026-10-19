-- vm-ksa and squares join age_source_registry — the ONLY route by which a stored property_age reaches
-- the Advanced Filter: listing_native_location_v2 takes property_age from listing_age_resolved, which
-- rebuild_age_producer() (hourly at :44) regenerates from THIS registry alone. Found in the real-user
-- pass 2026-09-26: vm-ksa rows carried property_age in their own table (89 of 151) but NULL in
-- search_listings_ar, so the AF age question could never match them.
--
--   vmksa   — «عمر العقار» from the REGA licence block, the site's own single-year scale read through
--             normalize.exact_age(); «أكثر من عشر سنوات» (an open bound) stays NULL. 89 of 151 aged.
--   squares — «سنة البناء» printed on the listing page, via normalize.age_from_completion_year();
--             «.» (unstated) stays NULL. 6 of 16 aged.
--
-- NOT registered, because their parsers never write property_age (registering them would claim a
-- column they never fill): macsaib (0 of 76 — building_age 0 is a form default, stored NULL),
-- wahadat (0 of 968), rawaf (0 of 19).
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-26 (wave 3): vmksa — the REGA licence block''s «عمر العقار» through normalize.exact_age() (open bound → NULL); squares — the listing page''s «سنة البناء» through normalize.age_from_completion_year(). macsaib, wahadat and rawaf publish no age and are deliberately absent.',
       now()
from unnest(array[
  'vmksa_residential_listings','vmksa_commercial_listings',
  'squares_residential_listings','squares_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
DECLARE m int;
BEGIN
  SELECT count(*) INTO m FROM public.age_source_registry
   WHERE source_table ~ '^(vmksa|squares)_(residential|commercial)_listings$' AND trusted;
  IF m <> 4 THEN RAISE EXCEPTION 'expected 4 wave-3 age_source_registry rows, found %', m; END IF;
  IF EXISTS (SELECT 1 FROM public.age_source_registry
              WHERE source_table ~ '^(macsaib|wahadat|rawaf)_') THEN
    RAISE EXCEPTION 'a platform that publishes no age was registered as an age source';
  END IF;
  RAISE NOTICE 'wave-3: vmksa + squares are age sources; macsaib, wahadat, rawaf correctly absent';
END $verify$;