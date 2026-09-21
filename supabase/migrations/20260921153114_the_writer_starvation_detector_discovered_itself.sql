-- THE DETECTOR DISCOVERED ITSELF AS ONE OF THE WRITERS IT WATCHES.
-- (routine #9, 2026-09-21 — a defect in 20260921152933, caught by reading its own install output)
--
-- mon_detect_search_writer_starved() finds its subjects by shape, which is right, but the shape it
-- used was `prosrc like '%search_index_writer_lock%'` — MENTIONS the lock, not CALLS it. The
-- detector's own body contains that string twice (in the discovery predicate and in the name
-- exclusion), so it matched itself; it owns cron job 140, so it joined `scheduled`; and it can
-- never record a pass, because it never takes the lock. Measured in the install seed, which duly
-- wrote `search_index_writer_pass:mon_detect_search_writer_starved`. Left alone it would have
-- raised a P2 naming itself three hours after install — a detector manufacturing its own alert.
--
-- The discriminator is the CALL, not the mention: `search_index_writer_lock` followed by `(`.
-- Measured over all 11 functions that mention the name: 9 real writers match, the detector and the
-- lock function itself do not. That is the whole difference between a checker and a subject.
--
-- This is the PART 3.3 shape "it asserts source text" arriving inside a fix for something else: a
-- `like` over a function body is a text tripwire, and the repair is to make the text mean the thing
-- it stands for.
create or replace function public.mon_detect_search_writer_starved()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare rec record; n int := 0; starved text[] := '{}'::text[];
begin
  for rec in
    with writers as (
      -- CALLS the lock, never merely names it. A regex, not a LIKE, for exactly that reason.
      select p.proname as fn
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prosrc ~ 'search_index_writer_lock\s*\('
         and p.proname <> 'search_index_writer_lock'
    ),
    scheduled as (
      select w.fn, j.jobid, j.schedule,
             -- A plain number in the HOUR field means a daily job: one chance a day, so 26h of
             -- grace. Anything else runs at least hourly; 3h means it has missed at least two.
             case when split_part(j.schedule, ' ', 2) ~ '^[0-9]' then interval '26 hours'
                  else interval '3 hours' end as max_age
        from writers w
        join cron.job j on j.active and position(w.fn in j.command) > 0
    )
    select s.fn, s.jobid, s.schedule, s.max_age,
           p.refreshed_at as last_pass,
           r.refreshed_at as last_refused
      from scheduled s
      left join public.mon_mv_refresh_log p on p.object_name = 'search_index_writer_pass:'    || s.fn
      left join public.mon_mv_refresh_log r on r.object_name = 'search_index_writer_refused:' || s.fn
     order by s.fn
  loop
    if rec.last_pass is null or rec.last_pass < now() - rec.max_age then
      starved := starved || format(
        '%s (jobid %s, "%s"): last pass %s, tolerance %s, last refusal %s',
        rec.fn, rec.jobid, rec.schedule,
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
        'why', 'These functions write search_listings_ar behind pg_try_advisory_xact_lock('
            || '''search_listings_ar:single_writer''). A refused pass returns immediately and '
            || 'writes nothing, while cron.job_run_details records status=succeeded — so a writer '
            || 'that has not run for days is invisible. Measured 2026-09-21: jobid 68 lost that '
            || 'race to jobid 75 by 5.5 ms on 5 of its last 8 daily runs, leaving wasalt rich '
            || 'attributes stale in the SERVED index while listing_rich_attrs held the truth.',
        'action', 'Move one of the colliding jobs to a minute no other search-index writer runs in. '
            || 'Do NOT widen the tolerance and do NOT drop the lock: the lock is correct and the '
            || 'schedule is what is wrong. Check for a co-scheduled writer with: select jobid, '
            || 'schedule, command from cron.job where active and command ~ ''sync_|refresh_|propagate_'';'));
  else
    perform public.mon_resolve('search_writer_starved', 'search_listings_ar');
  end if;
  return n;
end $function$;

-- The seed row the old predicate wrote for the detector itself. Not a pass, not a writer, no
-- subject: remove it rather than leave a record nothing can ever refresh.
delete from public.mon_mv_refresh_log
 where object_name = 'search_index_writer_pass:mon_detect_search_writer_starved';