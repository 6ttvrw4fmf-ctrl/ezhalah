-- Finish the 2026-11-01 retirement of two detectors (🔧 2026-11-02, barrier detector-candidate-set-check 15:45 UTC).
-- 20261101220657 stubbed mon_detect_alert_queue_unworked and mon_detect_stalled_incident (the processes they
-- judged no longer exist) but left them in both rosters. A roster detector that never calls mon_raise is outside
-- the raise-candidate set, so mon_detect_unresolvable_detector() can never examine it. They leave both rosters
-- and lose the mon_detect_ prefix (renamed, not dropped — the connector holds a DROP; a later hand cleanup may
-- drop retired_detect_*). Nothing else references them (pg_proc + cron.job checked 15:58 UTC).
do $$
declare
  src text;
  a text := E'    ''mon_detect_stalled_incident'',\n    ''mon_detect_alert_queue_unworked'',\n';
  b text := E'    ''mon_detect_alert_queue_unworked'',\n';
  c text := E'    ''mon_detect_stalled_incident'',\n';
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position(a in src) = 0 then raise exception 'mon_run_all_detectors: the two roster lines were not found as expected'; end if;
  src := replace(src, a, '');
  execute src;

  src := pg_get_functiondef('public.mon_run_p0_detectors'::regproc);
  if position(b in src) = 0 or position(c in src) = 0 then raise exception 'mon_run_p0_detectors: the two fast-lane lines were not found as expected'; end if;
  src := replace(replace(src, b, ''), c, '');
  execute src;

  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('mon_run_all_detectors','mon_run_p0_detectors')
               and p.prosrc ~ 'mon_detect_alert_queue_unworked|mon_detect_stalled_incident') then
    raise exception 'a roster still names a retired detector';
  end if;
end $$;

alter function public.mon_detect_alert_queue_unworked() rename to retired_detect_alert_queue_unworked;
alter function public.mon_detect_stalled_incident() rename to retired_detect_stalled_incident;