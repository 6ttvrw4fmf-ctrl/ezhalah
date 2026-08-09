-- Clear manufactured amenity negatives, fleet-wide (docs/ops/EZHALAH_DATA_ARCHITECTURE_GOAL.md).
--
-- Auditing "why is the Advanced Filter effectively aqar-only" found the real answer: it is NOT
-- mainly a plumbing gap. 20 platforms had amenity booleans stored, but on every one except gathern
-- the distribution was ZERO true and thousands of false — and grep proves those scrapers never
-- write the fields at all (dealapp/aqarcity/mustqr/sanadak/raghdan: 0 references to `elevator`).
-- Every stored value was a `DEFAULT false` artifact, invented by the schema.
--
-- Exposing that through listing_extra_attrs would have added not one qualifying listing (0 true
-- everywhere) and thousands of fake "no" answers. So the correct first move is to clear it, which
-- also makes mon_advanced_filter_field_fidelity meaningful for these platforms.
--
-- Rule applied per (table, field): n_true = 0 AND n_false >= 50 over the active cohort. Zero
-- positives across a whole cohort is not credible source data. gathern's elevator (18,051 true /
-- 11,816 false) and parking (9,929 / 19,938) have REAL variance and are deliberately kept.
--
-- Reversible: every cleared value is snapshotted with its table, row id and field.
create table if not exists amenity_all_false_repair_20260809 (
  table_name text, row_id bigint, field text, old_value boolean, captured_at timestamptz default now());

do $$
declare r record; f text; n_true bigint; n_false bigint;
begin
  for r in select table_name from information_schema.tables
           where table_schema='public' and table_name like '%\_residential\_listings' loop
    foreach f in array array['elevator','parking','kitchen','air_conditioner','maid_room',
                             'driver_room','private_entrance'] loop
      execute format('select count(*) filter (where %I), count(*) filter (where not %I) from public.%I where active',
                     f, f, r.table_name) into n_true, n_false;
      if n_true = 0 and n_false >= 50 then
        execute format('insert into amenity_all_false_repair_20260809(table_name,row_id,field,old_value)
                        select %L, id, %L, %I from public.%I where active and %I is not null',
                       r.table_name, f, f, r.table_name, f);
        execute format('update public.%I set %I = null where active and %I is not null',
                       r.table_name, f, f);
      end if;
    end loop;
  end loop;
end $$;
