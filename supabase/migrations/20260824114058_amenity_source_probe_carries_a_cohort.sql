-- The fabricated-amenity barrier was blind to a COHORT split inside one column.
--
-- mon_detect_fabricated_unpublished_amenity() has been correct since 2026-08-20, but its evidence
-- table is keyed only by (source_table, column_name) -- i.e. a column is either published or not,
-- for the whole table. aqar breaks that assumption: `maid` / `driver` are published on the VILLA ad
-- form and on no other residential form. Measured 2026-08-24 on 76 live aqar pages through
-- production's own oracle (_listing_json from scrapers/aqar/enrich_residential.py), 0 fetch failures:
--
--   * 30 apartment/floor rows that WE store as maid_room/driver_room = true  -> 0/30 carry the key
--   * 16 random apartment/floor rows (unconditioned on stored value)         -> 0/16 carry the key
--   * 20 LAND rows that WE store as maid_room/driver_room = true             -> 0/20 carry the key
--   * 10 villa rows we store as false  (POSITIVE CONTROL, proves the probe   -> 10/10 carry the key,
--     can see the key when the source publishes it)                             `maid:0, driver:0`,
--                                                                                matching our stored
--                                                                                false exactly
--
-- The stored data agrees: `Villa` is the ONLY aqar property_type carrying a single `false`
-- (2,454 maid / 3,192 driver). Every other type holds trues and ZERO falses -- 6,162 maid + 2,021
-- driver assertions the source never published, including a maid's room on 12 plots of LAND.
-- They are the residue of a prose rule the parser retired on 2026-08-23, and they cannot self-heal:
-- _amenities() correctly returns None for an absent key, and _unknown_must_not_overwrite_known()
-- deliberately DROPS a None so the stored value survives. Re-crawling forever will not clear them.
--
-- So the barrier needs the cohort, not a new barrier: same detector, same roster entry, one more
-- dimension on its evidence. A NULL cohort keeps the existing whole-table semantics byte-for-byte.
alter table public.ops_aqar_commercial_amenity_probe
  add column if not exists cohort_column text,
  add column if not exists cohort_values text[],
  add column if not exists cohort_mode   text not null default 'all',
  add column if not exists cohort_label  text;

alter table public.ops_aqar_commercial_amenity_probe
  drop constraint if exists ops_aqar_commercial_amenity_probe_cohort_mode_ck;
alter table public.ops_aqar_commercial_amenity_probe
  add constraint ops_aqar_commercial_amenity_probe_cohort_mode_ck
  check (cohort_mode in ('all','in','not_in')
         and (cohort_mode = 'all') = (cohort_column is null)
         and (cohort_mode = 'all') = (cohort_values is null));

comment on table public.ops_aqar_commercial_amenity_probe is
  'Live-source evidence for whether a platform publishes a given amenity column, optionally narrowed '
  'to a COHORT within the table (cohort_column + cohort_mode in/not_in + cohort_values). '
  'Despite the legacy name it is not commercial-only: aqar residential cohorts live here too. '
  'values_published = 0 means a probed, PARSED sample proved the source states nothing for that '
  '(table, column, cohort). A failed fetch is NOT evidence -- pages_parsed must be the parsed count '
  'and every verdict must name a positive control.';

-- the uniqueness key has to include the cohort, or two cohorts of one column collide
drop index if exists public.ops_aqar_commercial_amenity_probe_source_table_column_name_idx;
drop index if exists public.ops_aqar_commercial_amenity_probe_uniq;
create unique index if not exists ops_aqar_commercial_amenity_probe_uniq
  on public.ops_aqar_commercial_amenity_probe (source_table, column_name, coalesce(cohort_label, ''));
