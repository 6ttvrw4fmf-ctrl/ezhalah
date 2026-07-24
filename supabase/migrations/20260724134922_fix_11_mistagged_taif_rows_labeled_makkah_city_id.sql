-- Found live 2026-07-24 (filter-vs-backend audit): a city-only search for مكة المكرمة (Makkah)
-- returned 11 real listings that are actually in الطائف (Taif, ~90km away, a genuinely different
-- city). Root cause: these 11 rows' city_ar is the compound label "امارة منطقة مكة المكرمة - الطائف"
-- (Makkah-REGION governorate prefix + the actual city, الطائف); some upstream ingestion step assigned
-- city_id from the region-level prefix (6=مكة المكرمة) instead of the actual city (5=الطائف). The
-- row's own match_city_ids (computed by composite_match_city_ids() from the SAME city_ar text, via the
-- set_match_city_ids trigger) already correctly resolves to {5} — only the separately-stored city_id
-- column was wrong, and location_search_candidates_ar's p_cities predicate trusts city_id
-- unconditionally (`s.city_id in (select city_id from city_ids)`), independent of match_city_ids,
-- causing the leak.
--
-- Scope verified narrow: a full sweep of search_listings_ar for city_ar LIKE 'امارة منطقة%' found
-- exactly 27 rows total (compound region-prefixed labels), of which only these 11 carry a wrong
-- city_id; a broader sweep of every row whose normalize_ar(city_ar) disagrees with its stored
-- city_id's catalog name found only benign spelling/governorate-prefix variants elsewhere (e.g.
-- 'مدينه الجبيل الصناعيه'->الجبيل), not other cross-city leaks. This migration corrects exactly these
-- 11 known rows by (source_table, listing_id) — raw platform tables have no city_id column of their
-- own (only a raw `city` text column), so this denormalized search_listings_ar row is the sole
-- location of the wrong value; no raw-table counterpart exists to also fix. The set_match_city_ids
-- BEFORE UPDATE trigger will recompute match_city_ids on this UPDATE — verified this stays {5}
-- (unchanged), since composite_match_city_ids resolves "الطائف" via city_norm+region_id before ever
-- consulting the passed-in city_id.

update public.search_listings_ar
set city_id = 5
where (source_table, listing_id) in (
  ('aqarcity_residential_listings', 593479),
  ('aqarcity_residential_listings', 593481),
  ('aqarcity_residential_listings', 593870),
  ('aqarcity_residential_listings', 593872),
  ('aqarcity_residential_listings', 594124),
  ('aqarcity_residential_listings', 595097),
  ('aqaratikom_residential_listings', 645309),
  ('aqaratikom_residential_listings', 645310),
  ('aqaratikom_residential_listings', 645346),
  ('aqaratikom_residential_listings', 645434),
  ('raghdan_residential_listings', 598137)
)
and city_id = 6
and city_ar = 'امارة منطقة مكة المكرمة - الطائف';
