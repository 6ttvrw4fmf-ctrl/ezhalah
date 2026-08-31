-- THE P0 BREACH ALERT SENDS ITS RESPONDER TO A JOB THAT MUST NOT EXIST.
--
-- mon_detect_p0_delivery_sla() raises 'p0_delivery_sla_breach' with the remediation
-- "Check mon-p0-fast-dispatch is active, then the Alert dispatch workflow runs, ...".
-- That job was UNSCHEDULED by 20260828231336 (it collided with eleven other jobs, including the
-- :00 matview slot) and scripts/verify-p0-delivery-sla.ts now asserts it is GONE. So the first
-- instruction a responder follows, during the exact P0-delivery incident this alert fires for, is
-- to look for something whose absence is correct -- and the obvious "fix" it suggests is to
-- re-create the collision.
--
-- This is a text-only needle-edit. No threshold, predicate, severity or dedup key changes; the
-- 5-minute SLO is untouched. It points at the mechanism that actually exists, in the order worth
-- checking, including the coupling added by 20260829104744.

do $patch$
declare
  v_def text;
  v_old text := $anch$'Check mon-p0-fast-dispatch is active, then the Alert dispatch workflow runs, then '$anch$;
  v_new text := $lit$'Check the fast lane in the mon-detectors-and-dispatch command (there is deliberately NO '
            || 'mon-p0-fast-dispatch job -- 20260828231336 unscheduled it and the barrier asserts it '
            || 'stays gone). Check, in order: did the sweep ABORT (cron.job_run_details) -- one '
            || 'transaction, so a timeout rolls the dispatch back with it; is detector_sweep_vs_p0_slo '
            || 'open -- the sweep runtime is charged against this SLO because created_at is '
            || 'transaction start; then the Alert dispatch workflow runs, then '$lit$;
begin
  select pg_get_functiondef('public.mon_detect_p0_delivery_sla()'::regprocedure) into v_def;
  if position('there is deliberately NO ' in v_def) > 0 then
    raise notice 'already corrected -- nothing to do';
    return;
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'stale remediation string not found -- re-derive this edit by hand rather than guessing';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

do $verify$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_p0_delivery_sla';
  if position('there is deliberately NO ' in v_src) = 0 then
    raise exception 'correction did not land';
  end if;
  -- The SLO number and both branches must be exactly as they were: this edit is text-only.
  if position('c_sla_minutes int := 5;' in v_src) = 0 then
    raise exception 'the 5-minute SLO moved -- this migration must never change it';
  end if;
  if position('p0_delivery_sla_breach' in v_src) = 0
     or position('p0_delivery_no_human_channel' in v_src) = 0 then
    raise exception 'a branch was clobbered by the needle-edit';
  end if;
end $verify$;
