-- THE POSTING-DATE ALARM IS EXERCISED ON CONTROLLED ROWS — at apply, and once a day while it runs.
--
-- Review of 20261110090000 (CodeRabbit, PR #11606): the repo check reads the alarm's definition, and the apply proof
-- kept a planted alert open on hasaad without first proving hasaad's sample was too small (a regressed verdict or a
-- missing table keeps it open too). This adds the behavioural test it asked for: public.ops_posting_date_alarm_selftest()
-- builds a throwaway site with LIVE and SWITCHED-OFF rows inside a sub-transaction that always rolls back, runs the
-- REAL detector against it, and asserts each state:
--   A. 30 switched-off undated rows + 5 live dated rows → the live sample (5) is too small: verdict 'unknown', and NO
--      alert (counting the switched-off rows would give 5 of 35 = 14 % and raise one);
--   B. the same rows with an open alert planted → it stays open AND keeps its planted detail (a 'regressed' verdict
--      would have refreshed the detail through mon_raise; a closed alert would mean unknown read as recovery);
--   C. 25 more live rows with no date → 5 of 30 live = 16.7 % < 70: raised, with new_rows = 30 (60 would mean the
--      switched-off rows were counted);
--   D. those 25 get a date → 30 of 30: the alert closes.
-- While it runs, the other 'yes' sites are set to 'unknown' so the detector reads only the throwaway site; all of
-- it — table, policy rows, alerts, the detector's gate — rolls back. The table is created by dynamic SQL so nothing
-- reading committed migrations mistakes it for a platform.
-- mon_detect_posting_date_alarm_selftest() runs it at most once per 20 h from the detector roster and raises a P2
-- `posting_date_alarm_selftest` when any state is wrong, clearing it on the next pass.

create or replace function public.ops_posting_date_alarm_selftest()
 returns text
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k   constant text := 'source_posting_date_fill_regressed';
  p   constant text := 'zzpdselftest';
  key constant text := 'source_posting_date_fill_regressed:zzpdselftest';
  tbl constant text := 'zzpdselftest_residential_listings';
  d jsonb;
begin
  if to_regclass('public.' || tbl) is not null then
    raise exception 'SELFTEST: public.% already exists — refusing to touch a real table', tbl;
  end if;
  begin
    execute format('create table public.%I (active boolean not null, scraped_at timestamptz not null, date_added text)', tbl);
    insert into public.ops_source_posting_date_policy
      (platform, publishes, read_from, baseline_fill_pct, baseline_basis, measured_on, evidence)
    values (p, 'yes', '__selftest__', 90, 'expected', current_date, 'ops_posting_date_alarm_selftest(): always rolled back');
    update public.ops_source_posting_date_policy set publishes = 'unknown' where publishes = 'yes' and platform <> p;

    -- A. many switched-off rows, few live ones: unknown, and no alert.
    execute format($q$insert into public.%I select false, now() - interval '1 day', null from generate_series(1, 30)$q$, tbl);
    execute format($q$insert into public.%I select true, now() - interval '1 day', '2026-11-01' from generate_series(1, 5)$q$, tbl);
    if (select verdict from public.source_posting_date_fill_verdict(5, 5, 5, 5, 90)) is distinct from 'unknown' then
      raise exception 'SELFTEST A: the verdict for 5 live ads is not unknown';
    end if;
    delete from public.ops_detector_last_full_run where detector = k;
    perform public.mon_detect_source_posting_date_fill_regressed();
    if exists (select 1 from public.alert_event where dedup_key = key and resolved_at is null) then
      raise exception 'SELFTEST A: switched-off rows were counted — an alert was raised over 5 live ads';
    end if;

    -- B. same rows, an open alert planted: kept open, detail untouched.
    perform public.mon_raise('P2', k, p, key, jsonb_build_object('selftest', 'planted'));
    delete from public.ops_detector_last_full_run where detector = k;
    perform public.mon_detect_source_posting_date_fill_regressed();
    select detail into d from public.alert_event where dedup_key = key and resolved_at is null;
    if d is null then
      raise exception 'SELFTEST B: an unjudgeable site''s open alert was closed';
    end if;
    if d->>'selftest' is distinct from 'planted' then
      raise exception 'SELFTEST B: the unjudgeable site was re-raised (%), not left unknown', d;
    end if;

    -- C. 25 more live rows without a date: regressed, counted over live rows only.
    execute format($q$insert into public.%I select true, now() - interval '1 day', null from generate_series(1, 25)$q$, tbl);
    delete from public.ops_detector_last_full_run where detector = k;
    perform public.mon_detect_source_posting_date_fill_regressed();
    select detail into d from public.alert_event where dedup_key = key and resolved_at is null;
    if d is null or d->>'new_rows' is null then
      raise exception 'SELFTEST C: a live site at 16.7 %% against 90 was not alarmed (%)', d;
    end if;
    if (d->>'new_rows')::int <> 30 or (d->>'with_readable_date')::int <> 5 then
      raise exception 'SELFTEST C: judged % of % — expected 5 of 30 live rows', d->>'with_readable_date', d->>'new_rows';
    end if;

    -- D. the 25 get a date: ok, and the alert closes.
    execute format($q$update public.%I set date_added = '2026-11-02' where active and date_added is null$q$, tbl);
    delete from public.ops_detector_last_full_run where detector = k;
    perform public.mon_detect_source_posting_date_fill_regressed();
    if exists (select 1 from public.alert_event where dedup_key = key and resolved_at is null) then
      raise exception 'SELFTEST D: a site back at 100 %% kept its alert';
    end if;

    raise exception '__pd_alarm_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__pd_alarm_selftest_rollback__' then raise; end if;
  end;
  return 'ok';
