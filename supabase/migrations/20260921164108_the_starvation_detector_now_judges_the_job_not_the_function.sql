-- THE DETECTOR NOW READS JOB-KEYED EVIDENCE, MEASURED FIRST AND THEN SWITCHED.
-- (routine #9, 2026-09-21 — completes 20260921163024; see that migration for why the old key lied)
--
-- In one line: `search_index_writer_pass:<function>` was refreshed hourly by ~103 OTHER platforms
-- through sync_all_rich_attrs, whose signature EXCLUDES wasalt by default — so jobid 68 could stop
-- running forever and its function-keyed record would always be minutes old. The detector built
-- this morning for ops_incident #388 could not have caught ops_incident #388.
--
-- VALIDATED BEFORE ANYTHING DEPENDED ON IT, against three REAL scheduled runs rather than a belief
-- about what current_query() returns:
--
--   16:35:00  "select public.sync_payment_monthly();"                     -> jobid 44   md5 matched
--   16:37:00  "select public.sync_search_first_seen_at();"                -> jobid 75   md5 matched
--   16:38:00  "SET statement_timeout = '90s'; SELECT public.propagate_…"  -> jobid 61   md5 matched
--
-- The third is the one that mattered: a MULTI-STATEMENT command still hashes to its cron row
-- exactly, so `md5(current_query()) = md5(cron.job.command)` is a real join and not a hopeful one.
--
-- THE INSTALL GRACE, and why it is not a way of going quiet. A job that has simply not reached its
-- first slot since this instrument existed has no record, and "never observed" is not "starved".
-- The grace is bounded by the job's OWN cadence and measured from a recorded install time, so it
-- expires on its own and cannot be extended by forgetting. Everything past that fails CLOSED: no
-- record after a full cadence IS starvation, which is the direction this repo has been burned by.
--
-- What this predicts, out loud, so tomorrow is a test and not a shrug: jobid 68 did NOT run today
-- (it was refused at 06:47:00.057 and its work was done by hand at 15:29). Its first real job-keyed
-- pass should appear at 06:46 tomorrow, on the schedule this run moved it to. If it does not, this
-- detector raises a P2 naming it — which is the whole point.
insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
values ('search_index_writer_job_evidence_installed', now(), 1,
        'job-keyed writer evidence began here; the detector gives each job one full cadence from this instant before absence counts as starvation')
on conflict (object_name) do nothing;

create or replace function public.mon_detect_search_writer_starved()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; starved text[] := '{}'::text[]; installed_at timestamptz;
begin
  select refreshed_at into installed_at
    from public.mon_mv_refresh_log
   where object_name = 'search_index_writer_job_evidence_installed';
  -- Fail closed on a missing marker: judge everything rather than skip everything.
  installed_at := coalesce(installed_at, 'epoch'::timestamptz);

  for rec in
    with writers as (
      -- CALLS the lock, never merely names it (20260921153114: a LIKE matched this detector itself).
      select p.proname as fn
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prosrc ~ 'search_index_writer_lock\s*\('
         and p.proname <> 'search_index_writer_lock'
    ),
    scheduled as (
      select distinct j.jobid, j.jobname, j.schedule, j.command,
             -- A plain number in the HOUR field means a daily job: one chance a day, so 26h of
             -- grace. Anything else runs at least hourly; 3h means it has missed at least two.
             case when split_part(j.schedule, ' ', 2) ~ '^[0-9]' then interval '26 hours'
                  else interval '3 hours' end as max_age
        from cron.job j
       where j.active
         and exists (select 1 from writers w where position(w.fn in j.command) > 0)
    )
    select s.jobid, s.jobname, s.schedule, s.max_age,
           p.refreshed_at as last_pass,
           r.refreshed_at as last_refused
      from scheduled s
      left join public.mon_mv_refresh_log p
             on p.object_name = 'search_index_writer_pass:job:'    || md5(s.command)
      left join public.mon_mv_refresh_log r
             on r.object_name = 'search_index_writer_refused:job:' || md5(s.command)
     order by s.jobid
  loop
    -- Never observed, and not yet given one full cadence since the instrument existed: no verdict.
    if rec.last_pass is null and now() - installed_at < rec.max_age then
      continue;
    end if;
    if rec.last_pass is null or rec.last_pass < now() - rec.max_age then
      starved := starved || format(
        'jobid %s (%s, "%s"): last pass %s, tolerance %s, last refusal %s',
        rec.jobid, coalesce(rec.jobname, '(unnamed)'), rec.schedule,
        coalesce(rec.last_pass::text, 'NEVER RECORDED'), rec.max_age::text,
        coalesce(rec.last_refused::text, 'none recorded'));
    end if;
  end loop;

  if cardinality(starved) > 0 then
    n := public.mon_raise('P2', 'search_writer_starved', 'search_listings_ar',
      'search_writer_starved',
      jsonb_build_object(
        'starved', to_jsonb(starved),
        'count', cardinality(starved),
        'why', 'These cron jobs write search_listings_ar behind pg_try_advisory_xact_lock('
            || '''search_listings_ar:single_writer''). A refused pass returns immediately and '
            || 'writes nothing, while cron.job_run_details records status=succeeded — so a job '
            || 'that has not done its work for days is invisible. Evidence is keyed on the JOB '
            || '(md5 of its command, matched against current_query()), never on the function: '
            || 'sync_listing_rich_attrs is called hourly for ~103 platforms by sync_all_rich_attrs, '
            || 'which excludes wasalt by default, so a function-keyed record masked jobid 68 '
            || 'entirely. Measured 2026-09-21: jobid 68 lost the lock to jobid 75 by 5.5 ms on 5 of '
            || 'its last 8 daily runs.',
        'action', 'Move one of the colliding jobs to a minute no other search-index writer runs in. '
            || 'Do NOT widen the tolerance and do NOT drop the lock: the lock is correct and the '
            || 'schedule is what is wrong. Find the co-scheduled writer with: select jobid, '
            || 'schedule, command from cron.job where active and command ~ ''sync_|refresh_|propagate_'';'));
  else
    perform public.mon_resolve('search_writer_starved', 'search_listings_ar');
  end if;
  return n;
end $function$;