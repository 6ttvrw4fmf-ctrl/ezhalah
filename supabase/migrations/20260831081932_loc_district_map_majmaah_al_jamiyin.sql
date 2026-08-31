-- 5 gathern listings in المجمعة were served «حي الملك عبدالله» while the source publishes
-- «حي الجامعيين» (raw "Al Jamiyin Dist.", and additional_info.district_ar «حي الجامعيين»).
--
-- loc_district_map (city_ar, raw_district) -> district_ar is the resolution path for these
-- platforms — verified: for healthy rows the served district equals the map hit exactly. The pair
-- («المجمعة», 'Al Jamiyin Dist.') was simply absent, and instead of resolving to NULL the pipeline
-- substituted a different district that does exist in that city. Serving a district the source
-- never published is worse than serving none: docs/ops/DATA_INTEGRITY_ENGINEER.md §6 is explicit
-- that a confident match becomes a canonical ID and anything ambiguous or unverifiable stays NULL,
-- never a guess.
--
-- The target is not invented: «حي الجامعيين» already exists in loc_catalog_district for city_id 24
-- (المجمعة), so this adds the missing source-spelling -> canonical mapping that §6 asks for and
-- changes no semantics.
--
-- The sibling pair («جدة», 'As Safa Dist.') -> «حي الصفا» was already present, so gathern 726509
-- needs no map row: its «حي الربوة» was a leftover from the period when that listing was wrongly
-- resolved into أبها (fixed in 20260831080856). It re-resolves on the next district cycle.
--
-- Idempotent: safe to re-run.
insert into public.loc_district_map (city_ar, raw_district, district_ar)
select 'المجمعة', 'Al Jamiyin Dist.', 'حي الجامعيين'
where not exists (
  select 1 from public.loc_district_map m
   where m.city_ar = 'المجمعة' and m.raw_district = 'Al Jamiyin Dist.');
