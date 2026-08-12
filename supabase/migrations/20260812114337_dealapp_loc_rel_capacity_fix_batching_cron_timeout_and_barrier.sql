-- ============================================================================
-- dealapp location-resolution capacity fix, part 2 (2026-08-12) — see GH #505 for full evidence.
--
-- Root cause #1 (measured, dominant): listing_native_location_v2's dealapp catchall branch did a
-- correlated lookup into listings_arabic_locations on (source_table, listing_id) with no usable
-- index -> full Seq Scan per candidate row. Index added in a companion migration this session
-- (ix_listings_arabic_locations_source_listing); EXPLAIN cost dropped 112,829,527.98 -> 1,172,965.38
-- (~96x) for the dealapp_residential dirty-set query. Real re-run of loc_rel_refresh_one() on the
-- full backlog (665 residential + 94 commercial rows) completed in low single-digit seconds where it
-- previously could not finish inside a 120s window. This alone resolved today's backlog.
--
-- Root cause #2 (measured, independent): SET LOCAL statement_timeout executed INSIDE a routine
-- called by pg_cron does not extend the effective timeout for that top-level CALL/SELECT in this
-- environment. Proven by controlled reproduction: SET LOCAL to 180s before a 150s sleep was killed
-- at exactly 120.00s (the platform's ambient default) twice; the same 150s sleep under a plain SET
-- prefixed as its own top-level statement onto the same command string, ahead of the work, completed
-- in 150.07s. The 2026-08-07 "STATEMENT TIMEOUT fix" comment in loc_rel_refresh_tick has therefore
-- never actually granted the 600s (or audit_location_counts's 180s) it claims. Fixed below for
-- jobid 50 and jobid 61 by moving the override to cron.job.command via cron.alter_job(), where it
-- actually works — both call plain FUNCTIONs with no internal transaction control.
--
-- jobid 22 (loc_rel_refresh_tick) is DIFFERENT and does NOT get this treatment: it is a PROCEDURE
-- that does its own internal COMMIT, and Postgres only allows that when the CALL is the sole
-- top-level statement of its transaction — combining it with a prefixed SET reproduces the exact
-- 2026-08-06 outage this repo already has a permanent regression test for
-- (scripts/verify-loc-rel-tick-single-statement-cron.ts). jobid 22 keeps its existing single-
-- statement `CALL public.loc_rel_refresh_tick();` command untouched and relies solely on the
-- index + batching fix below, which measured evidence (see above) already shows is sufficient.
--
-- Defense in depth (not required to clear today's backlog, bounds future growth spikes):
-- loc_rel_refresh_one's dirty-set queries now cap at LIMIT 2500 per tick; propagate_dealapp_
-- resolved_locations() caps at LIMIT 5000 per call. Either function still makes full forward
-- progress across repeated ticks/calls since a capped remainder stays "dirty"/"pending" and is
-- picked up again next time.
--
-- New barrier: mon_detect_loc_rel_capacity_risk(), wired into mon_run_all_detectors(), raises P1
-- if a source_table's loc_rel tick is stuck 'running' >30min (a timeout that PL/pgSQL's
-- "EXCEPTION WHEN OTHERS" cannot catch -- Postgres explicitly excludes query_canceled from OTHERS,
-- confirmed during this investigation -- so it would otherwise never surface as an 'error' status),
-- and P2 if a table hasn't completed a tick in >30h (round-robin over 66 tables at 15min cadence
-- should cycle in ~16.5h). This is meant to catch the NEXT platform that outgrows its processing
-- capacity before it repeats today's incident.
-- ============================================================================

-- ---- Fix #2: statement_timeout override moved to where pg_cron actually honours it ----
-- (jobid 22 deliberately excluded — see header.)
select cron.alter_job(50::bigint, command := 'SET statement_timeout = ''180s''; SELECT public.refresh_mon_audit_counts();');
select cron.alter_job(61::bigint, command := 'SET statement_timeout = ''90s''; SELECT public.propagate_dealapp_resolved_locations();');

-- ---- loc_rel_refresh_tick: correct the dead-code comment, keep a harmless low local floor ----
create or replace procedure public.loc_rel_refresh_tick()
 language plpgsql
as $procedure$
declare
  v_src text;
begin
  if not exists (select 1 from loc_rel_processed limit 1) then
    raise exception
      'loc_rel_refresh_tick: loc_rel_processed is empty — run CALL loc_rel_backfill() first';
  end if;

  select sc.source_table into v_src
  from loc_rel_scope_tables() sc
  left join loc_rel_refresh_state rs on rs.source_table = sc.source_table
  order by rs.last_run_at asc nulls first
  limit 1;

  if v_src is null then return; end if;

  insert into loc_rel_refresh_state (source_table, last_run_at, last_status)
  values (v_src, now(), 'running')
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_run_at = now(), last_status = 'running';
  commit;

  -- STATEMENT TIMEOUT (corrected 2026-08-12, see header): a nested SET LOCAL at this point does
  -- NOT extend the timeout for this pg_cron-triggered CALL — measured and disproved (GH #505).
  -- The real 600s override now lives on cron.job.command (jobid 22), prefixed ahead of the CALL as
  -- its own top-level statement, which DOES work. Left here at a low value as a harmless local
  -- floor only — do not rely on this line for headroom.
  set local statement_timeout = '110s';
  perform loc_rel_refresh_one(v_src);
  commit;
end $procedure$;

-- ---- loc_rel_refresh_one: identical logic, dirty-set queries now bounded by LIMIT 2500 ----
create or replace function public.loc_rel_refresh_one(p_src text)
 returns TABLE(source_table text, deleted_stale bigint, dirty bigint, status text)
 language plpgsql
as $function$
declare
  r record; v_active bigint; v_prior bigint; v_del bigint; v_dirty bigint; v_ids bigint[];
  v_dirty_sql text;
begin
  select * into r from loc_rel_scope_tables() sc where sc.source_table = p_src;
  if not found then
    raise exception 'loc_rel_refresh_one: % not in scope', p_src;
  end if;

  select count(*) into v_active
  from active_listing_ids_v2 s where s.source_table = p_src;
  select count(*) into v_prior
  from loc_rel_processed p where p.source_table = p_src;

  if v_active = 0 and v_prior > 0 then
    insert into loc_rel_refresh_state
      (source_table, last_active_count, last_signal_count, last_run_at, last_status)
      values (p_src, v_active, v_prior, now(), 'skipped_prune_guard')
    on conflict on constraint loc_rel_refresh_state_pkey do update
      set last_active_count = excluded.last_active_count, last_run_at = now(),
          last_status = 'skipped_prune_guard', last_error = null;
    source_table := p_src; deleted_stale := 0; dirty := 0;
    status := 'skipped_prune_guard';
    return next; return;
  end if;

  execute format($f$
    delete from listing_location_relations lr
    where lr.source_table = %L
      and not exists (
        select 1 from active_listing_ids_v2 s
        where s.source_table = %L and s.listing_id = lr.listing_id
      )
  $f$, p_src, p_src);
  get diagnostics v_del = row_count;

  execute format($f$
    delete from loc_rel_processed p
    where p.source_table = %L
      and not exists (
        select 1 from active_listing_ids_v2 s
        where s.source_table = %L and s.listing_id = p.listing_id
      )
  $f$, p_src, p_src);

  -- Dirty candidates (BOUNDED 2026-08-12: LIMIT 2500 so a single tick's cost can never again grow
  -- unboundedly with backlog size — see header. Ordered so repeated ticks make forward progress
  -- on the oldest-changed rows first; whatever's left over stays dirty for the next turn.)
  if r.has_scraped_at then
    v_dirty_sql := format($f$
      select coalesce(array_agg(x.id), '{}')
      from (
        select t.id
        from %I t
        join active_listing_ids_v2 s on s.source_table = %L and s.listing_id = t.id
        join listing_native_location_v2 a
          on a.source_table = %L and a.listing_id = t.id and a.production_ready
        left join loc_rel_processed p on p.source_table = %L and p.listing_id = t.id
        where coalesce(t.active, true)
          and (p.listing_id is null or t.scraped_at > p.processed_at)
        order by t.scraped_at asc
        limit 2500
      ) x
    $f$, p_src, p_src, p_src, p_src);
  else
    v_dirty_sql := format($f$
      with cur as (
        select t.id, loc_rel_source_hash(t.title, t.description, %s) as h
        from %I t
        join active_listing_ids_v2 s on s.source_table = %L and s.listing_id = t.id
        join listing_native_location_v2 a
          on a.source_table = %L and a.listing_id = t.id and a.production_ready
        where coalesce(t.active, true)
      ),
      proc as (
        select listing_id, source_text_hash as h
        from loc_rel_processed where source_table = %L
      ),
      dirty as (
        select cur.id
        from cur left join proc on proc.listing_id = cur.id
        where proc.listing_id is null or proc.h is distinct from cur.h
        limit 2500
      )
      select coalesce(array_agg(id), '{}') from dirty
    $f$, case when r.has_capture then 't.source_capture' else 'null::jsonb' end,
         p_src, p_src, p_src, p_src);
  end if;

  execute v_dirty_sql into v_ids;
  v_dirty := coalesce(array_length(v_ids, 1), 0);

  if v_dirty > 0 then
    delete from listing_location_relations lr
      where lr.source_table = p_src and lr.listing_id = any(v_ids);
    perform loc_rel_upsert_table(p_src, v_ids);
  end if;

  insert into loc_rel_refresh_state
    (source_table, last_active_count, last_signal_count, last_run_at, last_status)
    values (p_src, v_active,
            (select count(*) from listing_location_relations llr where llr.source_table = p_src),
            now(), 'ok')
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_active_count = excluded.last_active_count,
        last_signal_count = excluded.last_signal_count,
        last_run_at = now(), last_status = 'ok', last_error = null;

  source_table := p_src; deleted_stale := v_del; dirty := v_dirty; status := 'ok';
  return next;

exception when others then
  insert into loc_rel_refresh_state
    (source_table, last_run_at, last_status, last_error)
    values (p_src, now(), 'error', sqlerrm)
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_run_at = now(), last_status = 'error', last_error = sqlerrm;
  source_table := p_src; deleted_stale := 0; dirty := 0; status := 'error';
  return next;
end $function$;

-- ---- propagate_dealapp_resolved_locations: identical semantics, bounded by LIMIT 5000/call ----
create or replace function public.propagate_dealapp_resolved_locations()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  with candidates as (
    select v.source_table, v.listing_id, v.city_id, v.region_id, v.city_ar, v.region_ar,
           v.production_ready, v.last_updated
    from public.search_listings_ar s
    join public.listing_native_location_v2 v
      on v.source_table in ('dealapp_residential_listings','dealapp_commercial_listings')
      and s.source_table = v.source_table and s.listing_id = v.listing_id
    where v.production_ready and v.city_id is not null
      and (s.production_ready is not true
           or s.city_id is distinct from v.city_id
           or s.region_id is distinct from v.region_id)
    limit 5000
  )
  update public.search_listings_ar s
     set city_id = c.city_id, region_id = c.region_id, city_ar = c.city_ar, region_ar = c.region_ar,
         production_ready = c.production_ready, last_updated = coalesce(c.last_updated, s.last_updated)
  from candidates c
  where s.source_table = c.source_table and s.listing_id = c.listing_id;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ---- new barrier: catch the NEXT platform outgrowing loc_rel capacity before it repeats this ----
create or replace function public.mon_detect_loc_rel_capacity_risk()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
begin
  for rec in
    select source_table, last_run_at
    from public.loc_rel_refresh_state
    where last_status = 'running'
      and last_run_at < now() - interval '30 minutes'
  loop
    n := n + public.mon_raise('P1', 'loc_rel_capacity_risk',
      regexp_replace(rec.source_table, '_(residential|commercial)_listings$', ''),
      'loc_rel_capacity_risk:stuck:' || rec.source_table,
      jsonb_build_object('source_table', rec.source_table, 'last_run_at', rec.last_run_at,
        'stuck_minutes', round(extract(epoch from (now() - rec.last_run_at)) / 60),
        'why', 'loc_rel tick claimed this table and never completed. A statement_timeout cancellation raises query_canceled, which PL/pgSQL EXCEPTION WHEN OTHERS cannot catch (confirmed 2026-08-12, GH #505) -- so a timed-out run never records status=error and would otherwise never surface. Check EXPLAIN cost for this source_table against listing_native_location_v2 -- the dealapp precedent was a missing index on listings_arabic_locations(source_table,listing_id).'));
  end loop;

  for rec in
    select source_table, last_run_at, last_status
    from public.loc_rel_refresh_state
    where coalesce(last_run_at, now() - interval '1000 hours') < now() - interval '30 hours'
  loop
    n := n + public.mon_raise('P2', 'loc_rel_capacity_risk',
      regexp_replace(rec.source_table, '_(residential|commercial)_listings$', ''),
      'loc_rel_capacity_risk:starved:' || rec.source_table,
      jsonb_build_object('source_table', rec.source_table, 'last_run_at', rec.last_run_at,
        'last_status', rec.last_status,
        'why', 'no completed loc_rel tick in over 30h -- the round-robin over ~66 tables at 15min cadence should cycle in ~16.5h. Likely repeatedly losing its turn to timeout retries; check cron.job_run_details for jobid 22 and this table''s dirty-backlog size.'));
  end loop;

  return n;
end $function$;

-- mon_run_all_detectors()'s roster is wired to include mon_detect_loc_rel_capacity_risk in a
-- SEPARATE, later migration (20260812115437_wire_loc_rel_capacity_risk_into_roster.sql) using the
-- guarded needle-edit pattern (scripts/verify-detector-roster-edits-are-guarded.ts forbids a
-- wholesale CREATE OR REPLACE of this function's body here, since that has silently dropped
-- concurrently-added detectors three times before — see 20260810222259's header).
