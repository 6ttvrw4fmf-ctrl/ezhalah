-- Formalize dwelleo + semsar as RETIRED (owner 2026-08-10: "stop showing up as dormant noise").
-- Both are fully dead already: scraper code deleted from repo, raw tables dropped (no dwelleo_*/
-- semsar_* in pg_stat_user_tables), in no workflow (unscheduled), 0 rows in search_listings_ar, last
-- ran 2026-06-23 / 06-22. This adds the same is_active=false marker the other 5 retired platforms
-- carry (alnokhba/awal/deal/muktamel/toor) so health/freshness views treat them as intentionally-off,
-- not stale. Reviving = rebuilding deleted scrapers from scratch (a product/cost decision).
insert into platform_cadence (platform, expected_hours, is_active, note) values
  ('dwelleo', 24, false, 'retired (formalized 2026-08-10): scraper code + raw tables deleted ~2026-06-23; unscheduled; 0 searchable'),
  ('semsar',  24, false, 'retired (formalized 2026-08-10): scraper code + raw tables deleted ~2026-06-22; unscheduled; 0 searchable')
on conflict (platform) do update set is_active = false, note = excluded.note;