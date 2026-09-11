-- ROUTINE #11 ♻️ LISTING LIFECYCLE — the served index is built from a matview that has not been
-- refreshed yet (ops_incident #143). Full rationale in the mirrored repo file of the same name.
do $fix$
declare
  v_sync_id    bigint;
  v_refresh_id bigint;
  v_before     text;
  v_cmd_before text;
  v_cmd_after  text;
begin
  select jobid into v_refresh_id from cron.job
   where active and command ilike '%refresh materialized view concurrently public.active_listing_ids_v2%';
  select jobid, schedule, command into v_sync_id, v_before, v_cmd_before from cron.job
   where active and command ilike '%public.sync_search_listings_ar()%';

  if v_sync_id is null or v_refresh_id is null then
    raise exception 'propagation-order fix: could not resolve producer (%) / consumer (%) by command; '
                    'refusing to guess a jobid', v_refresh_id, v_sync_id;
  end if;

  perform cron.alter_job(v_sync_id, schedule => '36 * * * *');

  select command into v_cmd_after from cron.job where jobid = v_sync_id;
  if v_cmd_after is distinct from v_cmd_before then
    raise exception 'propagation-order fix: job % command changed during alter_job — refusing', v_sync_id;
  end if;

  raise notice 'sync-search-listings-ar (jobid %) rescheduled % -> 36 * * * *', v_sync_id, v_before;
end;
$fix$;

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

    if v_cons_min < v_need_min then
      return query select 'scheduled_order_inverted'::text, v_prod_id, v_cons_id,
                          v_prod_sched, v_cons_sched,
                          format('The sync that builds search_listings_ar starts at minute %s, but '
                                 || 'the refresh it reads starts at minute %s and may run until '
                                 || 'minute %s (its own statement_timeout of %ss). The consumer can '
                                 || 'therefore read a snapshot the producer has not finished writing '
                                 || '— or, when it starts first outright, the PREVIOUS hour''s '
                                 || 'snapshot. Either way a deactivation or a restore waits an extra '
                                 || 'full cycle before it reaches the user.',
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

comment on function public.ops_lifecycle_propagation_order_inverted() is
  'Pure resolver (ops_incident #143): the sync that builds search_listings_ar must start only after '
  'the matview refresh it reads can no longer be running. Asserts the invariant, never a literal '
  'minute, so a different-but-correct schedule passes.';

create or replace function public.mon_detect_propagation_order_inverted()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n    int := 0;
  live text[] := '{}';
  r    record;
  k    text;
begin
  for r in select * from public.ops_lifecycle_propagation_order_inverted() loop
    k := 'propagation_order_inverted:' || r.condition;
    live := live || k;
    n := n + public.mon_raise(
      'P2',
      'lifecycle_propagation_order_inverted',
      null,
      k,
      jsonb_build_object(
        'condition', r.condition,
        'producer_job', r.producer_job,
        'consumer_job', r.consumer_job,
        'producer_schedule', r.producer_schedule,
        'consumer_schedule', r.consumer_schedule,
        'occurrences_48h', r.occurrences,
        'why', r.detail,
        'why_it_matters',
          'docs/ops/LISTING_LIFECYCLE_ENGINEER.md §1.1 carries the owner''s rule: a source-confirmed '
          || 'inactive listing must stop being seen IMMEDIATELY, which §2.3 defines as by the next '
          || 'COMPLETED propagation. When the consumer runs before the producer, the next completed '
          || 'propagation is always a full cycle late — a dead listing stays on screen an extra hour '
          || 'and a restored one stays missing an extra hour.',
        'action',
          'Re-order the two cron jobs so the sync starts after the refresh can no longer be running '
          || '(use the refresh job''s own statement_timeout as the bound, not its average runtime). '
          || 'Do NOT fix this by shortening the refresh''s timeout or by removing the sync''s delete '
          || 'leg.',
        'do_not',
          'This alert NEVER authorises relaxing the sync''s delete circuit breaker, raising a '
          || 'retention threshold, or writing directly into search_listings_ar. A direct write to '
          || 'the index is not durable and the next sync reverts it (ENGINEER_ROUTINES.md, repair '
          || 'ordering: raw -> matview -> sync -> verify).'));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_propagation_order_inverted', live);
  return n;
end;
$fn$;

comment on function public.mon_detect_propagation_order_inverted() is
  'Raises lifecycle_propagation_order_inverted (ops_incident #143). Detect-only: writes no listing, '
  'location or index row.';

do $roster$
declare
  v_src    text;
  v_new    text;
  v_before int;
  v_after  int;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  v_before := (select count(*) from regexp_matches(v_src, '''mon_detect_[a-z0-9_]+''', 'g'));

  v_new := replace(
    v_src,
    $old$'mon_detect_orphan_after_delete'$old$,
    $new$'mon_detect_orphan_after_delete', 'mon_detect_propagation_order_inverted'$new$);

  if v_new = v_src then
    raise exception 'roster needle did not match — mon_run_all_detectors() body changed shape; '
                    'refusing to leave mon_detect_propagation_order_inverted outside the sweep';
  end if;

  v_after := (select count(*) from regexp_matches(v_new, '''mon_detect_[a-z0-9_]+''', 'g'));
  if v_after <> v_before + 1 then
    raise exception 'roster grew by % entries, expected exactly 1 — refusing to write', v_after - v_before;
  end if;

  execute v_new;
end;
$roster$;

do $verify$
begin
  if (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors'
         and pg_get_functiondef(p.oid) like '%mon_detect_propagation_order_inverted%') <> 1 then
    raise exception 'roster verification failed: mon_detect_propagation_order_inverted is not '
                    'reachable from mon_run_all_detectors()';
  end if;
end;
$verify$;