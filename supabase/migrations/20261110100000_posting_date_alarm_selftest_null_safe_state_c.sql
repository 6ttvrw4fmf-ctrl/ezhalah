-- THE POSTING-DATE ALARM SELF-TEST: STATE C COMPARES WITH «IS DISTINCT FROM», SO A MISSING VALUE FAILS IT.
--
-- Review of 20261110093000 (CodeRabbit, PR #11606): state C checked `(d->>'with_readable_date')::int <> 5`. A detail
-- without that key gives NULL, «NULL <> 5» is not true, and the IF passed without checking anything. Both values
-- are now compared with IS DISTINCT FROM. The function is re-created whole (only that line changes) so
-- scripts/verify-posting-date-alarm-judges-live-ads.ts reads its real definition; it runs again below and must pass.

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
    -- IS DISTINCT FROM: a missing key is NULL, and «NULL <> 5» is not true, so it would pass unchecked.
    if (d->>'new_rows')::int is distinct from 30 or (d->>'with_readable_date')::int is distinct from 5 then
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

select public.ops_posting_date_alarm_selftest();
