-- Owner 2026-11-01 («fix everything, root if possible»): the eleven routines were deleted 2026-09-27, but three
-- detectors kept judging them, so 31 P1/P0 alarms could never clear and crowded the repair queue.
-- mon_detect_routine_sentry_silent now watches the engineers that exist: a run leaves a :start row (the
-- trg_engineer_start_from_plan trigger guarantees it). The other two measured a process that no longer exists
-- (GitHub issue assignment, ops_incident owners); ops_engineer_alert_queue is the live queue.
create or replace function public.mon_detect_routine_sentry_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  slot record;
  live_keys text[] := '{}'::text[];
begin
  for slot in
    select e.lane, e.stale_after,
           (select max(r.run_at) from public.ops_daily_engineer_run r where r.phase = e.lane || ':start') as last_ran_at
      from (values ('scraping-engineer', interval '30 hours'),
                   ('new_listings_engineer', interval '30 hours'),
                   ('advanced_filter', interval '30 hours'),
                   ('lifecycle', interval '30 hours'),
                   ('qa', interval '30 hours'),
                   ('falcon', interval '100 hours')) as e(lane, stale_after)
  loop
    if slot.last_ran_at is null or slot.last_ran_at < now() - slot.stale_after then
      n := n + public.mon_raise('P1', 'routine_sentry_silent', null,
        'routine_sentry_silent:' || slot.lane,
        jsonb_build_object(
          'engineer', slot.lane,
          'last_ran_at', slot.last_ran_at,
          'threshold_hours', extract(epoch from slot.stale_after) / 3600,
          'why', 'This engineer has no :start row inside its window, so its night did not run.',
          'action', 'Read the routine''s list_runs and the weekly usage limit. A run that hit the limit is a missed night: say so in LINE 1.'));
      live_keys := live_keys || ('routine_sentry_silent:' || slot.lane);
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('routine_sentry_silent', live_keys);
  return n;
end $function$;

create or replace function public.mon_detect_alert_queue_unworked()
 returns integer
 language plpgsql
as $function$
begin
  perform public.mon_resolve_stale_keys('alert_queue_unworked', '{}'::text[]);
  return 0;
end $function$;

create or replace function public.mon_detect_stalled_incident()
 returns integer
 language plpgsql
as $function$
begin
  perform public.mon_resolve_stale_keys('incident_stalled', '{}'::text[]);
  return 0;
end $function$;

select public.mon_detect_routine_sentry_silent(), public.mon_detect_alert_queue_unworked(), public.mon_detect_stalled_incident();

do $$
declare v_dead int; v_live int;
begin
  select count(*) into v_dead from public.alert_event
   where resolved_at is null
     and (kind in ('alert_queue_unworked','incident_stalled')
          or (kind = 'routine_sentry_silent' and dedup_key like 'routine_sentry_silent:routine-%'));
  if v_dead <> 0 then raise exception 'alarms about deleted routines still open: %', v_dead; end if;
end $$;
