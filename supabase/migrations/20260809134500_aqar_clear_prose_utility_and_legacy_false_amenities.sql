-- Round 2 of the Advanced Filter source-truth repair (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md).
--
-- (a) water_supply / electricity / sanitation were matched from «توفر الماء» / «كهرباء» / «صرف صحي».
--     aqar publishes all three as native booleans on its flat listing object — verified across 24
--     live pages on 2026-08-09 (water 21 true / 1 false, electrical 21/1, drainage 18/4), so they
--     carry real negatives prose can never express. The parser now reads aqar's own values
--     (_STRUCTURED_AMENITY_KEYS); every stored value here is prose and must go, positive or negative.
--
-- (b) The remaining prose-only columns can, since 2026-08-05, only ever produce true-or-NULL — the
--     pre-fix `_flag()` returned a bare bool, so a stored `false` means nothing more than "the
--     description didn't mention it". Proof that every such `false` is legacy: all 40,569
--     maid_room=false rows sat inside the 2026-08-09 fabrication snapshot and ZERO sat outside it.
--     Their `true` values are KEPT — a prose hit is genuine evidence the listing ADVERTISES the
--     feature, which stays the documented behaviour for a field aqar publishes nowhere. (aqar does
--     emit sparse `maid`/`driver` keys, but they appeared on only 1 of 24 live pages, which is too
--     thin to map: per the rule, an ambiguous source is a STOP, not a guess.)
--
-- Reversible: the same snapshot table carries the pre-change values for every column touched here.

alter table aqar_amenity_fabrication_repair_20260809
  add column if not exists water_supply     boolean,
  add column if not exists electricity      boolean,
  add column if not exists sanitation       boolean,
  add column if not exists maid_room        boolean,
  add column if not exists driver_room      boolean,
  add column if not exists extension        boolean,
  add column if not exists special_surface  boolean,
  add column if not exists special_position boolean;

-- Rows already snapshotted in round 1: fill in the round-2 columns.
update aqar_amenity_fabrication_repair_20260809 r
   set water_supply = l.water_supply, electricity = l.electricity, sanitation = l.sanitation,
       maid_room = l.maid_room, driver_room = l.driver_room, extension = l.extension,
       special_surface = l.special_surface, special_position = l.special_position
  from aqar_residential_listings l
 where l.id = r.id and r.id > 0;

-- Rows round 1 never touched but round 2 will: snapshot them now.
insert into aqar_amenity_fabrication_repair_20260809
  (id, was_active, water_supply, electricity, sanitation, maid_room, driver_room,
   extension, special_surface, special_position)
select l.id, l.active, l.water_supply, l.electricity, l.sanitation, l.maid_room, l.driver_room,
       l.extension, l.special_surface, l.special_position
from aqar_residential_listings l
where l.water_supply is not null or l.electricity is not null or l.sanitation is not null
   or l.maid_room is false or l.driver_room is false or l.extension is false
   or l.special_surface is false or l.special_position is false
on conflict (id) do nothing;

insert into aqar_amenity_fabrication_repair_20260809
  (id, was_active, water_supply, electricity, sanitation, maid_room, driver_room,
   extension, special_surface, special_position)
select -l.id, l.active, l.water_supply, l.electricity, l.sanitation, l.maid_room, l.driver_room,
       l.extension, l.special_surface, l.special_position
from aqar_commercial_listings l
where l.water_supply is not null or l.electricity is not null or l.sanitation is not null
   or l.maid_room is false or l.driver_room is false or l.extension is false
   or l.special_surface is false or l.special_position is false
on conflict (id) do nothing;

update aqar_amenity_fabrication_repair_20260809 r
   set water_supply = l.water_supply, electricity = l.electricity, sanitation = l.sanitation,
       maid_room = l.maid_room, driver_room = l.driver_room, extension = l.extension,
       special_surface = l.special_surface, special_position = l.special_position
  from aqar_commercial_listings l
 where l.id = -r.id and r.id < 0;

-- (a) utility availability: every stored value is prose-derived.
update aqar_residential_listings
   set water_supply = null, electricity = null, sanitation = null
 where water_supply is not null or electricity is not null or sanitation is not null;

-- (b) prose-only columns: clear the manufactured negatives, keep the advertised positives.
update aqar_residential_listings
   set maid_room        = nullif(maid_room, false),
       driver_room      = nullif(driver_room, false),
       extension        = nullif(extension, false),
       special_surface  = nullif(special_surface, false),
       special_position = nullif(special_position, false)
 where maid_room is false or driver_room is false or extension is false
    or special_surface is false or special_position is false;

update aqar_commercial_listings
   set water_supply = null, electricity = null, sanitation = null,
       maid_room        = nullif(maid_room, false),
       driver_room      = nullif(driver_room, false),
       extension        = nullif(extension, false),
       special_surface  = nullif(special_surface, false),
       special_position = nullif(special_position, false)
 where water_supply is not null or electricity is not null or sanitation is not null
    or maid_room is false or driver_room is false or extension is false
    or special_surface is false or special_position is false;
