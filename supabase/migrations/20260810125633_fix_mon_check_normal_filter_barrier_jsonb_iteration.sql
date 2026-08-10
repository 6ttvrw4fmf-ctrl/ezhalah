-- Fix: iterate the barrier row via to_jsonb (dynamic ($1).col record access isn't valid plpgsql, it
-- raised 42703 "could not identify column" at runtime). Idempotent re-affirm of the corrected function.
create or replace function public.mon_check_normal_filter_barrier()
 returns integer language plpgsql as $fn$
declare j jsonb; total int := 0; col text; v int;
begin
  select to_jsonb(b) into j from public.mon_normal_filter_barrier b;
  for col in select jsonb_object_keys(j) loop
    v := coalesce((j->>col)::int, 0);
    if v > 0 then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('normal_filter_barrier_'||col, v,
              'Normal Filter barrier regression: '||col||'='||v||' (Ezhalah-side mistake; source-published unusual values are exempt).');
    end if;
  end loop;
  return total;
end $fn$;
