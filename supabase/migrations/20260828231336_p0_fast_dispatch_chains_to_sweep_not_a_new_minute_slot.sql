-- THE EVERY-MINUTE JOB VIOLATED THE CRON MINUTE-SLOT DISCIPLINE. FIX THE JOB, NOT THE DETECTOR.
--
-- WHAT HAPPENED. 20260828220456 scheduled mon-p0-fast-dispatch as '* * * * *' to buy the owner's
-- 5-minute P0 SLO. mon_detect_cron_minute_collision() raised P1 alert 1073 on the very next sweep,
-- naming job 81 in ELEVEN separate collisions -- including minute :00, which that detector reserves
-- for the matview refresh alone. It is right and I was wrong: a job in every minute slot collides
-- with every other job by construction, and cron stampede is what wedged the database on 2026-08-10.
-- The owner's instruction is explicit -- do not loosen a detector to match a slower reality -- and
-- that cuts both ways: you also do not loosen one to permit a job you have just added.
--
-- WHY A DIFFERENT SCHEDULE COULD NOT SOLVE IT. Measured: exactly TWO minute-slots in the whole hour
-- are free (24 and 42). Gaps of 18 and 42 minutes cannot support a 5-minute SLO. There is no
-- polling schedule that satisfies both constraints, so polling was the wrong shape.
--
-- WHAT ACTUALLY FIXES IT. Every P0 in this system is born inside this sweep. Verified rather than
-- assumed: all five detectors that can raise a P0 -- silent_scraper_death, p0_delivery_sla,
-- deleted_but_source_live, deletion_on_inconclusive_evidence, unledgered_hard_delete -- are on the
-- mon_run_all_detectors() roster and none has its own cron job; all 55 P0s ever raised came from
-- here. So the fast lane does not need to poll for P0s at all: it needs to run the moment the sweep
-- that creates them commits. Chaining it onto this command adds ZERO minute-slots and removes the
-- collision entirely.
--
-- THE MARGIN, STATED HONESTLY. alert_event.created_at defaults to now(), which in Postgres is
-- TRANSACTION START -- so a P0's clock starts when the sweep starts, not when the detector raises it.
-- A typical 200s sweep leaves ~4 minutes to file the issue against a 300s budget, and the workflow
-- takes ~40s. That is real but thin margin, and a sweep running to its 675s soft deadline WOULD
-- breach. mon_detect_p0_delivery_sla() is deliberately left at 5 minutes so that case raises loudly
-- instead of being absorbed. If it starts firing, the answer is a faster sweep or a freed minute
-- slot -- an owner decision -- never a larger number.

select cron.unschedule('mon-p0-fast-dispatch');

do $chain$
declare
  v_cmd    text;
  v_anchor text := 'select public.mon_dispatch_alerts();';
  v_new    text := 'select public.mon_dispatch_alerts();' || chr(10)
                || '    select public.mon_dispatch_p0_fast();';
begin
  select command into v_cmd from cron.job where jobname = 'mon-detectors-and-dispatch';
  if v_cmd is null then
    raise exception 'mon-detectors-and-dispatch not found -- refusing to leave the fast lane unreachable';
  end if;
  if position('mon_dispatch_p0_fast' in v_cmd) > 0 then
    raise notice 'already chained, nothing to do';
    return;
  end if;
  if position(v_anchor in v_cmd) = 0 then
    raise exception 'anchor not found in sweep command -- re-derive this edit by hand rather than guessing';
  end if;
  -- Needle-edit from the LIVE command, same discipline as the roster edits: concurrent sessions
  -- change this job, and a hand-pasted command would silently drop their work.
  perform cron.schedule('mon-detectors-and-dispatch', '29,59 * * * *', replace(v_cmd, v_anchor, v_new));
end $chain$;

do $verify$
declare v_cmd text; v_sched text;
begin
  select command, schedule into v_cmd, v_sched from cron.job where jobname = 'mon-detectors-and-dispatch';
  if position('mon_dispatch_p0_fast' in v_cmd) = 0 then
    raise exception 'chain did not take -- mon_dispatch_p0_fast is not reachable from any cron job';
  end if;
  if v_sched <> '29,59 * * * *' then
    raise exception 'sweep schedule changed to % -- schedule changes are owner-only', v_sched;
  end if;
  if exists (select 1 from cron.job where jobname = 'mon-p0-fast-dispatch') then
    raise exception 'the every-minute job still exists -- the collision is not actually fixed';
  end if;
end $verify$;
