-- Round 2 of the Advanced Filter source-truth repair (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md).
-- Step 1/3: widen the reversibility snapshot to cover the columns round 2 will clear.
alter table aqar_amenity_fabrication_repair_20260809
  add column if not exists water_supply     boolean,
  add column if not exists electricity      boolean,
  add column if not exists sanitation       boolean,
  add column if not exists maid_room        boolean,
  add column if not exists driver_room      boolean,
  add column if not exists extension        boolean,
  add column if not exists special_surface  boolean,
  add column if not exists special_position boolean;
