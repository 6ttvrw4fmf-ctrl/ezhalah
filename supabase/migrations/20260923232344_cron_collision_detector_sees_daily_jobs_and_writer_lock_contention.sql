-- ops_incident #389 — the cron collision detector could not see a daily job, by construction.
--
-- THE DEFECT. mon_detect_cron_minute_collision()'s own CTE was named `hourly_jobs` and read
--
--     from cron.job where active and split_part(schedule,' ',2) = '*'
--
-- so EVERY job whose HOUR field is not `*` was discarded before the minute expansion ever ran. A
-- daily job colliding with hourly ones was invisible, not unreported — the detector had no row for
-- it to count. That is the `absence cannot be compared, so silence read as health` shape AGENTS.md
-- already names for the wasalt enumeration, arriving inside the stampede detector itself.
--
-- WHAT IT COST, measured (ops_incident #388, routine #9, 2026-09-21). jobid 68 (the DAILY wasalt
-- rich-attribute sync, then `47 6 * * *`) and jobid 75 (`7-59/10 * * * *`) both start at :47 and
-- both open by taking the `search_listings_ar:single_writer` advisory lock. pg_cron started them
-- 5.5 MILLISECONDS apart; 68 was refused, returned NULL, wrote nothing, and cron.job_run_details
-- recorded `succeeded`. It lost that race on 5 of its last 8 daily runs, so the SERVED index kept
-- wasalt rich attributes (living_rooms, parking_count, balcony, furnishing_level — Advanced Filter
-- predicates and card chips) that capture had already corrected. The open cron_minute_collision
-- alert at the time (id 3839) listed min 35, 44 and 49 and NOT min 47, where three jobs collided.
--
-- FIX 1 — EXPAND THE HOUR FIELD TOO. Collisions are now computed over (hour, minute) start
-- instants rather than minutes alone. This is a STRICT SUPERSET and cannot weaken the guard: an
-- hourly job occupies all 24 hours, so every bucket the old query flagged is still flagged at every
-- hour. Both thresholds are carried over byte-for-byte (`count >= 3`, or `minute = 0 and count > 1`)
-- — widening a threshold to absorb the new rows would be the exact move the hard safety rails
-- forbid. Measured on the live roster the moment this shipped: 21 collision windows that the old
-- predicate could not see, among them
--
--     06:46 → jobs 54, 68, 86   [54 `6-59/10 * * * *`, 68 `46 6 * * *`, 86 the P0 fast lane]
--
-- which is jobid 68 AGAIN — the job PR #3511 re-slotted 06:47 → 06:46 specifically to escape a
-- collision, landing on a three-job bucket the detector still could not report. AGENTS.md already
-- warns about exactly this ("a re-slot off the 3-job :25 collision landed on :33 on exactly that
-- bad count"); the instrument that was supposed to catch the repeat was the one with the blind spot.
--
-- FIX 2 — A WRITER-AWARE ARM AT COUNT 2. Three jobs in a minute is a stampede heuristic; TWO is
-- already a defect when both contend for the same single-writer lock, because one of them is
-- guaranteed to be refused and to report success having written nothing. mon_detect_search_writer_
-- starved() (routine #9) sees that CONSEQUENCE a cadence later and only once it persists; this sees
-- the CAUSE at schedule time. The writer set is DISCOVERED from pg_proc by the call
-- `search_index_writer_lock(` — never a hardcoded list — so a tenth writer added tomorrow is
-- covered the moment it exists, and the discriminator is the CALL, not a mention (a predicate on
-- the bare name matches the lock function and the detectors that talk about it).
--
-- FIX 3 — UNRECOGNISED SCHEDULE SHAPES FAIL OPEN INTO THE REPORT, NOT OUT OF IT. The expansion
-- handles `*`, `N`, `N,M,...`, `*/N` and ranges for both fields. A field matching NONE of those is
-- expanded to EVERY value rather than dropped. That direction is deliberate and is the whole lesson
-- of this incident: a shape nobody anticipated must over-report, because dropping it reproduces the
-- bug being fixed here. A future cron syntax therefore makes this detector noisier, never blind.
--
-- The expansion is published ONCE as public.ops_cron_start_instants() so the roster, this detector
-- and any future caller share one definition. AGENTS.md instructs readers to "Ask the detector, or
-- reuse its CTE verbatim. Never hand-roll the count" after a hand-rolled count produced a wrong
-- re-slot on 2026-09-13; that instruction is now executable rather than advisory.

create or replace function public.ops_cron_start_instants()
returns table(jobid bigint, jobname text, schedule text, hour int, minute int, writer_fn text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with w as (
    -- Functions that TAKE the single-writer lock. The trailing `(` is the discriminator: a
    -- predicate on the bare name also matches search_index_writer_lock itself and every detector
    -- whose body merely names it, which is how a sibling check once matched itself (#3511).
    select p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosrc ~ 'search_index_writer_lock\s*\('
       and p.proname <> 'search_index_writer_lock'
       and p.proname !~ '^mon_detect'
  ),
  j as (
    select c.jobid,
           c.jobname,
           c.schedule,
           split_part(c.schedule, ' ', 1) as mf,
           split_part(c.schedule, ' ', 2) as hf,
           (select string_agg(w.proname, ',' order by w.proname)
              from w
             where position(w.proname || '(' in c.command) > 0) as writer_fn
      from cron.job c
     where c.active
  ),
  m as (
    select j.*, g.minute
      from j cross join generate_series(0, 59) g(minute)
     where (j.mf = '*')
        or (j.mf ~ '^\d+$' and g.minute = j.mf::int)
        or (j.mf ~ '^\d+(,\d+)+$' and g.minute::text = any(string_to_array(j.mf, ',')))
        or (j.mf ~ '^\*/\d+$' and g.minute % split_part(j.mf, '/', 2)::int = 0)
        or (j.mf ~ '^\d+-\d+(/\d+)?$'
            and g.minute >= split_part(j.mf, '-', 1)::int
            and g.minute <= split_part(split_part(j.mf, '-', 2), '/', 1)::int
            and (g.minute - split_part(j.mf, '-', 1)::int)
                % coalesce(nullif(split_part(j.mf, '/', 2), ''), '1')::int = 0)
        -- FAIL OPEN: a minute field in none of the shapes above occupies EVERY minute.
        or (j.mf !~ '^(\*|\d+(,\d+)*|\*/\d+|\d+-\d+(/\d+)?)$')
  )
  select m.jobid, m.jobname, m.schedule, h.hour, m.minute, m.writer_fn
    from m cross join generate_series(0, 23) h(hour)
   where (m.hf = '*')
      or (m.hf ~ '^\d+$' and h.hour = m.hf::int)
      or (m.hf ~ '^\d+(,\d+)+$' and h.hour::text = any(string_to_array(m.hf, ',')))
      or (m.hf ~ '^\*/\d+$' and h.hour % split_part(m.hf, '/', 2)::int = 0)
      or (m.hf ~ '^\d+-\d+(/\d+)?$'
          and h.hour >= split_part(m.hf, '-', 1)::int
          and h.hour <= split_part(split_part(m.hf, '-', 2), '/', 1)::int
          and (h.hour - split_part(m.hf, '-', 1)::int)
              % coalesce(nullif(split_part(m.hf, '/', 2), ''), '1')::int = 0)
      -- FAIL OPEN: an hour field in none of the shapes above occupies EVERY hour. This is the
      -- clause whose ABSENCE was ops_incident #389.
      or (m.hf !~ '^(\*|\d+(,\d+)*|\*/\d+|\d+-\d+(/\d+)?)$')
$$;

comment on function public.ops_cron_start_instants() is
  'Every active pg_cron job expanded to its (hour, minute) start instants, with writer_fn naming '
  'the search_index_writer_lock() callers its command invokes. THE one definition of "which jobs '
  'start together" — reuse it, never hand-roll the expansion (AGENTS.md; a hand-rolled count '
  'produced a wrong re-slot on 2026-09-13). Unrecognised schedule shapes expand to every value so '
  'the answer over-reports rather than going blind (ops_incident #389).';

create or replace function public.mon_detect_cron_minute_collision()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_bad text; v_writer text; v_open boolean; n int := 0;
begin
  -- LIMB 1 — stampede risk. Same two thresholds as before, over (hour, minute) instants so a
  -- daily/weekly job is counted instead of discarded. Buckets are collapsed back to one line per
  -- (minute, job set); `@h=` appears only when the collision is not in every hour, so an hourly
  -- collision reads exactly as it did before this change.
  select string_agg(label, '; ' order by minute, label)
    into v_bad
    from (
      select minute,
             format('min %s → jobs %s%s', minute, jobids,
                    case when count(*) = 24 then ''
                         else ' @h=' || string_agg(hour::text, ',' order by hour) end) as label
        from (
          select hour, minute, string_agg(jobid::text, ',' order by jobid) as jobids
            from public.ops_cron_start_instants()
           group by hour, minute
          having count(*) >= 3 or (minute = 0 and count(*) > 1)
        ) per_instant
       group by minute, jobids
    ) collapsed;

  v_open := exists (select 1 from public.alert_event
                     where dedup_key = 'cron_minute_collision' and resolved_at is null);
  if v_bad is null then
    if v_open then perform public.mon_resolve('cron_minute_collision', 'cron'); end if;
  else
    n := n + public.mon_raise('P1', 'cron_minute_collision', 'cron', 'cron_minute_collision',
      jsonb_build_object('collisions', v_bad,
        'why', 'cron stampede risk: overlapping minute-slots wedged the DB on 2026-08-10 (522 '
            || 'outage). One job per minute-slot; :00 belongs to the matview refresh alone. '
            || 'Counted over (hour, minute) since ops_incident #389, so a daily job is visible.'));
  end if;

  -- LIMB 2 — single-writer lock contention. Two is enough: whichever job loses the race is
  -- REFUSED, writes nothing, and records `succeeded` (ops_incident #388).
  select string_agg(format('%s:%s → %s',
                           lpad(hour::text, 2, '0'), lpad(minute::text, 2, '0'), jobs),
                    '; ' order by hour, minute)
    into v_writer
    from (
      select hour, minute,
             string_agg(jobid::text || ' [' || writer_fn || ']', ', ' order by jobid) as jobs
        from public.ops_cron_start_instants()
       where writer_fn is not null
       group by hour, minute
      having count(*) >= 2
    ) y;

  v_open := exists (select 1 from public.alert_event
                     where dedup_key = 'cron_writer_lock_collision' and resolved_at is null);
  if v_writer is null then
    if v_open then perform public.mon_resolve('cron_writer_lock_collision', 'cron'); end if;
  else
    n := n + public.mon_raise('P1', 'cron_writer_lock_collision', 'cron', 'cron_writer_lock_collision',
      jsonb_build_object('collisions', v_writer,
        'why', 'Two or more scheduled jobs start in the same (hour, minute) and both take the '
            || 'search_listings_ar single-writer advisory lock. The loser returns without writing '
            || 'and cron.job_run_details records `succeeded`, so the served index silently stops '
            || 'tracking capture (ops_incident #388: jobid 68 lost to jobid 75 on 5 of its last 8 '
            || 'daily runs, 5.5 ms apart).',
        'action', 'Re-slot ONE of the named jobs to a minute that ops_cron_start_instants() shows '
            || 'free. Do NOT widen this to 3 — two contenders on one lock is already a guaranteed '
            || 'silent no-op, which is why this limb exists separately from limb 1.'));
  end if;

  return n;
end $function$;