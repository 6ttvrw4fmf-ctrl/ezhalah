-- Advanced Filter source truth (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md, owner rule 2026-08-09).
--
-- Eight boolean columns on aqar_residential_listings were derived by matching Arabic keywords in the
-- listing description. Prose cannot express «no» and cannot distinguish "the source said nothing"
-- from "the source said no", so every one of those values is an invention. aqar publishes all eight
-- structurally, under `listing.extended_details` — verified against 24 live pages on 2026-08-09,
-- where 19 of 20 stored `parking` values disagreed with the source, INCLUDING a row stored `false`
-- where aqar published `true`.
--
-- The parser now reads aqar's own values (scrapers/aqar/enrich_residential.py, _EXTENDED_DETAIL_KEYS),
-- but re-enrichment alone cannot undo this: recover_stubs.recover() only writes a field when the
-- fresh value is NOT NULL, so a fabricated `true` whose true source value is NULL is classed
-- "no_gain" and left standing. The fabricated values must therefore be cleared here FIRST; the
-- re-enrichment pass then sees NULL and writes aqar's real value as a gain.
--
-- Nothing source-published is lost: none of these values came from aqar. The pre-change values are
-- snapshotted below so the change is fully reversible.

create table if not exists aqar_amenity_fabrication_repair_20260809 (
  id                         bigint primary key,
  was_active                 boolean,
  parking                    boolean,
  optical_fibers             boolean,
  laundry_room               boolean,
  balcony_terrace            boolean,
  villa_on_roof              boolean,
  apartment_in_project       boolean,
  separate_water_meter       boolean,
  separate_electricity_meter boolean,
  captured_at                timestamptz not null default now()
);

comment on table aqar_amenity_fabrication_repair_20260809 is
  'Pre-repair snapshot of prose-fabricated aqar amenity booleans cleared on 2026-08-09. Restore path '
  'for the clear; NOT a source of truth — these values were never published by aqar.';

insert into aqar_amenity_fabrication_repair_20260809
  (id, was_active, parking, optical_fibers, laundry_room, balcony_terrace,
   villa_on_roof, apartment_in_project, separate_water_meter, separate_electricity_meter)
select id, active, parking, optical_fibers, laundry_room, balcony_terrace,
       villa_on_roof, apartment_in_project, separate_water_meter, separate_electricity_meter
from aqar_residential_listings
where parking is not null or optical_fibers is not null or laundry_room is not null
   or balcony_terrace is not null or villa_on_roof is not null or apartment_in_project is not null
   or separate_water_meter is not null or separate_electricity_meter is not null
on conflict (id) do nothing;

update aqar_residential_listings
   set parking = null, optical_fibers = null, laundry_room = null, balcony_terrace = null,
       villa_on_roof = null, apartment_in_project = null,
       separate_water_meter = null, separate_electricity_meter = null
 where parking is not null or optical_fibers is not null or laundry_room is not null
    or balcony_terrace is not null or villa_on_roof is not null or apartment_in_project is not null
    or separate_water_meter is not null or separate_electricity_meter is not null;
