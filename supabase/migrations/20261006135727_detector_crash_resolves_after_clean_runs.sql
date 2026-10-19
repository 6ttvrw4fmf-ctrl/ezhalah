-- QA & Repair 2026-10-06 — a detector_crash alert resolves once the detector has run clean again.
--
-- DEFECT (measured 2026-10-06 13:58 UTC): 3 P1 detector_crash alerts were open since 10-03/10-04
-- (mon_detect_cron_scheduler_frozen, mon_detect_stalled_incident, mon_detect_alert_queue_unworked;
-- the 40P01 deadlocks of the 22:59 sweeps), although each detector had since run clean 34–61 times
-- (ops_detector_timing) and none had crashed again. mon_run_all_detectors() raises
-- 'detector_crash:<fn>:<date>' on a crash but nothing ever resolves it: a date-keyed alert with no
-- resolve path stays open forever and buries the next real crash. Same class as the orphaned
-- remediation escalations fixed by 20261006135440.
--
-- FIX: mon_resolve_recovered_detector_crashes() resolves an open detector_crash alert only when its
-- detector has at least TWO clean (not crashed, not skipped) runs in ops_detector_timing after the
-- alert was raised and NO crash after it. run_remediation() (cron 141, every 15 min) calls it right
-- after mon_resolve_orphaned_escalations(). A detector that crashes again raises a new alert as
-- before; mon_run_all_detectors() is not touched.

create or replace function public.mon_resolve_recovered_detector_crashes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  n int := 0;
begin
  for r in
    select e.dedup_key, e.created_at, e.detail->>'detector' as det
      from public.alert_event e
     where e.kind = 'detector_crash'
       and e.resolved_at is null
       and e.detail ? 'detector'
  loop
    if (select count(*) from public.ops_detector_timing t
         where t.detector = r.det and t.swept_at > r.created_at
           and not coalesce(t.crashed, false) and not coalesce(t.skipped, false)) >= 2
       and not exists (select 1 from public.ops_detector_timing t
                        where t.detector = r.det and t.swept_at > r.created_at
                          and coalesce(t.crashed, false)) then
      perform public.mon_resolve_key('detector_crash', r.dedup_key);
      n := n + 1;
    end if;
  end loop;
  return n;
end
$function$;

comment on function public.mon_resolve_recovered_detector_crashes() is
  'Resolves a detector_crash alert once its detector has >= 2 clean runs after it and no crash since. Called by run_remediation(). QA & Repair 2026-10-06.';

do $outer$
declare
  old_def text := pg_get_functiondef('public.run_remediation()'::regprocedure);
  needle  text := E'  perform public.mon_resolve_orphaned_escalations();\n';
  repl    text := E'  perform public.mon_resolve_orphaned_escalations();\n  perform public.mon_resolve_recovered_detector_crashes();\n';
begin
  if (length(old_def) - length(replace(old_def, needle, ''))) / length(needle) <> 1 then
    raise exception 'expected exactly one orphan-sweep call in run_remediation';
  end if;
  execute replace(old_def, needle, repl);
end
$outer$;

-- EXECUTED PROOF at apply time, both directions, on synthetic rows that are rolled back.
do $verify$
declare
  v_kept int;
  v_gone int;
begin
  begin
    perform public.mon_raise('P2', 'detector_crash', 'qa', 'detector_crash:qa_synthetic_recovered:x',
      jsonb_build_object('detector', 'qa_synthetic_recovered'));
    perform public.mon_raise('P2', 'detector_crash', 'qa', 'detector_crash:qa_synthetic_still_bad:x',
      jsonb_build_object('detector', 'qa_synthetic_still_bad'));
    insert into public.ops_detector_timing (swept_at, detector, elapsed_ms, raised) values
      (now() + interval '1 second', 'qa_synthetic_recovered', 1, 0),
      (now() + interval '2 seconds', 'qa_synthetic_recovered', 1, 0),
      (now() + interval '1 second', 'qa_synthetic_still_bad', 1, 0),
      (now() + interval '2 seconds', 'qa_synthetic_still_bad', 1, 0);
    insert into public.ops_detector_timing (swept_at, detector, elapsed_ms, crashed) values
      (now() + interval '3 seconds', 'qa_synthetic_still_bad', 1, true);
    perform public.mon_resolve_recovered_detector_crashes();
    select count(*) into v_gone from public.alert_event
     where dedup_key = 'detector_crash:qa_synthetic_recovered:x' and resolved_at is null;
    select count(*) into v_kept from public.alert_event
     where dedup_key = 'detector_crash:qa_synthetic_still_bad:x' and resolved_at is null;
    if v_gone <> 0 then raise exception 'FIX DID NOT TAKE: a recovered detector''s crash alert stayed open'; end if;
    if v_kept <> 1 then raise exception 'REGRESSION: a detector that crashed again had its alert resolved'; end if;
    raise exception 'qa_rollback_ok';
  exception when others then
    if sqlerrm <> 'qa_rollback_ok' then raise; end if;
  end;
  if position('mon_resolve_recovered_detector_crashes' in pg_get_functiondef('public.run_remediation()'::regprocedure)) = 0 then
    raise exception 'run_remediation() does not call the crash sweep';
  end if;
  perform public.mon_resolve_recovered_detector_crashes();
end
$verify$;
