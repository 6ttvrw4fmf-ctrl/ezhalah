-- Make the :22 search-index sync read a SETTLED location snapshot.
--
-- pg_cron runs a job's whole command string as ONE transaction, so jobid 17's
-- `refresh materialized view concurrently public.listing_native_location_v1` becomes visible to
-- other backends only at that job's COMMIT. jobid 17 starts at :20 and routinely runs longer than
-- the two minutes before jobid 28 starts at :22 -- 10 of the 29 hours ending 2026-09-27 22:00 UTC
-- (11:20 = 10m00s, 06:20 = 6m59s, 17:20 = 5m39s, 22:20 = 2m53s, 20:20 = 2m48s, ...). Because the
-- refresh is CONCURRENTLY it never blocks and never errors its reader: jobid 28 silently built
-- search_listings_ar from the PREVIOUS snapshot and still reported success, so a committed
-- location change reached users one hour late, sometimes two.
--
-- Live instance while writing this: listing_id 762322 (AQM6095977, aqarmonthly) had its bridge
-- district cleared at 21:44 UTC; listing_native_location_v1.district_ar is NULL while
-- search_listings_ar.district_ar still serves the previous value.
--
-- mon_detect_sync_ran_against_stale_snapshot (jobid 135, :49) has had P1 alert_event 5084 open on
-- exactly this since 2026-09-24 05:49 UTC, and its own text already named the remedy: "the defect
-- is refresh ORDERING - the sync depends on a wall-clock offset instead of on the refresh having
-- committed."
--
-- FIX: replace the wall-clock assumption with a real dependency. jobid 17 takes a
-- TRANSACTION-scoped advisory lock as its first statement; jobid 28 waits on the same lock before
-- it syncs. Transaction-scoped is the whole point: because pg_cron wraps each command in one
-- transaction, the lock is released at exactly the instant jobid 17 COMMITS -- the instant the new
-- snapshot becomes visible -- and also on abort, with nothing left to leak or unlock by hand.
--
-- NOT CHANGED: both schedules. jobid 17 stays at '20 * * * *' and jobid 28 at '22 * * * *', so the
-- cron minute-collision counts, mon_detect_cron_starvation_risk and every detector keyed on these
-- jobs see exactly what they saw before. Widening the gap was considered and rejected: it is the
-- same wall-clock guess with a larger number, and jobid 17 has already taken 10 minutes once in
-- the last day. Chaining both into one job was also rejected: it would destroy jobid 28's identity,
-- which several detectors and the minute census are keyed on.

do $mig$
declare
  v17       text;
  v28       text;
  v_key     bigint := hashtext('location_pipeline:v1_refresh');
  -- Both prefixes restate the job's EXISTING statement_timeout first, so that the first parseable
  -- budget in each command -- which is what mon_detect_cron_timeout_headroom reads as the job's
  -- budget -- is unchanged by this migration. The duplicate SET is a no-op.
  v_pre17   constant text :=
       'set statement_timeout to ''900s''; '
    || 'select pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh'')); ';
  -- lock_timeout bounds the wait at 540s, below jobid 28's own 600s statement budget, so a wait
  -- that never ends reports AS a wait: Postgres says "canceling statement due to lock timeout",
  -- which mon_detect_cron_timeout_headroom's LIMB 2 (return_message ilike '%statement timeout%')
  -- deliberately does not classify as a budget problem -- because it is not one. Reset to '0' (the
  -- instance default) so the sync's own statements do not inherit it. 540s covers every jobid 17
  -- run observed; beyond that jobid 17 is itself broken and both jobs should fail loudly rather
  -- than quietly serve the stale hour this migration exists to remove.
  v_pre28   constant text :=
       'set statement_timeout to ''600s''; '
    || 'set lock_timeout to ''540s''; '
    || 'select pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh'')); '
    || 'set lock_timeout to ''0''; ';
