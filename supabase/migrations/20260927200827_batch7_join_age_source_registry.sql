-- Batch 7 joins age_source_registry — the ONLY route by which a stored property_age reaches the
-- Advanced Filter (see 20260926222545). Found by the owner-ordered AF test pass: 89 sirdab and 83 ashab
-- rows carried an age in their tables and NONE of it reached search_listings_ar.
--
--   sirdab — the API's own property.property_age (integer years); 89 of 89 equal the captured raw field.
--   ashab  — the detail page's «عمر العقار N»; 40/30/29 re-read on ashab.sa/properties/963060, 759388, 543567.
--   NOT registered: manafe, wajaf, albukaeri, ryadah, daraa, tawia, superoffice — their scrapers write no
--   age (registering them would claim a column they never fill); sqcc — 3 aged rows, never verified
--   against the source, and too small for age_source_health() to judge.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true,
       'TRUSTED 2026-09-27 (batch 7): sirdab — API property.property_age, 89/89 equal the raw capture; ashab — detail-page «عمر العقار», 3 highest re-read on the live site.',
       now()
from unnest(array['sirdab_residential_listings','sirdab_commercial_listings','ashab_residential_listings','ashab_commercial_listings']) t
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.age_source_registry
       WHERE source_table ~ '^(sirdab|ashab)_(residential|commercial)_listings$' AND trusted) <> 4 THEN
    RAISE EXCEPTION 'expected 4 trusted batch-7 age_source_registry rows';
  END IF;
  RAISE NOTICE 'batch 7 (sirdab, ashab) are age sources';
END $verify$;