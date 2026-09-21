-- THE BARRIER I BUILT THIS MORNING COULD NOT HAVE CAUGHT THE BUG I BUILT IT FOR.
-- (routine #9, 2026-09-21 — a defect in 20260921152933/153114, caught by watching it run)
--
-- `search_index_writer_pass:<function>` keys the evidence on the FUNCTION. Measured at 16:22Z,
-- the counter for sync_listing_rich_attrs jumped 1 -> 104 in a single transaction, because
-- sync_search_listings_ar (cron jobid 28, hourly at :22) calls sync_all_rich_attrs, which loops
-- every platform in listing_rich_attrs and calls sync_listing_rich_attrs(t) once each.
--
-- And its signature is the whole problem:
--
--     sync_all_rich_attrs(p_exclude text[] DEFAULT ARRAY['wasalt_residential_listings'])
--
-- wasalt is EXCLUDED from the hourly path by design — it is large, so it has its own daily job 68.
-- So the function-keyed record is refreshed every hour by ~103 OTHER platforms, and jobid 68 could
-- stop running forever while `last_pass` stayed minutes old. mon_detect_search_writer_starved()
-- would have read that as healthy. The detector built this morning to catch ops_incident #388 could
-- not have caught ops_incident #388.
--
-- This is ops_incident #391's pattern arriving inside the fix that filed it: the predicate was
-- right and the population it was applied to was wrong. A nested call and a scheduled run are not
-- the same event, and only one of them answers "did this job do its work?".
--
-- THE DISCRIMINATOR IS THE TOP-LEVEL QUERY, not the plpgsql frame. current_query() returns the
-- statement the session submitted — for a pg_cron backend, that is the job's own command verbatim.
-- The evidence already in this table proves the shape: the shared refusal row's note reads
-- `select public.sync_payment_monthly();`, which is cron jobid 44's command exactly. A nested call
-- inside jobid 28 therefore attributes to jobid 28, which is correct: jobid 28 really did run.
--
-- This migration only RECORDS the job-keyed evidence. The detector is NOT switched to it here, on
-- purpose: a barrier must be validated against a real scheduled run before anything depends on it,
-- and the note below is what makes that validation possible by reading, not by trusting.
create or replace function public.search_index_writer_lock()
returns boolean
language plpgsql
as $function$
declare ctx text; caller text; q text; job_key text;
begin
  begin
    get diagnostics ctx = pg_context;
    caller := (select m[1]
                 from regexp_matches(coalesce(ctx, ''), 'function ([a-z0-9_]+)\(', 'g') m
                offset 1 limit 1);
  exception when others then caller := null;
  end;
  caller := coalesce(caller, 'direct_sql');
  q := coalesce(current_query(), '?');
  -- md5 of the SUBMITTED statement. A cron job's command hashes to one stable key; a nested call
  -- hashes to the command of whatever job is actually running, never to the job that also happens
  -- to call the same function on a different schedule.
  job_key := 'search_index_writer_pass:job:' || md5(q);

  if pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer')) then
    -- Written inside the caller's transaction on purpose: a pass later rolled back did not happen.
    -- Best-effort for the reason the refusal record is (EXECUTE-granted to anon/authenticated, not
    -- security definer) — a caller that cannot write the log must still get its lock.
    begin
      insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
      values (job_key, now(), 1, left(q, 200))
      on conflict (object_name) do update
        set refreshed_at = excluded.refreshed_at,
            rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
            note         = excluded.note;
    exception when others then null;
    end;
    -- The per-FUNCTION record is KEPT, and is now explicitly a diagnostic rather than evidence of a
    -- scheduled run: "has this function taken the lock at all lately", across every caller.
    begin
      insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
      values ('search_index_writer_pass:' || caller, now(), 1,
              'took the single-writer lock (ANY caller — diagnostic, not per-job evidence)')
      on conflict (object_name) do update
        set refreshed_at = excluded.refreshed_at,
            rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
            note         = excluded.note;
    exception when others then null;
    end;
    return true;
  end if;

  -- The pre-existing SHARED counter, unchanged, so anything already reading it keeps working.
  begin
    insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
    values ('search_index_writer_lock_refused', now(), 1, left(q, 200))
    on conflict (object_name) do update
      set refreshed_at = excluded.refreshed_at,
          rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
          note         = excluded.note;
  exception when others then null;
  end;
  -- The refusal, attributed BOTH ways: by job (what was locked out) and by function (what class).
  begin
    insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
    values ('search_index_writer_refused:job:' || md5(q), now(), 1, left(q, 200))
    on conflict (object_name) do update
      set refreshed_at = excluded.refreshed_at,
          rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
          note         = excluded.note;
  exception when others then null;
  end;
  begin
    insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
    values ('search_index_writer_refused:' || caller, now(), 1, left(q, 200))
    on conflict (object_name) do update
      set refreshed_at = excluded.refreshed_at,
          rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
          note         = excluded.note;
  exception when others then null;
  end;

  raise notice 'search_listings_ar single-writer lock is held by another transaction; this pass is a NO-OP and reports NULL (not 0)';
  return false;
end $function$;

-- The function-keyed pass rows written before this change are evidence of the OLD, conflated kind.
-- They are left in place (they are honest about what they measured) but their notes now say so, so
-- nobody reads a 16:22 timestamp on sync_listing_rich_attrs as "job 68 ran".
update public.mon_mv_refresh_log
   set note = 'took the single-writer lock (ANY caller — diagnostic, not per-job evidence)'
 where object_name like 'search_index_writer_pass:%'
   and object_name not like 'search_index_writer_pass:job:%'
   and note = 'took the single-writer lock';