-- MAQRAT joins age_source_registry — the ONLY route by which a stored property_age reaches the
-- Advanced Filter (listing_native_location_v2 takes property_age from listing_age_resolved, which
-- rebuild_age_producer() regenerates from THIS registry alone; see 20260926222545).
--
--   maqrat — «عمر العقار» from the REGA licence block, read through normalize.exact_age(); an open
--            bound or «غير محدد» stays NULL. 52 of 82 rows aged after the first crawl (2026-09-26).
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-26 (wave 3 batch 3): maqrat — the REGA licence block''s «عمر العقار» through normalize.exact_age() (open bound / unstated → NULL). 52 of 82 aged on the first crawl.',
       now()
from unnest(array['maqrat_residential_listings','maqrat_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.age_source_registry
       WHERE source_table IN ('maqrat_residential_listings','maqrat_commercial_listings') AND trusted) <> 2 THEN
    RAISE EXCEPTION 'expected 2 trusted maqrat age_source_registry rows';
  END IF;
  RAISE NOTICE 'maqrat is an age source';
END $verify$;