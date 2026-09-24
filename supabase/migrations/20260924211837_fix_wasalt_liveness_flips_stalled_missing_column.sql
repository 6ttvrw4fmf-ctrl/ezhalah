-- FIX: the inner subquery projected only (id, skipped) but the outer array_agg(... order by
-- started_at desc) referenced started_at, which was never in the CTE's result set — 42703 on every
-- call, so the previous version had never actually run successfully even once.
create or replace function public.mon_detect_wasalt_liveness_flips_stalled()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids bigint[];
  v_all_aborted boolean;
  v_raised int := 0;
begin
  select array_agg(id order by started_at desc) as ids,
         bool_and(coalesce(skipped, 0) = 1) as all_aborted
    into v_ids, v_all_aborted
    from (
      select id, skipped, started_at from public.wasalt_liveness_runs
       where mode = 'enum-strike'
       order by started_at desc
       limit 3
    ) recent;

  if v_ids is null or array_length(v_ids, 1) < 3 then
    perform public.mon_resolve('wasalt_liveness_flips_stalled', 'wasalt');
    return 0;
  end if;

  if v_all_aborted then
    perform public.mon_raise('P1', 'wasalt_liveness_flips_stalled', 'wasalt',
      'wasalt_liveness_flips_stalled:standing',
      jsonb_build_object(
        'run_ids', to_jsonb(v_ids),
        'why', 'the last 3 wasalt enum-strike runs all aborted every flip (control group empty or '
            || 'unhealthy) — zero confirms, zero self-heals, zero kills for at least 3 consecutive '
            || 'cycles. A single aborted run is the guard working correctly; three in a row on a '
            || 'transport that otherwise works means the checker cannot ever pass its own health '
            || 'check, which is exactly the 2026-09-24 enum-rollup clock bug''s shape.',
        'check', 'select started_at, notes from wasalt_liveness_runs where mode=''enum-strike'' '
            || 'order by started_at desc limit 5;',
        'first_symptom', 'notes will show "control group=0" or "aborted_flips=True" on every recent row'));
    v_raised := 1;
  else
    perform public.mon_resolve('wasalt_liveness_flips_stalled', 'wasalt');
  end if;

  return v_raised;
end;
$function$;
