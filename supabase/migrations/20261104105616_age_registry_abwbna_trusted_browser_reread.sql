-- source-page-checks, 2026-11-04: age_resolver_platform_gap — abwbna adjudicated against its LIVE page.
-- abwbna's age comes from the API's year_built (scrapers/abwbna/run.py _age_from_year_built: a build year →
-- scrape-year − year; a small number → an age typed directly). The ad page labels that field «عمر العقار (سنة
-- البناء)»; on abwbna.com/properties/39628 (read in a browser 2026-11-04) we store 29 and the ad's own text says
-- «العمر 30 سنه تقريباً». It means the building's age, so it is registered TRUSTED; age_source_health() still gates it
-- (10 aged rows across both tables).
-- maktab_commercial / ibaax_commercial were WITHHELD by another session at 10:23 the same day (pages unreadable to a
-- plain fetch). This session's browser read them (maktab /details/108 «عمر العقار : خمس سنوات» = stored 5; ibaax API
-- 779 "Property Age": «جديد» = stored 0) — left as that session decided; the evidence is in its report.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at) values
  ('abwbna_commercial_listings', 'canonical_column', true,
   'TRUSTED 2026-11-04: API year_built via _age_from_year_built; the page labels it «عمر العقار (سنة البناء)»; abwbna.com/properties/39628 stores 29 and its own text says «العمر 30 سنه تقريباً» (browser re-read).', now()),
  ('abwbna_residential_listings', 'canonical_column', true,
   'TRUSTED 2026-11-04: API year_built via _age_from_year_built; the page labels it «عمر العقار (سنة البناء)»; abwbna.com/properties/39628 stores 29 and its own text says «العمر 30 سنه تقريباً» (browser re-read).', now())
on conflict (source_table) do nothing;
