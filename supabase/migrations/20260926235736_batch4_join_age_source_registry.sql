-- Wave 3 batch 4 joins age_source_registry — the ONLY route by which a stored property_age reaches the
-- Advanced Filter (see 20260926222545).
--
--   dallali / muajarh / nafithh — the REGA licence's «عمر العقار» through normalize.exact_age().
--   mobasher — the listing page's propertyAge when > 0 (0 is a form default → NULL).
--   opensooq — only the «0 - 11 شهر» chip is an exact age (0); wider ranges stay NULL.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-26 (wave 3 batch 4): dallali/muajarh/nafithh — licence «عمر العقار» via normalize.exact_age(); mobasher — page propertyAge > 0; opensooq — only the «0 - 11 شهر» chip (age 0), ranges NULL.',
       now()
from unnest(array['dallali_residential_listings','dallali_commercial_listings','muajarh_residential_listings','muajarh_commercial_listings','mobasher_residential_listings','mobasher_commercial_listings','nafithh_residential_listings','nafithh_commercial_listings','opensooq_residential_listings','opensooq_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.age_source_registry
       WHERE source_table ~ '^(dallali|muajarh|mobasher|nafithh|opensooq)_(residential|commercial)_listings$' AND trusted) <> 10 THEN
    RAISE EXCEPTION 'expected 10 trusted wave-3 batch-4 age_source_registry rows';
  END IF;
  RAISE NOTICE 'wave-3 batch 4 are age sources';
END $verify$;