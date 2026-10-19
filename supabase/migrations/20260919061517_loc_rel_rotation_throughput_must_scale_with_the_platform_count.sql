-- ==========================================================================================
-- loc_rel round-robin: THROUGHPUT WAS A CONSTANT WHILE THE ROTATION KEPT GROWING.
--
-- MEASURED IN PRODUCTION 2026-09-19 ~06:05 UTC:
--   tables in rotation (loc_rel_scope_tables)        101
--   tables ticked in the last 6h                      23   -> 3.83 tables/hour
--   projected full-cycle time                       26.3h
--   age of the oldest completed tick                34.4h
--   'starved' alarm in mon_detect_loc_rel_capacity_risk  30h   <-- already crossed
--
-- jobid 22 (refresh-loc-rel-signals, '4-59/15 * * * *') is NOT failing: 128/128 runs
-- succeeded in the last 48h, avg 0.8s, max 8.7s. The procedure simply processed EXACTLY ONE
-- table per tick, so full-cycle time is N_tables / ticks_per_hour and grows linearly with
-- every platform launch. akariyoun was added overnight (20260918232405..20260919014424),
-- taking the rotation to 101 and pushing the tail past the 30h alarm. Ten distinct
-- 'starved' alerts fired today, roughly one every 30 minutes, each naming the next table
-- to cross the line -- a queue draining slower than it fills, not a broken job.
--
-- WHY NOT BUY THROUGHPUT WITH CRON MINUTES. The two reliable tick minutes are :19 and :49.
-- The :04 and :34 slots only began firing 2026-09-18 13:04 and 15:34 and are already lossy
-- (18/18 and 14/15) because both collide with jobid 86 mon-p0-fast-lane, whose minute list
-- contains 4 and 34. Yesterday's run recorded that the hour is full (20260918171740,
-- mon_detect_cron_starvation_risk). Minutes are the resource in short supply;
-- work-per-tick costs none.
--
-- FIX. Process up to 4 tables per tick under a 30s wall-clock budget, re-selecting the
-- least-recently-run table on each iteration, so the rotation stays strict LRU and still
-- makes forward progress on the oldest table first.
--   projected cycle: 101 / (4 x 3.83) = 6.6h against a 30h alarm
--   and it survives growth: the rotation would have to reach ~460 tables before 6.6h
--   became 30h again -- and the detector added below fires at 18h, long before that.
-- Even in the degenerate case where the :04/:34 collision is never resolved and only
-- :19/:49 survive (2 ticks/h), the cycle is 101/8 = 12.6h -- still inside the alarm.
--
-- Per-table semantics are UNCHANGED: loc_rel_refresh_one() keeps its own adaptive per-table
-- row batching and its 100s working budget (20260825072415). The cron command is NOT
-- touched -- it stays the sole top-level statement `CALL public.loc_rel_refresh_tick();`
-- that scripts/verify-loc-rel-tick-single-statement-cron.ts pins, because the procedure
-- COMMITs internally and a `;`-prefixed SET reproduces the 2026-08-06 outage.
--
-- Worst case per tick is bounded: the budget is checked BEFORE each table, so the ceiling
-- is 30s + one table's own 110s statement_timeout = ~140s, against a 900s tick interval.
-- ==========================================================================================

create or replace procedure public.loc_rel_refresh_tick()
language plpgsql
as $procedure$
declare
  v_src  text;
  v_t0   timestamptz := clock_timestamp();
  v_done int := 0;
  -- Tables per tick. 1 was the value from when the rotation was small; it is the reason the
  -- cycle time tracked the platform count. See header for the arithmetic behind 4.
  c_max_tables constant int     := 4;
  -- Wall-clock safety net, checked BEFORE claiming each table so a slow table can overrun it
  -- by at most its own statement_timeout and never compounds across the batch.
  c_budget_s   constant numeric := 30;
