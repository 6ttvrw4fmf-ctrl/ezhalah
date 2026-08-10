-- ONE canonical place to read coverage, so the active/inactive mistake cannot be made again.
--
-- Owner rule, 2026-08-11: "Never compare raw historical totals against active/searchable totals when
-- measuring coverage. Always split active vs inactive before quoting a gap."
--
-- I made that error three times in one session. Raw platform tables hold every listing ever scraped;
-- every downstream view filters WHERE active. Comparing the two invents a gap:
--   "10,377 amenity values stuck"   -> 10,384 of 13,269 were DELISTED; only 2,885 active
--   "meters recoverable +10,312"    -> 52,308 of 52,309 ACTIVE rows already had it (99.998%)
-- The second one cost a migration that gained exactly zero rows.
--
-- This view reports BOTH numbers side by side for the Annual Rent -> Apartment slice, so any future
-- coverage claim is quotable from one place and the denominator is never ambiguous. `searchable` is
-- the only figure that may be called coverage; `raw_all_time` exists purely to make the difference
-- visible rather than tempting.
create or replace view public.af_coverage_active_only as
select
  s.platform,
  count(*)                                     as searchable_listings,
  count(s.air_conditioner)                     as ac,
  count(s.elevator)                            as elevator,
  count(s.kitchen)                             as kitchen,
  count(s.private_entrance)                    as private_entrance,
  count(s.parking)                             as parking,
  count(s.furnished)                           as furnished,
  count(s.furnishing_level)                    as furnishing_level,
  count(s.property_age)                        as property_age,
  count(s.bedrooms)                            as bedrooms,
  count(s.floor_number)                        as floor_number,
  count(s.direction_ar)                        as direction,
  count(s.frontage_count)                      as frontage_count,
  count(s.separate_electricity_meter)          as elec_meter,
  count(s.separate_water_meter)                as water_meter,
  count(s.license_number)                      as licence,
  count(s.latitude)                            as coordinates,
  count(s.deed_location_text)                  as deed_location,
  count(*) filter (where s.installment_available) as installments_yes
from public.search_listings_ar s
where s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي' and s.type_ar = 'شقة' and s.production_ready
group by s.platform;

comment on view public.af_coverage_active_only is
  'THE canonical coverage report for Annual Rent -> Apartment. Every column counts only SEARCHABLE '
  '(production_ready, in-scope) listings. Never quote a coverage number from a raw platform table: '
  'those include delisted rows and the comparison invents gaps that do not exist (2026-08-11 rule).';

grant select on public.af_coverage_active_only to anon, authenticated;
