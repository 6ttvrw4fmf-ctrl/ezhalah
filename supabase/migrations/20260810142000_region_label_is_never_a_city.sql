-- Audit 2026-08-10, Issue #3b: a «منطقة X» region label was being resolved to the same-named CITY.
--
-- Root cause (shared scraper helper, fixed in the same PR): scrapers/common/arabic_location.py
-- to_catalog() stripped BOTH admin prefixes — «محافظة X» and «منطقة X» — and retried the bare name as
-- a city. Stripping a governorate is right (it is named after its seat city: «محافظة الخرج» → الخرج).
-- Stripping a region is wrong: a region is an administrative area spanning many cities, and most
-- share a name with their capital, so the retry upgraded a region-level source value into a specific
-- city. Six platforms share that helper (aqargate, aqarmonthly, aldarim, alhoshan, hajer, sanadak).
--
-- Live damage (production, before the fix):
--   alhoshan/584386  source city 'منطقة الرياض' → city_id 3 (الرياض city); title says حي الرمال
--   alhoshan/584369  source city 'منطقة القصيم' → title says البدائع — a different city entirely
--   7 rows displayed a REGION label in the city field; 2 of them carried a fabricated city_id.
--
-- The source published region-level precision. Inventing a city from it violates exact-location-only
-- (honest unknown, never invent). Correct answer: region known, city UNKNOWN.
--
-- This migration repairs the DERIVED columns only. The raw source string stays untouched — the
-- source really did say 'منطقة الرياض' and that capture is auditable (listing-fidelity rule).
-- Losing city_id also makes these rows non-production_ready, which is correct: they have no city.
-- They remain findable in a countrywide search through the unlocated fallback (20260810123000).
--
-- Barrier: mon_region_label_as_city must stay 0 rows; the offline unit test
-- scrapers/common/test_region_label_is_not_a_city.py pins the resolver behaviour in CI.

-- ── Repair derived city ids on every raw table that carries them ──────────────────────────────
do $repair$
declare
  t     text;
  fixed int;
  total int := 0;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'city_ar'
      and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name
                    and i.column_name = 'city_id')
  loop
    execute format($f$
      update public.%I raw
         set city_id = null
       where raw.city_id is not null
         and exists (select 1 from public.loc_catalog_region r
                     where public.normalize_ar(r.region_ar) = public.normalize_ar(raw.city_ar))
    $f$, t);
    get diagnostics fixed = row_count;
    total := total + fixed;
    if fixed > 0 then
      raise notice 'region-label-as-city: cleared % fabricated city_id(s) on %', fixed, t;
    end if;
  end loop;
  raise notice 'region-label-as-city: % derived city_id(s) cleared in total', total;
end
$repair$;

-- ── Permanent barrier ────────────────────────────────────────────────────────────────────────
-- A region label must never be presented as a city, and must never carry a city_id.
create or replace view public.mon_region_label_as_city as
  select s.source_table,
         s.listing_id,
         s.platform,
         s.city_ar    as city_field_holds,
         s.region_ar,
         s.city_id,
         s.production_ready
  from public.search_listings_ar s
  join public.loc_catalog_region r
    on public.normalize_ar(r.region_ar) = public.normalize_ar(s.city_ar)
  where s.city_id is not null;

comment on view public.mon_region_label_as_city is
  'Audit 2026-08-10 barrier. Listings whose city field holds one of the 13 REGION labels AND still '
  'carry a city_id - i.e. region-level source precision was silently upgraded to a specific city. '
  'Must stay 0. Rows that merely display a region label with city_id NULL are honest (region known, '
  'city unknown) and are intentionally not flagged here.';