begin
  if not exists (select 1 from loc_rel_processed limit 1) then
    raise exception
      'loc_rel_refresh_tick: loc_rel_processed is empty — run CALL loc_rel_backfill() first';
  end if;

  loop
    exit when v_done >= c_max_tables;
    exit when extract(epoch from (clock_timestamp() - v_t0)) >= c_budget_s;

    -- Strict LRU over the live scope. Re-evaluated every iteration so a table claimed earlier
    -- in this same batch (its last_run_at is now()) cannot be picked twice.
    select sc.source_table into v_src
    from loc_rel_scope_tables() sc
    left join loc_rel_refresh_state rs on rs.source_table = sc.source_table
    order by rs.last_run_at asc nulls first
    limit 1;

    exit when v_src is null;

    insert into loc_rel_refresh_state (source_table, last_run_at, last_status)
    values (v_src, now(), 'running')
    on conflict on constraint loc_rel_refresh_state_pkey do update
      set last_run_at = now(), last_status = 'running';
    commit;

    -- STATEMENT TIMEOUT (corrected 2026-08-12, re-corrected 2026-08-28): a nested SET LOCAL here
    -- does NOT extend the timeout for this pg_cron-triggered CALL -- measured and disproved
    -- (GH #505). There is NO 600s override on cron.job.command (jobid 22) and there must not be:
    -- this is a PROCEDURE with an internal COMMIT, so the CALL must be the SOLE top-level
    -- statement, and a SET prefix reproduces the 2026-08-06 "invalid transaction termination"
    -- outage (reverted by 20260812115022, pinned by
    -- scripts/verify-loc-rel-tick-single-statement-cron.ts).
    -- The real ceiling is therefore the ambient 120s. Keep the per-table work well under it.
    -- Re-issued each iteration because the COMMIT above ends the transaction SET LOCAL scoped to.
    set local statement_timeout = '110s';
    perform loc_rel_refresh_one(v_src);
    commit;

    v_done := v_done + 1;
  end loop;
end
$procedure$;

-- ------------------------------------------------------------------------------------------
-- BARRIER. Nothing in the system could see this coming. mon_detect_loc_rel_capacity_risk only
-- speaks once a table is ALREADY 30h stale, one table at a time, so a rotation sliding from
-- 16h to 30h over several platform launches was invisible until it broke -- and then it
-- reported as ten separate per-table incidents rather than one capacity fact.
-- This measures the CYCLE and fires at 60% of that alarm.
-- ------------------------------------------------------------------------------------------
create or replace function public.mon_detect_loc_rel_cycle_budget()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n            int := 0;
  v_tables     int;
  v_ticked_6h  int;
  v_cycle_h    numeric;
  v_oldest_h   numeric;
  -- Must track the 'starved' threshold in mon_detect_loc_rel_capacity_risk. This detector
  -- exists to fire BEFORE that one; if they ever diverge, self-test T6 below is the record.
  c_alarm_h    constant numeric := 30;
  c_warn_frac  constant numeric := 0.60;
begin
  select count(*),
         count(*) filter (where last_run_at > now() - interval '6 hours'),
         round(extract(epoch from (now() - min(last_run_at))) / 3600, 1)
    into v_tables, v_ticked_6h, v_oldest_h
  from public.loc_rel_refresh_state;

  -- 6h is deliberately shorter than any healthy cycle, so this measures throughput rather
  -- than re-reading the cycle it is trying to predict. No ticks at all => treat as infinite.
  v_cycle_h := round(v_tables * 6.0 / nullif(v_ticked_6h, 0), 1);

  if v_tables > 0
     and (coalesce(v_cycle_h, 1000000) >= c_alarm_h * c_warn_frac
          or coalesce(v_oldest_h, 0)   >= c_alarm_h * c_warn_frac) then
    n := n + public.mon_raise('P2', 'loc_rel_cycle_budget', 'all', 'loc_rel_cycle_budget',
      jsonb_build_object(
        'tables_in_rotation',           v_tables,
        'tables_ticked_6h',             v_ticked_6h,
        'observed_tables_per_hour',     round(v_ticked_6h / 6.0, 2),
        'projected_full_cycle_hours',   v_cycle_h,
        'oldest_completed_tick_hours',  v_oldest_h,
        'starvation_alarm_hours',       c_alarm_h,
        'warn_at_hours',                c_alarm_h * c_warn_frac,
        'why', 'loc_rel_refresh_tick() processes a bounded batch of tables per tick, so the '
               'full-cycle time is N_tables / (batch x ticks_per_hour) and grows every time a '
               'platform is launched. This fires at 60% of the 30h starvation alarm that '
               'mon_detect_loc_rel_capacity_risk raises per-table, so the rotation gets widened '
               'BEFORE listings go stale instead of after. A rising '
               'projected_full_cycle_hours with a healthy jobid 22 is capacity, not a fault.',
        'do_not', 'NEVER clear this by raising the 30h starvation threshold or by shrinking '
                  'loc_rel_scope_tables(). The levers are work-per-tick (the c_max_tables cap in '
                  'loc_rel_refresh_tick) and per-table cost (loc_rel_refresh_one). Extra cron '
                  'minutes are usually NOT available: jobid 22 minutes :04 and :34 already '
                  'collide with jobid 86 mon-p0-fast-lane.'));
  else
    perform public.mon_resolve_key('loc_rel_cycle_budget', 'loc_rel_cycle_budget');
  end if;

  return n;
end
$fn$;

-- ------------------------------------------------------------------------------------------
-- ROSTER. A detector outside mon_run_all_detectors() is decoration (AGENTS.md), so it goes in
-- the SAME migration. The roster is a hardcoded array inside the function body, and other
-- sessions edit that function concurrently -- on 2026-09-18 one run clobbered another's work
-- with a create-or-replace built from a stale read. So this edits whatever definition is LIVE
-- AT APPLY TIME, inside this transaction, and proves the detector count moved by exactly +1.
-- ------------------------------------------------------------------------------------------
do $roster$
declare
  v_def    text;
  v_before int;
  v_after  int;
  c_anchor constant text := '''mon_detect_age_producer_view_drift''';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then
    raise exception 'ROSTER: mon_run_all_detectors() not found';
  end if;

  v_before := (length(v_def) - length(replace(v_def, 'mon_detect_', ''))) / length('mon_detect_');

  if position('mon_detect_loc_rel_cycle_budget' in v_def) = 0 then
    if position(c_anchor in v_def) = 0 then
      raise exception 'ROSTER: anchor % not found -- refusing to guess an insertion point', c_anchor;
    end if;
    execute replace(v_def, c_anchor,
      '''mon_detect_loc_rel_cycle_budget'',' || E'\n    ' || c_anchor);
  end if;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  v_after := (length(v_def) - length(replace(v_def, 'mon_detect_', ''))) / length('mon_detect_');

  if position('mon_detect_loc_rel_cycle_budget' in v_def) = 0 then
    raise exception 'ROSTER T2a: detector still not in the roster after the edit';
  end if;
  if v_after <> v_before + 1 then
    raise exception
      'ROSTER T2b: detector mentions moved % -> % (expected exactly +1) -- possible clobber or double insert',
      v_before, v_after;
  end if;
end
$roster$;

-- ------------------------------------------------------------------------------------------
-- APPLY-TIME SELF-TESTS. Any failure raises and rolls the WHOLE migration back, so production
-- is never left holding half of this change.
-- ------------------------------------------------------------------------------------------
do $selftest$
declare
  v_src        text;
  v_distinct   int;
  v_tables     int;
  v_ticked_6h  int;
  v_cycle_now  numeric;
  v_cycle_new  numeric;
  v_open       int;
  c_max_tables constant int     := 4;   -- must mirror the procedure's cap
  c_alarm_h    constant numeric := 30;
begin
  -- T1: the cron command must still be the SOLE top-level statement (the procedure COMMITs).
  select command into v_src from cron.job where jobid = 22;
  if v_src is null or btrim(v_src) !~* '^CALL\s+public\.loc_rel_refresh_tick\(\s*\);?$' then
    raise exception 'T1 FAILED: jobid 22 command is not the bare CALL: %', v_src;
  end if;

  -- T2: the procedure really carries a batch cap now (1-table-per-tick was the defect).
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'loc_rel_refresh_tick') not like '%c_max_tables%' then
    raise exception 'T2 FAILED: loc_rel_refresh_tick() has no batch cap';
  end if;

  -- T3: FORWARD PROGRESS. The LRU selection must offer c_max_tables DISTINCT tables, otherwise
  -- a batch would re-pick one table and the extra work would buy nothing.
  select count(distinct source_table) into v_distinct
  from (select sc.source_table
        from loc_rel_scope_tables() sc
        left join loc_rel_refresh_state rs on rs.source_table = sc.source_table
        order by rs.last_run_at asc nulls first
        limit c_max_tables) q;
  if v_distinct <> c_max_tables then
    raise exception 'T3 FAILED: LRU offered % distinct tables, expected %', v_distinct, c_max_tables;
  end if;

  -- T4: THE FIX MUST ACTUALLY CLEAR THE ALARM. Projected cycle after the change, computed from
  -- the throughput measured right now, must land under the detector's own warn line.
  select count(*), count(*) filter (where last_run_at > now() - interval '6 hours')
    into v_tables, v_ticked_6h
  from public.loc_rel_refresh_state;
  if v_ticked_6h = 0 then
    raise exception 'T4 FAILED: zero loc_rel ticks in 6h -- jobid 22 is stalled, batching is not the fix';
  end if;
  v_cycle_now := v_tables * 6.0 / v_ticked_6h;
  v_cycle_new := v_cycle_now / c_max_tables;
  if v_cycle_new >= c_alarm_h * 0.60 then
    raise exception
      'T4 FAILED: % tables at %/6h -> cycle %h, still >= the %h warn line even with a batch of %',
      v_tables, v_ticked_6h, round(v_cycle_new, 1), c_alarm_h * 0.60, c_max_tables;
  end if;

  -- T5: the detector EXECUTES against live production and is not dead on arrival. It must be
  -- OPEN afterwards -- the oldest tick is past the warn line right now, so silence would be a
  -- lie. Asserting the open row, not mon_raise's return value, because mon_raise returns 0 on
  -- an already-open dedup key (AGENTS.md: a zero count is not a clean bill of health).
  perform public.mon_detect_loc_rel_cycle_budget();
  select count(*) into v_open
  from public.alert_event
  where kind = 'loc_rel_cycle_budget' and dedup_key = 'loc_rel_cycle_budget' and resolved_at is null;
  if v_open = 0 then
    raise exception 'T5 FAILED: detector raised nothing while the rotation is over the warn line';
  end if;

  -- T6: the new detector must fire STRICTLY BEFORE the P1 it front-runs, or it is pointless.
  if c_alarm_h * 0.60 >= c_alarm_h then
    raise exception 'T6 FAILED: warn line is not below the starvation alarm';
  end if;

  raise notice 'SELF-TESTS PASSED: % tables, %/6h, cycle %h -> %h with a batch of %, detector open',
    v_tables, v_ticked_6h, round(v_cycle_now, 1), round(v_cycle_new, 1), c_max_tables;
end
$selftest$;
