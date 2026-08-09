-- Same defect, same eight columns, the commercial half of the aqar pipeline.
-- run_commercial.py enriches through the SAME enrich_residential() that was fixed today, so new
-- ingestion is already correct; these are the historical prose-derived values. They reach the
-- Advanced Filter through the identical path (listing_extra_attrs -> search_listings_ar), which is
-- why the search index held MORE fabricated parking values than the residential table alone.
-- Snapshotted into the same audit table, so the whole repair has one restore point.

insert into aqar_amenity_fabrication_repair_20260809
  (id, was_active, parking, optical_fibers, laundry_room, balcony_terrace,
   villa_on_roof, apartment_in_project, separate_water_meter, separate_electricity_meter)
select -id, active, parking, optical_fibers, laundry_room, balcony_terrace,
       villa_on_roof, apartment_in_project, separate_water_meter, separate_electricity_meter
from aqar_commercial_listings
where parking is not null or optical_fibers is not null or laundry_room is not null
   or balcony_terrace is not null or villa_on_roof is not null or apartment_in_project is not null
   or separate_water_meter is not null or separate_electricity_meter is not null
on conflict (id) do nothing;

comment on table aqar_amenity_fabrication_repair_20260809 is
  'Pre-repair snapshot of prose-fabricated aqar amenity booleans cleared on 2026-08-09. POSITIVE id '
  '= aqar_residential_listings.id; NEGATIVE id = -aqar_commercial_listings.id. Restore path for the '
  'clear; NOT a source of truth — these values were never published by aqar.';

update aqar_commercial_listings
   set parking = null, optical_fibers = null, laundry_room = null, balcony_terrace = null,
       villa_on_roof = null, apartment_in_project = null,
       separate_water_meter = null, separate_electricity_meter = null
 where parking is not null or optical_fibers is not null or laundry_room is not null
    or balcony_terrace is not null or villa_on_roof is not null or apartment_in_project is not null
    or separate_water_meter is not null or separate_electricity_meter is not null;
