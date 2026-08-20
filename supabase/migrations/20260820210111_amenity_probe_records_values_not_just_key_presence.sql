-- Senior run #32b. CORRECTION to the probe registry, caught before any barrier was wired to it.
--
-- The first pass counted KEY PRESENCE in aqar's extended_details block, and recorded 8 columns as
-- "published on 3/14 commercial pages". Re-probing for actual VALUES (the key present but holding
-- null is UNKNOWN, never a published value -- _tri_state(None) is None) gives 0/14 for all eight:
--
--   column                       key_present   value_present
--   parking / balcony_terrace / laundry_room / optical_fibers /
--   apartment_in_project / separate_water_meter /
--   separate_electricity_meter / villa_on_roof        3/14          0/14
--
-- So aqar sends the amenity sub-block on ~21% of commercial pages but never fills it. The 0 rows
-- captured for those columns across all 7,382 aqar_commercial rows is CORRECT -- honest NULL, not a
-- capture gap. This is why the distinction matters: on key-presence alone the registry would have
-- claimed a published field, and a "capture collapse" barrier keyed off it would have fired forever
-- on correct behaviour, or worse, invited someone to "fix" it by fabricating values.
--
-- The columns aqar genuinely publishes VALUES for on commercial are confirmed by production itself,
-- which is stronger than any 14-page sample: water_supply/electricity/sanitation 3,607 non-null and
-- furnished 1,142 non-null in aqar_commercial_listings, with water_supply at 292/292 on the last 7
-- days of fresh rows.

alter table public.ops_aqar_commercial_amenity_probe
  add column if not exists values_published int;

update public.ops_aqar_commercial_amenity_probe set values_published = 0, verdict =
  'NOT PUBLISHED for commercial - key absent from payload entirely'
 where column_name in ('elevator','kitchen','air_conditioner','car_entrance','private_entrance');

update public.ops_aqar_commercial_amenity_probe set values_published = 0, verdict =
  'NOT PUBLISHED for commercial - extended_details key appears on ~21% of pages but ALWAYS null; '
  'the 0 rows captured is honest NULL, not a capture gap'
 where column_name in ('parking','balcony_terrace','laundry_room','optical_fibers',
                       'apartment_in_project','separate_water_meter','separate_electricity_meter','villa_on_roof');

update public.ops_aqar_commercial_amenity_probe set values_published = pages_publishing, verdict =
  'PUBLISHED with real values - captured correctly in production today'
 where column_name in ('water_supply','electricity','sanitation','furnished');

alter table public.ops_aqar_commercial_amenity_probe alter column values_published set not null;
