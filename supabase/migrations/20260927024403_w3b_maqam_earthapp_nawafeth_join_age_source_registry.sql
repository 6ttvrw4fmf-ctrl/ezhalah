-- Wave 3b (maqam, earthapp, nawafeth) join age_source_registry — the ONLY route by which an age reaches
-- the Advanced Filter (rebuild_age_producer, pg_cron 46 at :44, regenerates listing_age_resolved from
-- this registry alone). Measured after the first crawl, 2026-09-27, each checked against the source:
--   earthapp  6 of 51: Arabic word-numerals through normalize.exact_age («ثمان سنوات» → 8, «جديد» → 0);
--             the open bound «اكثر من عشر سنوات» stays NULL, never its floor.
--   nawafeth  6 of 9: «عمر العقار» through normalize.parse_property_age — #160 «ست سنوات» → 6,
--             #168 «جديد» → 0, both read off the live detail page.
--   maqam     1 of 47: the shared Nuzul engine's year_built, the rule already trusted for goldendeal
--             (4-digit year → age_from_completion_year; «0» = not provided → NULL). #51319 2016 → 10.
insert into public.age_source_registry (source_table, strategy, trusted, note, updated_at)
select t, 'canonical_column', true, n, now()
from (values
  ('earthapp_residential_listings', 'TRUSTED 2026-09-27: offer property_age, Arabic word-numerals via normalize.exact_age; open bound («اكثر من…») stays NULL. Live: 6 of 51, verified against raw.'),
  ('earthapp_commercial_listings',  'TRUSTED 2026-09-27: offer property_age, Arabic word-numerals via normalize.exact_age; open bound («اكثر من…») stays NULL. Live: 6 of 51, verified against raw.'),
  ('nawafeth_residential_listings', 'TRUSTED 2026-09-27: detail-page «عمر العقار» via normalize.parse_property_age. Live: 6 of 9; #160 ست سنوات→6 and #168 جديد→0 checked on source.'),
  ('nawafeth_commercial_listings',  'TRUSTED 2026-09-27: detail-page «عمر العقار» via normalize.parse_property_age. Live: 6 of 9; #160 ست سنوات→6 and #168 جديد→0 checked on source.'),
  ('maqam_residential_listings',    'TRUSTED 2026-09-27: Nuzul year_built, the goldendeal rule (4-digit year → age_from_completion_year; 0 = not provided → NULL). Live: 1 of 47; #51319 2016→10 checked on source API.'),
  ('maqam_commercial_listings',     'TRUSTED 2026-09-27: Nuzul year_built, the goldendeal rule (4-digit year → age_from_completion_year; 0 = not provided → NULL). Live: 1 of 47; #51319 2016→10 checked on source API.')
) v(t, n)
on conflict (source_table) do update
  set strategy = excluded.strategy, trusted = excluded.trusted, note = excluded.note, updated_at = now();

do $verify$
declare n int;
begin
  select count(*) into n from public.age_source_registry
   where source_table ~ '^(maqam|earthapp|nawafeth)_(residential|commercial)_listings$' and trusted;
  if n <> 6 then
    raise exception 'expected 6 trusted wave-3b rows in age_source_registry, found %', n;
  end if;
  raise notice 'wave 3b (maqam, earthapp, nawafeth) registered in age_source_registry';
end $verify$;
