-- The served search index is written by jobid 28 (sync-search-listings-ar, :22), which READS
-- listing_native_location_v1. That matview is rebuilt by jobid 17 (:20) with
-- REFRESH MATERIALIZED VIEW CONCURRENTLY. CONCURRENTLY deliberately does NOT block readers:
-- until the refresh COMMITS, every reader still sees the PREVIOUS snapshot. The gap between
-- the two jobs is two minutes, and job 17 does not always finish inside it.
--
-- When it does not, the sync reads pre-refresh rows, upserts them unchanged, and reports
-- success. Nothing afterwards looks wrong: both jobs record status='succeeded', and
-- mon_mv_refresh_log records a healthy-looking pass (2026-09-20: "upserted=108584").
-- The only visible symptom is a price_drift alert 25 minutes later, which self-heals at the
-- next :22 and therefore reads as noise.
--
-- MEASURED 2026-09-20 (ops_incident #354): job 17 ran 05:20:00 -> 05:26:47 (6m47s) while
-- job 28 started 05:22:00 -- 4m47s before the snapshot it depends on existed. 1,528 listings
-- (1,518 gathern) served a stale price until the 06:22 pass. Over the preceding 7 days,
-- 16 of 168 job-17 runs (9.5%) exceeded the two-minute gap, so this fires about one hour in
-- ten and is not specific to the daily gathern crawl.
--
-- This is the repo's standing shape: "read what the system DID, not what the record claims".
-- Two green job records can still mean the index was built from stale input.

-- The DECISION, separated from the data source so it can be EXECUTED against injected values
-- rather than grepped (AGENTS.md: a source-TEXT tripwire passes for as long as the defect lives).
create or replace function public.mon_sync_read_stale_snapshot(
  p_sync_start timestamptz, p_refresh_start timestamptz, p_refresh_end timestamptz)
returns boolean
language sql
immutable
as $$
  -- The refresh began before the sync (it is the sync's input for that hour) but had not
  -- committed when the sync started: the sync therefore read the previous snapshot.
  select p_refresh_start is not null
     and p_refresh_end   is not null
     and p_sync_start    is not null
     and p_refresh_start <  p_sync_start
     and p_refresh_end   >  p_sync_start;
$$;

comment on function public.mon_sync_read_stale_snapshot(timestamptz, timestamptz, timestamptz) is
  'TRUE when a search-index sync began before the matview refresh it depends on had committed, i.e. it built the served index from a pre-refresh snapshot. Pure, so it can be mutation-proven by execution. ops_incident #354.';

create or replace function public.mon_detect_sync_ran_against_stale_snapshot()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0; v_cnt int; v_rows jsonb;
begin
  select count(*), jsonb_agg(jsonb_build_object(
           'sync_start',            s.start_time,
           'refresh_start',         r.start_time,
           'refresh_end',           r.end_time,
           'sync_started_early_by_s',
             round(extract(epoch from (r.end_time - s.start_time)))::int,
           'refresh_duration_s',
             round(extract(epoch from (r.end_time - r.start_time)))::int)
           order by s.start_time desc)
    into v_cnt, v_rows
  from cron.job_run_details s
  join lateral (
    -- the refresh run that is the sync's input for that hour
    select r2.start_time, r2.end_time
      from cron.job_run_details r2
     where r2.jobid = 17
       and r2.start_time < s.start_time
       and r2.start_time > s.start_time - interval '30 minutes'
     order by r2.start_time desc
     limit 1) r on true
  where s.jobid = 28
    and s.start_time > now() - interval '25 hours'
    and public.mon_sync_read_stale_snapshot(s.start_time, r.start_time, r.end_time);

  if coalesce(v_cnt, 0) = 0 then
    perform public.mon_resolve('sync_read_stale_snapshot', 'cron');
  else
    n := public.mon_raise('P1', 'sync_read_stale_snapshot', 'cron', 'sync_read_stale_snapshot',
      jsonb_build_object(
        'overlaps_25h', v_cnt,
        'samples',      v_rows,
        'why',          'jobid 28 built the served search index while jobid 17 had not yet committed the listing_native_location_v1 refresh it reads. REFRESH ... CONCURRENTLY does not block readers, so the sync silently used the previous snapshot and still reported success. Prices, areas and locations written in that pass are stale until the next sync.',
        'do_not',       'Do NOT repair by rewriting listing rows: the raw data is correct and the index is simply behind. Do NOT widen the price_drift tolerance to silence the symptom. The defect is refresh ORDERING - the sync depends on a wall-clock offset instead of on the refresh having committed.',
        'incident',     'ops_incident #354'));
  end if;
  return n;
end $$;

comment on function public.mon_detect_sync_ran_against_stale_snapshot() is
  'Catches the jobid17/jobid28 refresh-ordering race that builds the served search index from a pre-refresh matview snapshot while both jobs report success. ops_incident #354, found by routine-2-senior-production 2026-09-20.';

-- Registration. mon_detect_orphaned_detectors() accepts reachability from EITHER
-- mon_run_all_detectors OR a cron job; a dedicated job is used here rather than editing the
-- 15k-character roster array, which several sessions edit concurrently. :49 is unoccupied,
-- sits just after mon-price-fidelity (:47) so the two correlate in the alert stream, and is
-- clear of the :29/:59 detector sweep.
select cron.schedule('mon-sync-stale-snapshot', '49 * * * *',
                     'select public.mon_detect_sync_ran_against_stale_snapshot();');

-- MUTATION PROOF. The predicate is EXECUTED against the real measured timestamps of both the
-- failing hour and a healthy hour from the same day. A tripwire that cannot fail is decoration.
do $proof$
begin
  -- 05:20 -> 05:26:47 refresh vs 05:22:00 sync: the measured defect. MUST fire.
  if not public.mon_sync_read_stale_snapshot(
       '2026-09-20 05:22:00.098093+00'::timestamptz,
       '2026-09-20 05:20:00.033033+00'::timestamptz,
       '2026-09-20 05:26:47.145031+00'::timestamptz) then
    raise exception 'mutation proof failed: the measured 2026-09-20 05:20/05:22 overlap did not fire';
  end if;

  -- 04:20 -> 04:21:07 refresh vs 04:22:00 sync: healthy hour, same day. MUST stay silent.
  if public.mon_sync_read_stale_snapshot(
       '2026-09-20 04:22:00.022413+00'::timestamptz,
       '2026-09-20 04:20:00.020226+00'::timestamptz,
       '2026-09-20 04:21:07.740572+00'::timestamptz) then
    raise exception 'mutation proof failed: a refresh that committed before the sync was reported as an overlap';
  end if;

  -- A missing run record is UNKNOWN, never a clean bill of health, but it must not raise either.
  if public.mon_sync_read_stale_snapshot(
       '2026-09-20 04:22:00+00'::timestamptz, null, null) then
    raise exception 'mutation proof failed: a null refresh record was treated as an overlap';
  end if;
end $proof$;
