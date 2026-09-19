-- city_id / region_id for the two new platforms' tables.
--
-- WHY THIS IS A SEPARATE MIGRATION AND WHY IT BLOCKED THE FIRST SWEEP. Both tables were created
-- with `LIKE aqar_residential_listings INCLUDING ALL`, and the aqar template does NOT carry
-- city_id/region_id — they were added per-platform later (akariyoun and suwar both have them).
-- The scrapers resolve the catalog and send both keys, so PostgREST rejected the WHOLE batch with
-- PGRST204 and 1,809 mapped listings wrote 0 rows. One unknown key loses every row, not just that
-- field (the living_rooms/majlis_rooms incident, and now this one).
--
-- These are the catalog's own integer ids, written by to_catalog() from the Arabic city the source
-- printed. They are what listing_location_index matches on; `city`/`city_ar` stay as the display
-- and canonical-Arabic values respectively.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ksaaqar_residential_listings','ksaaqar_commercial_listings',
                           'sadiqeltajer_residential_listings','sadiqeltajer_commercial_listings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS city_id integer', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS region_id integer', t);
  END LOOP;
END $$;