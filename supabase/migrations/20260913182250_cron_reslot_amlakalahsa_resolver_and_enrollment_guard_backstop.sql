-- TWO OWNER-APPROVED CRON SCHEDULE CHANGES (owner, 2026-09-13, explicit: "do :33 and :11").
--
-- Schedule changes are owner-only in docs/ops/ENGINEER_ROUTINES.md and SYSTEMS_SEAM_ENGINEER.md §0,
-- which is why routine #7 filed both as incidents rather than doing them on its own authority
-- (ops_incident 238 and 240). The owner approved these two specific minutes in the session.
--
-- ── (1) ops_incident 238 — minute :25 carried THREE jobs ──────────────────────────────────────
-- mon_detect_cron_minute_collision() raised P1 2725 naming "min 25 -> jobs 44,63,115". Migration
-- 20260913082003 created jobid 115 on :25 after checking only OTHER RESOLVER crons — its own comment
-- says "not used by any existing resolver cron (existing jobs sit on 1/3/6-59/10 and fixed minutes
-- 12/16/50)" — and not the full roster. Jobs 44 (sync-payment-monthly, 5-59/10, which includes :25)
-- and 63 (mon-aqar-ppm-as-total, 25 * * * *) were already there, so :25 went 2 -> 3 and tripped the
-- detector, which raises at >= 3.
--
-- Moving 115 to :33 takes :25 back to 2 and :33 to 2 — both under the threshold. Command preserved
-- BYTE-EXACT; only the minute changes. :33 measured at 1 job immediately before this migration.
select cron.schedule('resolve-amlakalahsa-locations', '33 * * * *',
  $$select resolve_amlakalahsa_locations();$$);

-- ── (2) ops_incident 240 — a load-bearing schedule with no backstop ───────────────────────────
-- repair-enrollment-guard.yml's own header says "THE SCHEDULE IS THE LOAD-BEARING TRIGGER ... push
-- to main catches the repair arriving in the repo; schedule catches the registry drifting on its
-- own." Measured 2026-09-13: 7 scheduled runs in the ~21h to 06:45Z against 48/day expected (~17%
-- attendance), then nothing for the next 4.5h — 9 consecutive slots missed. GitHub's scheduler is
-- documented in SYSTEMS_SEAM_ENGINEER.md as delivering 11.7 runs/day against 48 on alert-dispatch.
--
-- This repo already solved that class TWICE, DB-side, because cadence is ours in pg_cron and is not
-- in GitHub's scheduler: jobid 83 gh-alert-dispatch-backstop (24 * * * *) and jobid 84
-- gh-migration-drift-guard-backstop (42 * * * *). This is the third, modelled on them exactly —
-- same trigger_gh_workflow() helper, same shape, no new mechanism.
--
-- :11 measured at ZERO jobs immediately before this migration, and is clear of every reserved slot:
-- :00 (matview refresh), :29/:59 (detector sweep), :09/:39 (alert-dispatch's own GitHub schedule),
-- :13/:43 (this guard's own GitHub schedule — a backstop on the same minute would be pointless),
-- :24/:42 (the two existing backstops), and the 24-slot mon-p0-fast-lane.
--
-- SAFE TO CREATE ONLY BECAUSE THE TRIGGER ALREADY EXISTS: trigger_gh_workflow() POSTs to
-- /actions/workflows/<wf>/dispatches with ref=main, which 422s unless the workflow declares
-- workflow_dispatch ON MAIN. repair-enrollment-guard.yml line 45 already does (verified before
-- applying). That check is not pedantry: net.http_post is ASYNCHRONOUS, so a 422 would leave the
-- cron run recording 'succeeded' while nothing ran — precisely ops_incident 74, which that
-- function's own exception message exists to prevent.
select cron.schedule('gh-enrollment-guard-backstop', '11 * * * *',
  $$select public.trigger_gh_workflow('repair-enrollment-guard.yml')$$);

-- ── Prove both, in-migration ──────────────────────────────────────────────────────────────────
do $verify$
declare
  v_115_sched text;
  v_115_cmd   text;
  v_new_sched text;
  v_collisions int;
begin
  select schedule, command into v_115_sched, v_115_cmd
    from cron.job where jobname = 'resolve-amlakalahsa-locations';
  if v_115_sched is distinct from '33 * * * *' then
    raise exception 'resolve-amlakalahsa-locations did not move to :33 (got %)', v_115_sched;
  end if;
  -- the command must be untouched: this is a SLOT move, not a behaviour change
  if v_115_cmd is distinct from 'select resolve_amlakalahsa_locations();' then
    raise exception 'resolve-amlakalahsa-locations command changed — expected a byte-exact command, got %', v_115_cmd;
  end if;

  select schedule into v_new_sched from cron.job where jobname = 'gh-enrollment-guard-backstop';
  if v_new_sched is distinct from '11 * * * *' then
    raise exception 'gh-enrollment-guard-backstop missing or not on :11 (got %)', coalesce(v_new_sched, '<absent>');
  end if;

  -- the whole point of (1): the collision detector must now be silent
  select public.mon_detect_cron_minute_collision() into v_collisions;
  raise notice 'mon_detect_cron_minute_collision raised % (0 expected once :25 is back to 2)', v_collisions;
end $verify$;
