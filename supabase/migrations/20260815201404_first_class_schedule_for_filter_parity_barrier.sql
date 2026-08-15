-- First-class cron schedule for mon_filter_parity_barrier() (certification audit, 2026-08-15).
--
-- APPLIED 2026-08-15 via apply_migration (project aannarbkwcymrotzwdbo), under the 'production'
-- deploy lock. Idempotent: safe to re-apply. Minute history: first attempt used :54's predecessor
-- :49 and was ABORTED by the live-uniqueness guard below — live-only job 'refresh-loc-rel-signals'
-- covers :49 and exists in NO repo migration (cron-state drift; flagged to the owner separately).
-- :54 was then chosen from the live free-minute set {22,24,30,40,42,54}.
--
-- WHY: since 20260811225017 the parity barrier ran ONLY as a chained call
-- ('; select public.mon_check_filter_parity_legacy();') on the tail of cron job
-- 'mon-af-predicate-parity' (jobid 71, '43 * * * *'). That left it with no jobname of its own in
-- cron.job, and made it contingent: cron.schedule() REPLACES the whole command for an existing
-- jobname, so any re-apply of the af-predicate job's own migration (20260811130434) would silently
-- drop the chained call and the parity barrier would stop running with no alert.
--
-- FIX: give the alerting wrapper its own job 'mon-filter-parity-barrier' at :54 — a unique minute,
-- re-verified against LIVE cron.job below at apply time; :00/:15/:20 and the barrier minutes
-- :29/:37/:41/:43/:52/:59 avoided per the 2026-08-10 worker-starvation staggering — and restore
-- jobid 71's command to its original single-purpose form. This is a MOVE, not a second run:
-- mon_check_filter_parity_legacy() inserts location_pipeline_alerts rows with NO dedup key (it does
-- not go through mon_raise), so leaving the chained call in place alongside the new job would write
-- duplicate alert rows for every hour a leak stays open.
--
-- Worker-slot pressure (max_worker_processes=6, 2026-08-10 starvation incident): net +1 hourly job,
-- ~2.4 s runtime, on an otherwise-empty minute. mon_detect_cron_minute_collision() keeps watching
-- (alerts at >=3 hourly jobs sharing a minute), and mon_detect_cron_health() covers the new job from
-- its first successful run (a never-run job is deliberately not alerted — see 20260713 spine).

-- 1. Preconditions: both functions exist, and minute :54 is genuinely free among hourly-class jobs.
--    Minute expansion mirrors mon_detect_cron_minute_collision() (20260810175029).
do $$
declare
  taken text;
begin
  perform 'public.mon_filter_parity_barrier()'::regprocedure;
  perform 'public.mon_check_filter_parity_legacy()'::regprocedure;

  select string_agg(jobname, ', ') into taken
    from cron.job
   where active
     and jobname <> 'mon-filter-parity-barrier'
     and split_part(schedule, ' ', 2) = '*'
     and (    split_part(schedule, ' ', 1) = '*'
          or (split_part(schedule, ' ', 1) ~ '^\d+$'
              and split_part(schedule, ' ', 1)::int = 54)
          or (split_part(schedule, ' ', 1) ~ '^\d+(,\d+)+$'
              and '54' = any(string_to_array(split_part(schedule, ' ', 1), ',')))
          or (split_part(schedule, ' ', 1) ~ '^\*/\d+$'
              and 54 % split_part(split_part(schedule, ' ', 1), '/', 2)::int = 0)
          or (split_part(schedule, ' ', 1) ~ '^\d+-59/\d+$'
              and 54 >= split_part(split_part(schedule, ' ', 1), '-', 1)::int
              and (54 - split_part(split_part(schedule, ' ', 1), '-', 1)::int)
                  % split_part(split_part(schedule, ' ', 1), '/', 2)::int = 0));
  if taken is not null then
    raise exception 'minute :54 already covered by active cron job(s): % — pick another minute', taken;
  end if;
end $$;

-- 2. The first-class schedule (cron.schedule upserts by jobname — idempotent).
select cron.schedule('mon-filter-parity-barrier', '54 * * * *',
  $$set statement_timeout to '120s'; select public.mon_check_filter_parity_legacy();$$);

-- 3. Restore 'mon-af-predicate-parity' (jobid 71) to single-purpose: remove the exact chained call
--    appended by 20260811225017, and verify the edit landed (never trust an unverified command edit).
do $$
declare cur text;
begin
  select command into strict cur from cron.job where jobname = 'mon-af-predicate-parity';
  if cur like '%mon_check_filter_parity_legacy%' then
    perform cron.alter_job(
      (select jobid from cron.job where jobname = 'mon-af-predicate-parity'),
      command => replace(cur, '; select public.mon_check_filter_parity_legacy();', ''));
    select command into strict cur from cron.job where jobname = 'mon-af-predicate-parity';
    if cur like '%mon_check_filter_parity_legacy%' or cur not like '%mon_af_predicate_parity%' then
      raise exception 'mon-af-predicate-parity command edit failed — command is now: %', cur;
    end if;
  end if;
end $$;

-- 4. The wrapper is now the barrier's ONLY scheduled caller — record its contract where the next
--    session will actually look.
comment on function public.mon_check_filter_parity_legacy() is
  'Hourly alerting wrapper for mon_filter_parity_barrier(): inserts one location_pipeline_alerts '
  'row per leaking check per run, with NO dedup key (does not use mon_raise) — so it must be '
  'scheduled exactly once. First-class cron job ''mon-filter-parity-barrier'' (54 * * * *) since '
  '2026-08-15; previously chained onto ''mon-af-predicate-parity'' (20260811225017), which made it '
  'invisible in cron.job and silently droppable by any cron.schedule() re-apply of the host job. '
  'Do not chain it onto other jobs, and do not schedule it twice.';

-- 5. Must be green at install, and the new wiring must actually exist.
do $$
declare v int; n int;
begin
  v := public.mon_check_filter_parity_legacy();
  if v <> 0 then
    raise exception 'parity barrier reports % leaking check(s) at install', v;
  end if;
  select count(*) into n
    from cron.job
   where jobname = 'mon-filter-parity-barrier'
     and active
     and schedule = '54 * * * *'
     and command like '%mon_check_filter_parity_legacy%';
  if n <> 1 then
    raise exception 'first-class parity-barrier cron job missing/misconfigured after install';
  end if;
end $$;
