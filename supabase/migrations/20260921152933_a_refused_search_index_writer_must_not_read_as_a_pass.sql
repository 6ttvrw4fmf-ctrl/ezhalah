-- A SEARCH-INDEX WRITER THAT NEVER TOOK THE LOCK REPORTS `succeeded` AND WRITES NOTHING.
-- (routine #9 red team, 2026-09-21, class 12 — "a job that runs and changes nothing observable")
--
-- MEASURED, NOT INFERRED. cron jobid 68 (`47 6 * * *`,
-- `select public.sync_listing_rich_attrs('wasalt_residential_listings')`) shares its start minute
-- with jobid 75 (`sync_search_first_seen_at`, `7-59/10 * * * *` → :47) and jobid 42. On 2026-09-21
-- pg_cron started all three within SIX MILLISECONDS of each other:
--
--     jobid 75  06:47:00.05159 → 06:47:00.477563   (426 ms)   took the lock
--     jobid 42  06:47:00.054055 → 06:47:29.944831  (29.9 s)
--     jobid 68  06:47:00.057082 → 06:47:00.073335  (16 ms)    REFUSED, returned NULL, wrote nothing
--
-- Both 68 and 75 open with `if not public.search_index_writer_lock() then return null; end if;` on
-- the SAME `search_listings_ar:single_writer` advisory lock. 16 ms cannot be a pass: a real one
-- scans the 54,522-row wasalt join and measures 21–30 s. Five of the last eight daily runs of
-- jobid 68 finished in 9–16 ms (09-21, 09-19, 09-18, 09-16, 09-15) — a >50% silent failure rate on
-- a daily sync, with `status='succeeded'` recorded every time.
--
-- THE EFFECT ON THE TRUTH SET, which is why this is a red-team finding and not tidiness: wasalt
-- rich attributes (living_rooms, parking_count, balcony, furnishing_level …) stay STALE in the
-- SERVED index while `listing_rich_attrs` holds the captured truth. Those columns feed Advanced
-- Filter predicates and card chips, so the index and the capture disagree about the same listing.
-- mon_rich_attrs_barrier() has raised `rich_attrs_wasalt_drift` four times in eleven days at
-- 220 / 2,858 / 4,469 / 5,472 rows. It sees the CONSEQUENCE a day later and only on persistence;
-- nothing saw the CAUSE at all.
--
-- ROOT CAUSE — two mechanisms, both fixed here (G.9 #1):
--   1. a DETERMINISTIC minute collision between two writers of one single-writer lock; and
--   2. a SILENT no-op. Migration 20260906051949 ("a sync pass that did nothing must not read as a
--      sync") closed exactly this class for ONE writer, sync_search_listings_ar, by making the
--      writer record its own passes. It left the other EIGHT untouched. Measured today: of the
--      nine functions that call search_index_writer_lock(), only sync_search_listings_ar records a
--      pass — backfill_location_display_labels, propagate_dealapp_resolved_locations,
--      refresh_rnpl_flags, sync_gathern_native_attrs, sync_listing_photos, sync_listing_rich_attrs,
--      sync_payment_monthly and sync_search_first_seen_at all return silently.
--
-- WHY NOT JUST MOVE THE JOB. Moving jobid 68 fixes today's instance and leaves the class: the next
-- schedule edit anywhere in the file can recreate it, invisibly, for any of the eight. So the
-- instrument comes first and the schedule move second.
--
-- WHAT THIS DOES NOT TOUCH (G.7): sync_search_listings_ar's own loud pass record is unchanged — it
-- must keep failing closed when it cannot record itself. The shared
-- `search_index_writer_lock_refused` counter row is kept as-is; anything reading it still reads it.

-- ── 1. THE LOCK RECORDS BOTH OUTCOMES, PER CALLER ───────────────────────────────────────────────
-- Same zero-argument signature, deliberately: adding `p_caller text default null` would create a
-- SECOND overload of a public function and trip the PGRST203 shape AGENTS.md's drift guard exists
-- for. The caller is read from the plpgsql call stack instead — frame 1 is this function, frame 2
-- is the writer that called it.
create or replace function public.search_index_writer_lock()
returns boolean
language plpgsql
as $function$
declare ctx text; caller text;
begin
  begin
    get diagnostics ctx = pg_context;
    caller := (select m[1]
                 from regexp_matches(coalesce(ctx, ''), 'function ([a-z0-9_]+)\(', 'g') m
                offset 1 limit 1);
  exception when others then caller := null;
  end;
  caller := coalesce(caller, 'direct_sql');

  if pg_try_advisory_xact_lock(hashtext('search_listings_ar:single_writer')) then
    -- POSITIVE EVIDENCE, per caller. Written inside the caller's transaction on purpose: a pass
    -- that is later rolled back did not happen, and its record must roll back with it.
    -- Best-effort for the same reason the refusal record is (this function is EXECUTE-granted to
    -- anon/authenticated and is NOT security definer) — a caller that cannot write the log must
    -- still get its lock. sync_search_listings_ar keeps its own NON-swallowed record; this one is
    -- additional evidence, never a replacement for it.
    begin
      insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
      values ('search_index_writer_pass:' || caller, now(), 1, 'took the single-writer lock')
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
    values ('search_index_writer_lock_refused', now(), 1,
            left(coalesce(current_query(), '?'), 200))
    on conflict (object_name) do update
      set refreshed_at = excluded.refreshed_at,
          rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
          note         = excluded.note;
  exception when others then null;
  end;
  -- NEW: the refusal, attributed. "Which writer was locked out, and when" is the fact the shared
  -- row could never carry — it holds one timestamp and the last caller's query text.
  begin
    insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
    values ('search_index_writer_refused:' || caller, now(), 1, 'refused the single-writer lock')
    on conflict (object_name) do update
      set refreshed_at = excluded.refreshed_at,
          rows_after   = coalesce(mon_mv_refresh_log.rows_after, 0) + 1,
          note         = excluded.note;
  exception when others then null;
  end;

  raise notice 'search_listings_ar single-writer lock is held by another transaction; this pass is a NO-OP and reports NULL (not 0)';
  return false;
end $function$;

-- ── 2. THE DETECTOR ─────────────────────────────────────────────────────────────────────────────
-- It DISCOVERS its subjects by shape — every public function whose body calls
-- search_index_writer_lock() — rather than from a list someone has to remember to extend. A ninth
-- writer added tomorrow is covered the moment it exists. It judges only writers that own an ACTIVE
-- cron job, because a writer with no schedule has no cadence to be late against.
--
-- It FAILS CLOSED on absence: a writer with NO pass record at all is starved, not healthy. That is
-- the direction this repo has been burned by (nine dark detectors reading as a clean bill of
-- health), so "we have never seen it work" may not read as "it works".
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
      select p.proname as fn
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prosrc like '%search_index_writer_lock%'
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

-- ── 3. THE ROSTER ENTRY, IN THE SAME MIGRATION (AGENTS.md) ──────────────────────────────────────
-- mon_orphaned_detectors() counts a detector as reachable if mon_run_all_detectors calls it OR it
-- owns a cron job. It gets its own job rather than an edit to the 8 KB roster function, which is
-- the safer change and lets the minute be chosen deliberately: :56 is inside the quiet window
-- (jobid 38's :29 and :59 sweeps measure p95 683 s, so :29–:40 and :59–:10 are starvation-prone)
-- and carries no search-index writer.
select cron.schedule('mon-search-writer-starved', '56 * * * *',
                     $$select public.mon_detect_search_writer_starved();$$);

-- ── 4. THE COLLISION ITSELF ─────────────────────────────────────────────────────────────────────
-- 06:47 → 06:46. Measured free of every search-index writer, inside the quiet window, and still
-- five minutes ahead of jobid 69 (mon_rich_attrs_barrier, `52 6 * * *`) which reads the drift this
-- sync is supposed to have just repaired. jobid 68 measures 21–30 s, so it finishes before 75 and
-- 42 start at :47.
select cron.alter_job(68, schedule := '46 6 * * *');

-- ── 5. THE INSTALL SEED, NAMED AS A SEED ────────────────────────────────────────────────────────
-- Without this every scheduled writer reads as starved the moment the detector exists, because no
-- pass has been RECORDED yet — true but useless, and a burst of raise/resolve is what
-- mon_detect_alert_flapping is for. The seed starts each writer's clock now and says in its own
-- note that it is not an observed pass, so nobody can later mistake it for evidence. Each writer
-- must produce a REAL pass within its own cadence or the detector fires on the truth.
insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note)
select 'search_index_writer_pass:' || p.proname, now(), 0,
       'INSTALL SEED 2026-09-21 — not an observed pass; starts the cadence clock'
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.prosrc like '%search_index_writer_lock%'
   and p.proname <> 'search_index_writer_lock'
   and exists (select 1 from cron.job j where j.active and position(p.proname in j.command) > 0)
on conflict (object_name) do nothing;