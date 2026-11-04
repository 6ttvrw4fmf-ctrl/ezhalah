-- cron.job_run_details keeps 30 days, not forever (owner decision 3, 2026-11-04, «Yes, use your picks»).
--
-- MEASURED before this change: 260,081 rows, 72 MB, oldest 2026-06-11; 162,989 of them older than 30
-- days. The table has only its runid primary key and grows ~8,500 rows a day. Every reader of it was
-- read back from production the same day: the longest window any public function or view applies to
-- job_run_details is 7 days (mon_cron_expected_gap, mon_cron_frozen_jobs, mon_cron_hog_windows,
-- mon_cron_starved_schedules_with_evidence, mon_cron_victim_proven_alongside_hog,
-- mon_detect_cron_grace_below_cadence, mon_detect_detector_sweep_budget,
-- mon_detect_gathern_rating_source_truth); ops_freshness_by_layer reads the newest success only. The
-- 45-day / 1000-hour / 30-day / 14-day windows in mon_detect_liveness_job_silent,
-- mon_detect_loc_rel_capacity_risk, mon_sample_search_latency and ops_run_cron_bundle are on OTHER
-- tables. So 30 days keeps 4x the longest reader.
--
-- THE FLOOR IS 30 DAYS AND IS ENFORCED IN THE FUNCTION, not only in the schedule: a call asking to keep
-- fewer days raises. scripts/verify-cron-history-retention-floor.ts pins the floor, the schedule and
-- that no committed reader of job_run_details looks back further than it.
--
-- BATCHED: the newest runid older than the cutoff is found once, then rows go 5,000 at a time down the
-- primary key (runid is assigned at start, so "older than the cutoff" is a runid prefix; the start_time
-- test is kept on every batch so a runid out of order is never deleted early). At most 40 batches a run
-- (200,000 rows), so the first run clears the backlog and every later run deletes about one day.
-- Scheduled daily at 01:27 UTC (04:27 Riyadh), a minute no other job starts in.
create or replace function public.ops_purge_cron_run_history(
  p_keep_days int default 30, p_batch int default 5000, p_max_batches int default 40)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'cron'
as $function$
declare
  floor_days constant int := 30;
  v_cutoff timestamptz;
  v_max_runid bigint;
  v_n int;
  v_total bigint := 0;
  v_batches int := 0;
begin
  if p_keep_days is null or p_keep_days < floor_days then
    raise exception 'ops_purge_cron_run_history: refusing to keep fewer than % days of cron history (asked %)',
      floor_days, p_keep_days;
  end if;
  if p_batch is null or p_batch < 1 or p_batch > 20000 then
    raise exception 'ops_purge_cron_run_history: batch % out of range 1..20000', p_batch;
  end if;
  v_cutoff := now() - make_interval(days => p_keep_days);
  select max(d.runid) into v_max_runid from cron.job_run_details d where d.start_time < v_cutoff;
  if v_max_runid is not null then
    loop
      delete from cron.job_run_details d
       where d.runid in (select x.runid from cron.job_run_details x
                          where x.runid <= v_max_runid and x.start_time < v_cutoff
                          order by x.runid limit p_batch);
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
      v_batches := v_batches + 1;
      exit when v_n < p_batch or v_batches >= coalesce(p_max_batches, 40);
    end loop;
  end if;
  return jsonb_build_object('deleted', v_total, 'batches', v_batches, 'keep_days', p_keep_days,
                            'cutoff', v_cutoff);
end
$function$;

revoke all on function public.ops_purge_cron_run_history(int, int, int) from public, anon, authenticated;

do $mig$
begin
  if exists (select 1 from cron.job where jobname = 'purge-cron-run-history') then
    raise exception 'purge-cron-run-history already scheduled, refusing to schedule a second copy';
  end if;
  if exists (select 1 from cron.job where active and schedule = '27 1 * * *') then
    raise exception 'another job already starts at 27 1 * * *; re-slot before applying';
  end if;
end
$mig$;

select cron.schedule('purge-cron-run-history', '27 1 * * *',
  $cmd$set statement_timeout to '300s'; select public.ops_purge_cron_run_history(30)$cmd$);
