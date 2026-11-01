-- 🔧 Quality & Repair 2026-10-13: a cron ordering contract can be satisfied by a transaction-scoped lock, and the
-- detector must know it — alert 3842 (P2 cron_ordering_contract) has been a FALSE standing alert since 2026-09-18.
--
-- Measured 2026-10-13 13:20–13:24 UTC (🔧 proof row 1055): jobid 17 runs its whole command as ONE transaction (all four
-- mon_mv_refresh_log rows carry the frozen now() of the job start) and holds pg_advisory_xact_lock(hashtext(
-- 'location_pipeline:v1_refresh')) until COMMIT (pg_locks granted = true at 13:21:14 on pid 754260, xact_start
-- 13:20:00); jobid 28 at 13:22:00 blocked until 17 committed at 13:22:31. Migration 20260927224625 installed that lock
-- on purpose instead of widening the wall-clock gap, and corrected mon_detect_sync_ran_against_stale_snapshot — but not
-- mon_detect_cron_ordering_contract, which still reads «:20 → :22: gap 2 min is below the required 7 min».
--
-- FIX THE MEASURING STICK, NEVER THE FLOOR. min_gap_minutes stays 7. A contract row may now declare satisfied_by_lock =
-- the advisory key; the detector then checks the two commands really take that lock BEFORE their work (producer: before
-- its first refresh / public.* call; consumer: before its first public.* call) and skips the wall-clock gap only when
-- they do. A declared lock that the commands do not take is a finding, never a pass. The predicate is a pure function
-- so it is proven in both directions below, on the real commands and on mutated copies.

alter table public.ops_cron_ordering_contract add column if not exists satisfied_by_lock text;
comment on column public.ops_cron_ordering_contract.satisfied_by_lock is
  'advisory-lock key (pg_advisory_xact_lock(hashtext(key))) that BOTH jobs take before their work; when set and really taken, the wall-clock gap is not required. Never a substitute for the gap unless the commands prove it (cron_contract_lock_satisfied).';

update public.ops_cron_ordering_contract
   set satisfied_by_lock = 'location_pipeline:v1_refresh'
 where upstream_job = 'refresh_listing_native_location_v1' and downstream_job = 'sync-search-listings-ar'
   and satisfied_by_lock is null;

create or replace function public.cron_contract_lock_satisfied(p_up_cmd text, p_dn_cmd text, p_key text)
 returns boolean
 language sql
 immutable