begin
  select command into v17 from cron.job
   where jobid = 17 and jobname = 'refresh_listing_native_location_v1' and active;
  select command into v28 from cron.job
   where jobid = 28 and jobname = 'sync-search-listings-ar' and active;

  if v17 is null or v28 is null then
    raise exception 'jobs 17/28 are not both present and active (17 found=%, 28 found=%)',
      (v17 is not null), (v28 is not null);
  end if;

  -- The ordering lock must NEVER be the single-writer key: jobid 17 holding THAT one would make
  -- sync_search_listings_ar()'s pg_try_advisory_xact_lock fail and return zero rows -- a silent
  -- no-op read as success, which is the exact failure shape this migration removes.
  if v_key = hashtext('search_listings_ar:single_writer') then
    raise exception 'ordering lock key collides with the search-index single-writer lock';
  end if;

  -- Preconditions on the LIVE command text. jobid 17's listing_extra_attrs_mv /
  -- listing_age_resolved_mv refreshes were added dynamically by 20260927051226 and are not a
  -- literal in any migration file, so this command must only ever be PREPENDED to -- never rebuilt
  -- from repo text, which would silently drop them and let the saved attribute copies go stale.
  if position('listing_extra_attrs_mv' in v17) = 0
  or position('listing_age_resolved_mv' in v17) = 0 then
    raise exception 'jobid 17 no longer refreshes both saved attribute copies; refusing to rewrite it';
  end if;
  if position('listing_extra_attrs_mv'  in v17) > position('listing_native_location_v1' in v17)
  or position('listing_age_resolved_mv' in v17) > position('listing_native_location_v1' in v17) then
    raise exception 'jobid 17 must refresh both saved attribute copies BEFORE listing_native_location_v1';
  end if;
  if position('sync_search_listings_ar' in v28) = 0 then
    raise exception 'jobid 28 no longer calls sync_search_listings_ar; refusing to rewrite it';
  end if;

  if position('pg_advisory_xact_lock' in v17) = 0 then
    perform cron.alter_job(17, command := v_pre17 || v17);
  end if;
  if position('pg_advisory_xact_lock' in v28) = 0 then
    perform cron.alter_job(28, command := v_pre28 || v28);
  end if;

  -- Post-checks: read back what the server actually stored.
  select command into v17 from cron.job where jobid = 17;
  select command into v28 from cron.job where jobid = 28;

  if position('pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh''))' in v17) = 0
  or position('pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh''))' in v28) = 0 then
    raise exception 'the ordering lock is not present on BOTH jobs after alter';
  end if;
  if position('sync_search_listings_ar' in v28) < position('pg_advisory_xact_lock' in v28) then
    raise exception 'jobid 28 must take the ordering lock BEFORE it syncs';
  end if;
  if (regexp_match(v17, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1] <> '900'
  or (regexp_match(v28, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1] <> '600' then
    raise exception 'the budget mon_detect_cron_timeout_headroom reads must stay 900s/600s';
  end if;
  if (select schedule from cron.job where jobid = 17) <> '20 * * * *'
  or (select schedule from cron.job where jobid = 28) <> '22 * * * *' then
    raise exception 'this migration must not change either schedule';
  end if;
end
$mig$;

-- The detector has to be corrected in the SAME change, or it becomes a permanent false P1.
--
-- It compares the refresh's end_time against the sync's cron START time. That was the right
-- question while the sync read at its start time. Now the sync WAITS, so on any hour where jobid
-- 17 runs past :22 the old predicate would report a stale read that did not happen -- it would
-- fire precisely because the fix is working.
--
-- The honest predicate is "was the snapshot stale at the moment the sync READ", and with the
-- ordering lock in place that moment is greatest(sync_start, refresh_end), which can never precede
-- refresh_end. So the overlap only means a stale read when the ordering lock is NOT installed --
-- and that is now a first-class thing to detect in its own right, because a future session
-- rebuilding either command (as 20260927051226 did) would drop the lock and silently restore the
-- race. mon_sync_read_stale_snapshot() itself is left alone: it is IMMUTABLE and still answers the
-- pure timestamp question it is named for.
create or replace function public.mon_detect_sync_ran_against_stale_snapshot()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; v_cnt int; v_rows jsonb; v_ordered boolean;
begin
  -- Is the refresh -> sync order actually enforced right now? Both jobs must take the SAME
  -- transaction-scoped advisory lock; one of them alone guarantees nothing.
  select count(*) = 2
         and bool_and(j.command like
               '%pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh''))%')
    into v_ordered
    from cron.job j
   where j.jobid in (17, 28) and j.active;

  if not v_ordered then
    n := n + public.mon_raise('P1', 'sync_read_stale_snapshot', 'cron',
      'sync_refresh_ordering_lock_missing',
      jsonb_build_object(
        'why',    'jobid 17 (refresh listing_native_location_v1) and jobid 28 (sync '
               || 'search_listings_ar) no longer BOTH take the transaction-scoped ordering lock '
               || 'pg_advisory_xact_lock(hashtext(''location_pipeline:v1_refresh'')). Without it '
               || 'the sync is back to assuming the refresh fits in the two minutes between :20 '
               || 'and :22. It does not: it ran over on 10 of 29 hours measured 2026-09-27. '
               || 'REFRESH ... CONCURRENTLY does not block readers, so the sync will read the '
               || 'PREVIOUS snapshot and still report success.',
        'action', 'Restore the lock on BOTH jobs by PREPENDING to each live cron.job.command -- '
               || 'never by rebuilding the command from a migration file, because jobid 17''s '
               || 'listing_extra_attrs_mv / listing_age_resolved_mv refreshes were added '
               || 'dynamically and are not a literal anywhere in the repo.'));
  else
    perform public.mon_resolve_key('sync_read_stale_snapshot', 'sync_refresh_ordering_lock_missing');
  end if;

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
    and public.mon_sync_read_stale_snapshot(s.start_time, r.start_time, r.end_time)
    -- With the ordering lock installed the sync does not read at s.start_time; it reads once the
    -- refresh has COMMITTED. An overlap is then expected and harmless, not a stale read.
    and not v_ordered;

  if coalesce(v_cnt, 0) = 0 then
    -- Key-scoped, NOT mon_resolve(kind, platform): this kind now carries a second dedup key
    -- ('sync_refresh_ordering_lock_missing') on the same 'cron' platform, and a kind-wide resolve
    -- here would clear the ordering alert raised a few lines above in the very same call.
    perform public.mon_resolve_key('sync_read_stale_snapshot', 'sync_read_stale_snapshot');
  else
    n := n + public.mon_raise('P1', 'sync_read_stale_snapshot', 'cron', 'sync_read_stale_snapshot',
      jsonb_build_object(
        'overlaps_25h', v_cnt,
        'samples',      v_rows,
        'why',          'jobid 28 built the served search index while jobid 17 had not yet committed the listing_native_location_v1 refresh it reads. REFRESH ... CONCURRENTLY does not block readers, so the sync silently used the previous snapshot and still reported success. Prices, areas and locations written in that pass are stale until the next sync.',
        'do_not',       'Do NOT repair by rewriting listing rows: the raw data is correct and the index is simply behind. Do NOT widen the price_drift tolerance to silence the symptom. The defect is refresh ORDERING - the sync depends on a wall-clock offset instead of on the refresh having committed.',
        'incident',     'ops_incident #354'));
  end if;
  return n;
end $function$;
