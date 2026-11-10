-- THE ALARM SELF-TEST'S WRAPPER PROVES THE POLICY TABLE IS EXACTLY AS IT WAS — BEFORE AND AFTER, NOT «AT LEAST 100».
--
-- Review of 20261110093000 (CodeRabbit, PR #11606): its apply proof asserted «at least 100 'yes' policies» after the
-- self-test. That is a fixed number standing in for «the self-test restored what it changed»: a legitimate policy
-- change could make it fail with a perfect clean-up, and a clean-up that left one site at 'unknown' would pass. The
-- self-test switches every other 'yes' site to 'unknown' inside a sub-transaction that rolls back; this wrapper now
-- fingerprints the whole policy table (every platform, answer and baseline) before the run and compares it after,
-- every day, and raises `posting_date_alarm_selftest` if one byte differs. The apply below runs it the same way.

create or replace function public.mon_detect_posting_date_alarm_selftest()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k constant text := 'posting_date_alarm_selftest';
  n int := 0;
  v_before text;
  v_after  text;
begin
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = k and last_run_at > now() - interval '20 hours') then
    return 0;
  end if;
  select md5(coalesce(string_agg(concat_ws('|', platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on),
                                 ',' order by platform), ''))
    into v_before from public.ops_source_posting_date_policy;
  begin
    perform public.ops_posting_date_alarm_selftest();
    select md5(coalesce(string_agg(concat_ws('|', platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on),
                                   ',' order by platform), ''))
      into v_after from public.ops_source_posting_date_policy;
    if v_after is distinct from v_before then
      raise exception 'SELFTEST: ops_source_posting_date_policy differs after the self-test (% → %) — its clean-up did not restore it',
        v_before, v_after;
    end if;
    perform public.mon_resolve_key('posting_date_alarm_selftest', 'posting_date_alarm_selftest');
  exception when others then
    n := public.mon_raise('P2', k, null, k, jsonb_build_object(
      'error', sqlerrm,
      'why', 'ops_posting_date_alarm_selftest() ran mon_detect_source_posting_date_fill_regressed() over controlled live and '
          || 'switched-off rows and one state came out wrong, or the policy table was not restored exactly. That alarm is '
          || 'what notices a site that stops storing its posting date; while it is wrong, either such a site goes '
          || 'unnoticed or a healthy one is flagged.',
      'action', 'Scraping lane: read the error (it names state A–D or the policy fingerprint), fix the detector, '
          || 'source_posting_date_fill_verdict() or the self-test''s clean-up in a migration, and keep '
          || 'scripts/verify-posting-date-alarm-judges-live-ads.ts green. Never edit the self-test to match a broken answer.'));
  end;
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select k, now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = k);
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n where detector = k;
  return n;
end $function$;
revoke all on function public.mon_detect_posting_date_alarm_selftest() from public, anon, authenticated;
grant execute on function public.mon_detect_posting_date_alarm_selftest() to service_role;

-- PROOF at apply: the wrapper runs now (gate cleared) and raises nothing — the self-test passed and the policy table
-- fingerprint is identical before and after.
delete from public.ops_detector_last_full_run where detector = 'posting_date_alarm_selftest';
select public.mon_detect_posting_date_alarm_selftest();
do $$
begin
  if exists (select 1 from public.alert_event where dedup_key = 'posting_date_alarm_selftest' and resolved_at is null) then
    raise exception 'PROOF: % ', (select detail->>'error' from public.alert_event
                                   where dedup_key = 'posting_date_alarm_selftest' and resolved_at is null limit 1);
  end if;
end $$;