as $function$
  with l as (select 'pg_advisory_xact_lock(hashtext(''' || p_key || '''))' as lock_txt),
  up as (
    select position(l.lock_txt in coalesce(p_up_cmd, '')) as lock_at,
           least(nullif(position('refresh materialized view' in coalesce(p_up_cmd, '')), 0),
                 nullif(position('select public.' in coalesce(p_up_cmd, '')), 0)) as work_at
    from l),
  dn as (
    select position(l.lock_txt in coalesce(p_dn_cmd, '')) as lock_at,
           nullif(position('select public.' in coalesce(p_dn_cmd, '')), 0) as work_at
    from l)
  select up.lock_at > 0 and dn.lock_at > 0
     and up.work_at is not null and dn.work_at is not null
     and up.lock_at < up.work_at and dn.lock_at < dn.work_at
  from up, dn;
$function$;

create or replace function public.mon_detect_cron_ordering_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c record; problems text[] := '{}'; n int := 0;
  up_sched text; dn_sched text; up_cmd text; dn_cmd text; up_min int; dn_min int; gap int;
begin
  for c in select * from public.ops_cron_ordering_contract order by id loop
    select schedule, command into up_sched, up_cmd from cron.job where jobname = c.upstream_job   and active;
    select schedule, command into dn_sched, dn_cmd from cron.job where jobname = c.downstream_job and active;

    if up_sched is null or dn_sched is null then
      problems := problems || format('%s -> %s: %s is not present as an ACTIVE cron job',
        c.upstream_job, c.downstream_job,
        case when up_sched is null then c.upstream_job else c.downstream_job end);
      continue;
    end if;

    -- A declared lock is checked on the real commands: taken by both, before their work. Satisfied → the wall-clock
    -- gap is not needed (the consumer blocks until the producer COMMITS). Declared but not taken → a finding.
    if c.satisfied_by_lock is not null then
      if public.cron_contract_lock_satisfied(up_cmd, dn_cmd, c.satisfied_by_lock) then
        continue;
      end if;
      problems := problems || format('%s -> %s: declares advisory lock %s but the commands do not BOTH take pg_advisory_xact_lock(hashtext(%L)) before their work',
        c.upstream_job, c.downstream_job, c.satisfied_by_lock, c.satisfied_by_lock);
      continue;
    end if;

    -- An unevaluable contract is a finding, never a silent pass: if either side stops being a plain
    -- hourly schedule the ordering guarantee is gone and somebody must re-derive it by hand.
    if up_sched !~ '^\d+ \* \* \* \*$' or dn_sched !~ '^\d+ \* \* \* \*$' then
      problems := problems || format('%s (%s) -> %s (%s): not a plain hourly schedule, ordering is unevaluable',
        c.upstream_job, up_sched, c.downstream_job, dn_sched);
      continue;
    end if;

    up_min := split_part(up_sched, ' ', 1)::int;
    dn_min := split_part(dn_sched, ' ', 1)::int;
    gap    := dn_min - up_min;

    if gap < c.min_gap_minutes then
      problems := problems || format('%s at :%s -> %s at :%s: gap %s min is below the required %s min',
        c.upstream_job, lpad(up_min::text, 2, '0'),
        c.downstream_job, lpad(dn_min::text, 2, '0'), gap, c.min_gap_minutes);
    end if;
  end loop;

  if cardinality(problems) > 0 then
    n := public.mon_raise('P2', 'cron_ordering_contract', 'cron', 'cron_ordering_contract',
      jsonb_build_object(
        'violations', to_jsonb(problems),
        'why', 'A job READS what another job WRITES but is scheduled at or before its producer '
               'inside the hour, so it consumes an input that is up to a full cycle stale.',
        'do_not', 'Fix the SCHEDULE (cron.alter_job), never the contract row. Do NOT lower '
                  'min_gap_minutes or delete the row to make this green - that re-creates the exact '
                  'silent staleness this exists to catch. A satisfied_by_lock row is green only while '
                  'BOTH commands really take that lock before their work.'));
  else
    perform public.mon_resolve_key('cron_ordering_contract', 'cron_ordering_contract');
  end if;

  return n;
end
$function$;

-- PROOF at apply, both directions, on the REAL commands and on mutated copies.
do $proof$
declare v_up text; v_dn text; v_key text := 'location_pipeline:v1_refresh'; v_lock text; r int;
begin
  select command into v_up from cron.job where jobid = 17 and active;
  select command into v_dn from cron.job where jobid = 28 and active;
  v_lock := 'pg_advisory_xact_lock(hashtext(''' || v_key || '''))';
  if not public.cron_contract_lock_satisfied(v_up, v_dn, v_key) then raise exception 'PROOF: the real 17/28 commands do not satisfy the lock rule'; end if;
  if public.cron_contract_lock_satisfied(replace(v_up, v_lock, 'select 1'), v_dn, v_key) then raise exception 'PROOF: producer without the lock passed'; end if;
  if public.cron_contract_lock_satisfied(v_up, replace(v_dn, v_lock, 'select 1'), v_key) then raise exception 'PROOF: consumer without the lock passed'; end if;
  if public.cron_contract_lock_satisfied(v_up, replace(v_dn, 'select ' || v_lock || '; ', '') || ' select ' || v_lock || ';', v_key) then raise exception 'PROOF: consumer taking the lock AFTER its work passed'; end if;
  if public.cron_contract_lock_satisfied(v_up, v_dn, 'some_other_key') then raise exception 'PROOF: a different key passed'; end if;
  r := public.mon_detect_cron_ordering_contract();
  if r <> 0 then raise exception 'PROOF: detector still raises (%)', r; end if;
  raise notice 'PROOF OK: lock rule true on the real commands, false on 4 mutations; detector 0';
end
$proof$;