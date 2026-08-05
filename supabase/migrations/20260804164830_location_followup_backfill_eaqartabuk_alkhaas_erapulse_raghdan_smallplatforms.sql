-- location-followup-pass 2026-08-04. One-time backfills for the 7 scraper-code fixes merged in this
-- pass. Each backfill was dry-run verified (read-only) immediately before this migration; narrow,
-- exact-match WHERE clauses throughout so none can misfire beyond the rows verified.

-- 1. eaqartabuk: title-embedded district, self-gated by resolve_district_ar(1, ...) so it can only
--    ever write text already proven to resolve against the Tabuk (city_id=1) catalog.
with candidates as (
  select id,
         (regexp_match(title, '(?:^|(?<=\s))ب?ح[يى]\s+([^\s,،.)\]]+)'))[1] as captured
  from public.eaqartabuk_residential_listings
  where neighborhood is null
)
update public.eaqartabuk_residential_listings t
set neighborhood = c.captured
from candidates c
where t.id = c.id
  and resolve_district_ar(1, c.captured) is not null;

with candidates as (
  select id,
         (regexp_match(title, '(?:^|(?<=\s))ب?ح[يى]\s+([^\s,،.)\]]+)'))[1] as captured
  from public.eaqartabuk_commercial_listings
  where neighborhood is null
)
update public.eaqartabuk_commercial_listings t
set neighborhood = c.captured
from candidates c
where t.id = c.id
  and resolve_district_ar(1, c.captured) is not null;

-- 2. alkhaas: مخطط pattern + trailing-noise strip, exact ad_number match, 21 rows.
update alkhaas_residential_listings as l
set neighborhood = r.new_value
from (values
  ('AKH618', NULL::text,        'اليحيى الزراعي'),
  ('AKH652', NULL,              'الراحه'),
  ('AKH805', NULL,              'اليحيى'),
  ('AKH896', NULL,              'اليحي الزراعي'),
  ('AKH903', NULL,              'الرحاب'),
  ('AKH922', NULL,              'الرحاب'),
  ('AKH923', NULL,              'الرحاب'),
  ('AKH924', NULL,              'الرحاب'),
  ('AKH942', NULL,              'الرحاب'),
  ('AKH963', NULL,              'الرحاب'),
  ('AKH964', NULL,              'الرحاب'),
  ('AKH965', NULL,              'الرحاب'),
  ('AKH966', NULL,              'السلام النموذجي'),
  ('AKH271', 'السلام 2',        'السلام'),
  ('AKH798', 'السلام 2',        'السلام'),
  ('AKH639', 'الحمراء بعنيزة',  'الحمراء'),
  ('AKH650', 'الجلده بعنيزة',   'الجلده'),
  ('AKH651', 'الزاهر بعنيزة',   'الزاهر'),
  ('AKH656', 'الياسمين بعنيزة', 'الياسمين'),
  ('AKH958', 'الروابي رقم',     'الروابي'),
  ('AKH959', 'الروابي رقم',     'الروابي')
) as r(ad_number, old_value, new_value)
where l.ad_number = r.ad_number
  and l.neighborhood is not distinct from r.old_value;

-- 3. erapulse: hood/city-name contamination strip, exact ad_number match, 6+1 rows.
update erapulse_residential_listings
set neighborhood = case ad_number
    when 'ERPREFMRDQ8FJZ8Y1CW' then 'الروضة'
    when 'ERPREFMRDQ4D6NGZODV' then 'الشفق'
    when 'ERPREFMRDQTUMCYCG72' then 'الشقة'
    when 'ERPREFMRDQMUF9FPBTH' then 'السليمانية'
    when 'ERPREFMN3DP7WQVG9ZU' then 'الرحاب'
    when 'ERPREFMNR6BJ0NJ5NOU' then 'غرناطة'
  end
where ad_number in (
    'ERPREFMRDQ8FJZ8Y1CW','ERPREFMRDQ4D6NGZODV','ERPREFMRDQTUMCYCG72',
    'ERPREFMRDQMUF9FPBTH','ERPREFMN3DP7WQVG9ZU','ERPREFMNR6BJ0NJ5NOU'
);

update erapulse_commercial_listings
set neighborhood = 'الشريمية'
where ad_number = 'ERPREFMN2TZQW6LZ4FQ';

-- 4. raghdan: 4-crumb title-embedded district, raw extraction (validated downstream by
--    resolve_district_ar via the existing hourly district-recovery cron, same as the 5-crumb path).
update public.raghdan_residential_listings
   set neighborhood = substring(title from 'في\s+([^،]+)،')
 where city is not null
   and neighborhood is null
   and title ~ 'في\s+[^،]+،';

update public.raghdan_commercial_listings
   set neighborhood = substring(title from 'في\s+([^،]+)،')
 where city is not null
   and neighborhood is null
   and title ~ 'في\s+[^،]+،';

-- 5. mizlaj/fursaghyr/souq24/aqaratikom: catalog fallback result, additive into additional_info
--    (these tables have no city_id/region_id column). Exact id match, single-candidate matches only.
update mizlaj_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 55, 'catalog_region_id', 5)
  where id = 630030 and city is null;
update mizlaj_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 3499, 'catalog_region_id', 10)
  where id = 1034060 and city is null;

update fursaghyr_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 884, 'catalog_region_id', 1)
  where id = 614567 and city is null;
update fursaghyr_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 2633, 'catalog_region_id', 4)
  where id = 614568 and city is null;
update fursaghyr_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 1531, 'catalog_region_id', 12)
  where id = 3237532 and city is null;

update souq24_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 889, 'catalog_region_id', 1)
  where id = 648152 and city is null;
update souq24_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 3597, 'catalog_region_id', 10)
  where id = 648160 and city is null;

update aqaratikom_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 17993, 'catalog_region_id', 10)
  where id in (645328, 645330, 645331, 645333) and city is null;
update aqaratikom_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 939, 'catalog_region_id', 4)
  where id = 1203699 and city is null;
update aqaratikom_residential_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 447, 'catalog_region_id', 1)
  where id = 5637385 and city is null;

update aqaratikom_commercial_listings set additional_info = additional_info ||
  jsonb_build_object('catalog_city_id', 939, 'catalog_region_id', 4)
  where id = 645453 and city is null;
