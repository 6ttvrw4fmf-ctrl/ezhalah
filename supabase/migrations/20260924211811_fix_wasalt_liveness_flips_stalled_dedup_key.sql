-- FIX: the previous version keyed dedup on min(id) of the LAST 3 runs, which slides forward every
-- time a new run extends an ongoing streak — so a still-broken pipeline would re-raise a fresh alert
-- on every single cycle instead of staying deduped under one standing alert, exactly backwards from
-- what the function's own docstring claimed ("a NEW run extending an existing streak does not
-- re-raise"). mon_raise() already no-ops when the SAME dedup_key is open; the fix is simply to use a
-- STANDING key with no per-run component, so the ongoing condition is one alert regardless of how
-- long the streak runs, and a genuinely NEW future stall (after this one resolves) gets a fresh one.
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
      select id, skipped from public.wasalt_liveness_runs
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
