-- Senior run #32b: make the amenity source-probe registry general (it will hold more than aqar
-- commercial), and give it the uniqueness the barriers key off.
alter table public.ops_aqar_commercial_amenity_probe
  add column if not exists source_table text;

update public.ops_aqar_commercial_amenity_probe
   set source_table = 'aqar_commercial_listings'
 where source_table is null;

alter table public.ops_aqar_commercial_amenity_probe
  alter column source_table set not null;

-- One row per (source_table, column): the newest probe is the standing verdict.
create unique index if not exists ops_amenity_probe_uniq
  on public.ops_aqar_commercial_amenity_probe (source_table, column_name);
