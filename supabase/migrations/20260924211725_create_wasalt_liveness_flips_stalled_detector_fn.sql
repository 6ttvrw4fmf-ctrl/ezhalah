-- IS WASALT'S LIVENESS PIPELINE ACTUALLY CONFIRMING/SELF-HEALING ANYTHING, OR JUST STRIKING?
--
-- Guards the invariant that migration 20260924210249 and the enum-rollup clock fix
-- (scrapers/wasalt/liveness.py::rollup_started_at()) exist to restore, per
-- scripts/verify-repair-migrations-are-guarded.ts's rule that a data repair must ship with
-- something that watches the invariant going forward, not just fix it once.
--
-- THE SHAPE THIS CATCHES. `run_enum_strike()`'s control-group guard (control_ok()) aborts every
-- flip on a run when it cannot verify a sample of known-live rows as live — a deliberately
-- conservative fail-closed design, correct on any ONE run. But a checker that is STRUCTURALLY unable
-- to ever pass that guard (the clock bug: enum_start read from the rollup's own clock, ~3h after the
-- enumeration it summarises) aborts EVERY run forever, and nothing before this detector distinguished
-- "one bad day" from "permanently stuck": three consecutive aborted runs (2026-09-20, 09-22, 09-24)
-- produced zero confirms, zero self-heals, zero kills, and the fleet-wide checking-rate detector
-- (ops_liveness_checking_shortfall) could not see it — that detector counts PROBES
-- (last_liveness_probe_at), and the strike step keeps stamping that on every row it touches even
-- while every flip aborts. A checker that is running, striking, and stamping probes on schedule
-- while never once confirming or self-healing anything reads as healthy to every other detector in
-- the fleet.
--
-- THE RULE: 3 consecutive enum-strike runs, all aborted_flips=true, is never a coincidence worth
-- waiting out — control_ok()'s own design means a single unhealthy proxy blip aborts one run, not
-- three in a row on a checker whose transport otherwise works. Alerts once per stuck streak
-- (dedup keyed on the OLDEST run in the streak, so a NEW run extending an existing streak does not
-- re-raise, but the streak clearing does resolve it).
create or replace function public.mon_detect_wasalt_liveness_flips_stalled()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recent record;
  v_ids bigint[];
  v_all_aborted boolean;
  v_oldest_id bigint;
  v_raised int := 0;
  v_dedup text;
begin
  select array_agg(id order by started_at desc) as ids,
         bool_and(coalesce(skipped, 0) = 1) as all_aborted,
         min(id) as oldest_id
    into v_ids, v_all_aborted, v_oldest_id
    from (
      select id, skipped from public.wasalt_liveness_runs
       where mode = 'enum-strike'
       order by started_at desc
       limit 3
    ) recent;

  if v_ids is null or array_length(v_ids, 1) < 3 then
    -- fewer than 3 enum-strike runs ever recorded: nothing to judge yet, not a finding.
    perform public.mon_resolve('wasalt_liveness_flips_stalled', 'wasalt');
    return 0;
  end if;

  v_dedup := 'wasalt_liveness_flips_stalled:' || v_oldest_id;

  if v_all_aborted then
    perform public.mon_raise('P1', 'wasalt_liveness_flips_stalled', 'wasalt', v_dedup,
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