end $function$;
revoke all on function public.ops_posting_date_alarm_selftest() from public, anon, authenticated;
grant execute on function public.ops_posting_date_alarm_selftest() to service_role;

create or replace function public.mon_detect_posting_date_alarm_selftest()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  k constant text := 'posting_date_alarm_selftest';
  n int := 0;
begin
  if exists (select 1 from public.ops_detector_last_full_run
              where detector = k and last_run_at > now() - interval '20 hours') then
    return 0;
  end if;
  begin
    perform public.ops_posting_date_alarm_selftest();
    perform public.mon_resolve_key('posting_date_alarm_selftest', 'posting_date_alarm_selftest');
  exception when others then
    n := public.mon_raise('P2', k, null, k, jsonb_build_object(
      'error', sqlerrm,
      'why', 'ops_posting_date_alarm_selftest() ran mon_detect_source_posting_date_fill_regressed() over controlled live and '
          || 'switched-off rows and one state came out wrong. That alarm is what notices a site that stops storing its '
          || 'posting date; while it is wrong, either such a site goes unnoticed or a healthy one is flagged.',
      'action', 'Scraping lane: read the error (it names state A–D), fix the detector or source_posting_date_fill_verdict() '
          || 'in a migration, and keep scripts/verify-posting-date-alarm-judges-live-ads.ts green. Never edit the self-test '
          || 'to match a broken answer.'));
  end;
  insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
  select k, now(), n
   where not exists (select 1 from public.ops_detector_last_full_run where detector = k);
  update public.ops_detector_last_full_run set last_run_at = now(), last_result = n where detector = k;
  return n;
end $function$;
revoke all on function public.mon_detect_posting_date_alarm_selftest() from public, anon, authenticated;
grant execute on function public.mon_detect_posting_date_alarm_selftest() to service_role;

-- Roster, needle-inserted next to its siblings (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_posting_date_alarm_selftest' in src) > 0 then
    raise notice 'mon_detect_posting_date_alarm_selftest already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_shared_posting_stamp'',',
    E'    ''mon_detect_shared_posting_stamp'',\n    ''mon_detect_posting_date_alarm_selftest'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('posting_date_alarm_selftest' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes posting_date_alarm_selftest';
    return;
  end if;
  out_def := replace(src, '^(source_posting_date_fill_regressed|shared_posting_stamp|',
                          '^(source_posting_date_fill_regressed|shared_posting_stamp|posting_date_alarm_selftest|');
  if out_def = src then
    raise exception 'routing anchor not found — refusing to guess where the kind belongs';
  end if;
  execute out_def;
end $$;

-- PROOF at apply: the self-test passes on production, its wrapper is on the roster and routed, and nothing it
-- planted is left behind.
select public.ops_posting_date_alarm_selftest();
select public.mon_detect_posting_date_alarm_selftest();
do $$
begin
  if to_regclass('public.zzpdselftest_residential_listings') is not null
  or exists (select 1 from public.ops_source_posting_date_policy where platform = 'zzpdselftest' or read_from = '__selftest__')
  or exists (select 1 from public.alert_event where dedup_key in ('source_posting_date_fill_regressed:zzpdselftest', 'posting_date_alarm_selftest') and resolved_at is null)
  or (select count(*) from public.ops_source_posting_date_policy where publishes = 'yes') < 100 then
    raise exception 'PROOF: the self-test left something behind or failed';
  end if;
  if position('mon_detect_posting_date_alarm_selftest' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the self-test is not on the roster';
  end if;
  if public.ops_engineer_for_alert('posting_date_alarm_selftest', null) is distinct from 'scraping-engineer' then
    raise exception 'PROOF: posting_date_alarm_selftest is not routed to the scraping lane';
  end if;
end $$;
