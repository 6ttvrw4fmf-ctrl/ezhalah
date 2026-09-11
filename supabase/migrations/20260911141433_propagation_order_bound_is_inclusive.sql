-- ROUTINE #11 ♻️ — tighten ops_lifecycle_propagation_order_inverted()'s boundary by one minute.
--
-- Re-mutating the barrier a second, different way (LISTING_LIFECYCLE_ENGINEER.md §4.2: "a green
-- barrier may be asserting the bug — break the behaviour a second way and confirm it still goes
-- red") found the first draft let ':35' pass. It should not: the producer starts at :20 with a
-- statement_timeout of 900s, so it can still be running AT :35:00 exactly. A consumer starting at
-- :35 is therefore not provably clear of it. The comparison must be <=, not <.
--
-- Proven after this migration: :14 caught, :35 caught, :36 silent. The shipped schedule is :36.
create or replace function public.ops_lifecycle_propagation_order_inverted()
returns table (condition text, producer_job bigint, consumer_job bigint,
               producer_schedule text, consumer_schedule text,
               detail text, occurrences bigint)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_prod_id    bigint;
  v_cons_id    bigint;
  v_prod_sched text;
  v_cons_sched text;
  v_prod_cmd   text;
  v_prod_min   int;
  v_cons_min   int;
  v_timeout_s  int;
  v_need_min   int;
begin
  select jobid, schedule, command into v_prod_id, v_prod_sched, v_prod_cmd from cron.job
   where active and command ilike '%refresh materialized view concurrently public.active_listing_ids_v2%';
  select jobid, schedule into v_cons_id, v_cons_sched from cron.job
   where active and command ilike '%public.sync_search_listings_ar()%';

  if v_prod_id is null or v_cons_id is null then
    return query select 'producer_or_consumer_missing'::text, v_prod_id, v_cons_id,
                        v_prod_sched, v_cons_sched,
                        'The matview refresh that builds active_listing_ids_v2, or the sync that '
                        || 'builds search_listings_ar, is not an active cron job. Aliveness cannot '
                        || 'propagate at all in that state.', 1::bigint;
    return;
  end if;

  if v_prod_sched !~ '^[0-9]+ \*' or v_cons_sched !~ '^[0-9]+ \*' then
    return query select 'ungradeable_schedule_shape'::text, v_prod_id, v_cons_id,
                        v_prod_sched, v_cons_sched,
                        'One of the two jobs is no longer a simple hourly schedule, so the '
                        || 'scheduled-order half of this barrier cannot grade it. Re-state the '
                        || 'invariant for the new shape rather than leaving it ungraded.', 1::bigint;
  else
    v_prod_min := (regexp_match(v_prod_sched, '^([0-9]+) '))[1]::int;
    v_cons_min := (regexp_match(v_cons_sched, '^([0-9]+) '))[1]::int;
    v_timeout_s := coalesce((regexp_match(v_prod_cmd, $re$statement_timeout to '([0-9]+)s'$re$))[1]::int, 900);
    v_need_min  := v_prod_min + ceil(v_timeout_s / 60.0);

    -- <=, not <: the producer can still be running AT minute v_need_min exactly.
    if v_cons_min <= v_need_min then
      return query select 'scheduled_order_inverted'::text, v_prod_id, v_cons_id,
                          v_prod_sched, v_cons_sched,
                          format('The sync that builds search_listings_ar starts at minute %s, but '
                                 || 'the refresh it reads starts at minute %s and may still be '
                                 || 'running at minute %s (its own statement_timeout of %ss). The '
                                 || 'consumer can therefore read a snapshot the producer has not '
                                 || 'finished writing — or, when it starts first outright, the '
                                 || 'PREVIOUS hour''s snapshot. Either way a deactivation or a '
                                 || 'restore waits an extra full cycle before it reaches the user.',
                                 v_cons_min, v_prod_min, v_need_min, v_timeout_s), 1::bigint;
    end if;
  end if;

  return query
  with prod as (
    select date_trunc('hour', start_time) as h, max(end_time) as prod_end
      from cron.job_run_details
     where jobid = v_prod_id and start_time > now() - interval '48 hours' and end_time is not null
     group by 1
  ),
  cons as (
    select date_trunc('hour', start_time) as h, min(start_time) as cons_start
      from cron.job_run_details
     where jobid = v_cons_id and start_time > now() - interval '48 hours'
     group by 1
  ),
  ov as (
    select p.h from prod p join cons c on c.h = p.h where c.cons_start < p.prod_end
  )
  select 'observed_overlap'::text, v_prod_id, v_cons_id, v_prod_sched, v_cons_sched,
         'In the last 48 hours the sync started while the matview refresh it reads was still '
         || 'running. REFRESH CONCURRENTLY does not block readers, so this does not error — it '
         || 'silently mixes a half-old snapshot into the served index, and it is how the two '
         || '2026-09-04 failures happened (one deadlock, one statement timeout that cancelled the '
         || 'aliveness DELETE leg of the sync).',
         count(*)::bigint
    from ov
   having count(*) > 0;
end;
$fn$;