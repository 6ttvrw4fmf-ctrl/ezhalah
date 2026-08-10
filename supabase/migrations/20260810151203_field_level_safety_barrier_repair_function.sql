-- Repair one platform's invented negatives. Called per-table by the rollout
-- script because the platform tables carry expression indexes that make a
-- single fleet-wide UPDATE exceed the statement timeout.
--
-- SAFETY: only ever writes NULL, and only over `false`. Never creates a true,
-- never changes a true, never touches any column outside
-- barrier_attribute_columns(). A column is repaired only when the PLATFORM
-- (both its tables) has produced zero `true` for it anywhere.
create or replace function public.repair_manufactured_negatives(p_platform text, p_dry_run boolean default false)
returns table(tbl text, col text, cells bigint)
language plpgsql as $$
declare c text; t text; v_true bigint; v_false bigint; tt bigint; ff bigint; n bigint;
begin
  foreach c in array public.barrier_attribute_columns() loop
    v_true := 0; v_false := 0;
    for t in select table_name from information_schema.tables
             where table_schema='public'
               and table_name in (p_platform||'_residential_listings', p_platform||'_commercial_listings')
    loop
      if not exists (select 1 from information_schema.columns ic
                     where ic.table_schema='public' and ic.table_name=t and ic.column_name=c) then continue; end if;
      execute format('select count(*) filter (where %I is true), count(*) filter (where %I is false) from public.%I', c, c, t)
        into tt, ff;
      v_true := v_true + coalesce(tt,0);
      v_false := v_false + coalesce(ff,0);
    end loop;

    if v_true > 0 or v_false = 0 then continue; end if;  -- trusted, or nothing to do

    for t in select table_name from information_schema.tables
             where table_schema='public'
               and table_name in (p_platform||'_residential_listings', p_platform||'_commercial_listings')
    loop
      if not exists (select 1 from information_schema.columns ic
                     where ic.table_schema='public' and ic.table_name=t and ic.column_name=c) then continue; end if;
      if p_dry_run then
        execute format('select count(*) from public.%I where %I is false', t, c) into n;
      else
        execute format('update public.%I set %I = null where %I is false', t, c, c);
        get diagnostics n = row_count;
        if n > 0 then
          insert into public.ops_manufactured_negative_repair(tbl, col, cells_nulled, evidence)
          values (t, c, n, 'zero true across the whole platform inventory => false is DEFAULT residue, not a published NO');
        end if;
      end if;
      if n > 0 then tbl := t; col := c; cells := n; return next; end if;
    end loop;
  end loop;
end $$;

comment on function public.repair_manufactured_negatives(text, boolean) is
  'Field-level Safety Barrier repair. Converts invented false (DEFAULT residue) to NULL for one platform. Only ever writes NULL over false.';
