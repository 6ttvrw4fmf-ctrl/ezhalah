-- Wave 3 batch 5 joins age_source_registry — the ONLY route by which a stored property_age reaches the
-- Advanced Filter (see 20260926222545).
--
--   holoul — the licence's nhc_age («new» → 0) via normalize.exact_age().
--   NOT registered: eightfloor — its scraper writes no age (registering it would claim a column it never fills).
--   manzo — the record's BUILD YEAR via normalize.age_from_completion_year().
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-27 (wave 3 batch 5): holoul — licence nhc_age via normalize.exact_age(); manzo — build year via normalize.age_from_completion_year(); eightfloor publishes no age and is deliberately absent.',
       now()
from unnest(array['holoul_residential_listings','holoul_commercial_listings','manzo_residential_listings','manzo_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.age_source_registry
       WHERE source_table ~ '^(holoul|manzo)_(residential|commercial)_listings$' AND trusted) <> 4 THEN
    RAISE EXCEPTION 'expected 4 trusted wave-3 batch-5 age_source_registry rows';
  END IF;
  RAISE NOTICE 'wave-3 batch 5 are age sources';
END $verify$;