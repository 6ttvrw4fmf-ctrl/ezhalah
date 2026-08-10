-- ============================================================================
-- FIELD-LEVEL SAFETY BARRIER (schema + tripwire)   owner rule, 2026-08-10
--
--   Verified structured source YES/value -> store it
--   Explicit structured source NO        -> false
--   Source silent                        -> NULL
--   Never manufacture false from absence
--
-- 15 boolean attribute columns across the platform tables once carried a column
-- DEFAULT of `false`. The defaults were dropped 2026-08-09, but rows written
-- before that still hold an invented `false` no source ever stated — downstream
-- indistinguishable from a real "no".
--
-- This migration installs the audit table and the permanent tripwire. The data
-- repair itself runs as a batched script (the platform tables carry expression
-- indexes that make a single fleet-wide UPDATE exceed the statement timeout) and
-- is recorded row-by-row in ops_manufactured_negative_repair.
-- ============================================================================

create table if not exists public.ops_manufactured_negative_repair (
  id            bigserial primary key,
  repaired_at   timestamptz not null default now(),
  tbl           text        not null,
  col           text        not null,
  cells_nulled  bigint      not null,
  evidence      text        not null
);

comment on table public.ops_manufactured_negative_repair is
  'Safety Barrier audit trail: which (table,column) pairs had invented false values converted to NULL, and how many.';

-- The boolean attribute set governed by the barrier.
create or replace function public.barrier_attribute_columns()
returns text[] language sql immutable as $$
  select array[
    'elevator','parking','kitchen','air_conditioner','maid_room','driver_room',
    'private_entrance','balcony_terrace','laundry_room','optical_fibers',
    'separate_water_meter','separate_electricity_meter','car_entrance',
    'water_supply','electricity','sanitation','villa_on_roof'
  ]::text[];
$$;

-- TRIPWIRE. A (platform,column) holding `false` while never once producing
-- `true` anywhere in that platform's inventory is the signature of a
-- DEFAULT-false invented negative: a scraper that genuinely reads an attribute
-- produces both polarities. Grouped by PLATFORM so one true in either the
-- residential or commercial table vindicates the column.
-- MUST return zero rows. Non-empty => someone reintroduced absence-as-false.
create or replace function public.detect_manufactured_negatives()
returns table(platform text, col text, n_false bigint)
language plpgsql stable as $$
declare c text; p text; t text; v_true bigint; v_false bigint; tt bigint; ff bigint;
begin
  foreach c in array public.barrier_attribute_columns() loop
    for p in select distinct regexp_replace(table_name,'_(residential|commercial)_listings$','')
             from information_schema.tables
             where table_schema='public'
               and (table_name like '%\_residential\_listings' or table_name like '%\_commercial\_listings')
               and table_name not like '%backup%'
    loop
      v_true := 0; v_false := 0;
      for t in select table_name from information_schema.tables
               where table_schema='public'
                 and table_name in (p||'_residential_listings', p||'_commercial_listings')
      loop
        if not exists (select 1 from information_schema.columns ic
                       where ic.table_schema='public' and ic.table_name=t and ic.column_name=c) then continue; end if;
        execute format('select count(*) filter (where %I is true), count(*) filter (where %I is false) from public.%I', c, c, t)
          into tt, ff;
        v_true := v_true + coalesce(tt,0);
        v_false := v_false + coalesce(ff,0);
      end loop;
      if v_true = 0 and v_false > 0 then
        platform := p; col := c; n_false := v_false; return next;
      end if;
    end loop;
  end loop;
end $$;

comment on function public.detect_manufactured_negatives() is
  'Safety Barrier tripwire. Returns (platform,column) pairs holding false with zero true anywhere - the signature of an invented negative. MUST stay empty.';

-- Guard the other half of the defect: no attribute column may carry a DEFAULT again.
create or replace function public.detect_boolean_column_defaults()
returns table(tbl text, col text, col_default text)
language sql stable as $$
  select c.table_name::text, c.column_name::text, c.column_default::text
  from information_schema.columns c
  where c.table_schema='public'
    and (c.table_name like '%\_residential\_listings' or c.table_name like '%\_commercial\_listings')
    and c.table_name not like '%backup%'
    and c.column_name = any(public.barrier_attribute_columns())
    and c.column_default is not null;
$$;

comment on function public.detect_boolean_column_defaults() is
  'Safety Barrier tripwire. A DEFAULT on any attribute column silently manufactures a value for every row that omits it. MUST stay empty.';
