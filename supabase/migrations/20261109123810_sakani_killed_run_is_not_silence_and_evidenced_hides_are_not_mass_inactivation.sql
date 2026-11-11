-- A killed run is not an empty source, and a direct-oracle removal is not a mass accident (sakani, 2026-11-09).
--
-- MEASURED. scrape_runs 103069 (sakani, 11-09 04:35 UTC): the walk finished at 06:02 and 1,629 rows were written,
-- then the prune's oracle ran until timeout-minutes 150 cancelled the job at 07:04, before end_run(). The signal
-- handler closed the row «killed by SIGINT … rows_seen 0», and mon_detect_crawl_went_silent — which reads the
-- LATEST finished run, ok or not — fired «saw under 5% of its healthy runs» on a crawl that had just upserted
-- everything. A killed run proves nothing about the source either way; mon_detect_run_killed_by_timeout already
-- names the kill.
--
-- The same two days mon_detect_mass_inactivation fired on sakani (90 rows 11-08, 121 rows 11-09, p90 0 because
-- its oracle joined APPLY on 11-08). Every one of those rows carries a GONE row in ops_stale_inactivation_probe:
-- the owner rule of 2026-11-04 (blank 403 on two reads while a live control read 200), three strikes across
-- separate runs, kill cap, controls live at both ends — and two of them opened in a real browser show sakani's own
-- 403 «طلب غير مصرح للمحتوى» page while the control renders a listing. The detector could not see that evidence.
--
-- 1. mon_detect_crawl_went_silent: a run whose notes carry the kill phrase is left out of «latest» and of the
--    baseline, so the verdict comes from the last run that actually finished.
-- 2. mon_detect_mass_inactivation: a day's DIRECT GONE verdicts (ops_stale_inactivation_probe, same platform's
--    tables, Riyadh day with a 2 h lead) are subtracted; the P1 is raised on the UNEXPLAINED remainder. The blind
--    spot is not widened: when the evidenced kills alone exceed mass_inact_evidenced_frac (default 10 %) of the
--    platform's active rows in one day, it still raises — a runaway oracle is a mass inactivation too — and the
--    detail says which case it is (marked_inactive, evidenced, unexplained).
-- 3. The two sakani alerts (11-08, 11-09) are resolved as adjudicated-correct; crawl_went_silent:sakani
--    self-resolves on the next sweep through mon_resolve_stale_keys.

insert into public.mon_config (key, value, note)
select 'mass_inact_evidenced_frac', '0.10',
       'mass_inactivation: direct-oracle GONE kills (ops_stale_inactivation_probe) are subtracted from a day''s '
       'marked_inactive, but when they alone exceed this fraction of active_now the day still raises (runaway oracle).'
where not exists (select 1 from public.mon_config where key = 'mass_inact_evidenced_frac');

create or replace function public.mon_detect_crawl_went_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    with ap as (
      select platform from public.platform_registry where status = 'active' and kind = 'source'
    ), runs as (
      select ap.platform, s.platform as label, s.started_at, s.ok, coalesce(s.rows_seen, 0) as rows_seen, s.notes
        from ap join public.scrape_runs s on (s.platform = ap.platform or s.platform like ap.platform || '\_%')
       where s.platform !~ ':'
         and s.platform !~ '_enrich'          -- a backfill's rows_seen is its backlog: 0 is a done job
         and s.started_at > now() - interval '8 days'
         and s.finished_at is not null
         -- A run the CI killed before end_run() (db._finalize_open_run_on_signal) proves nothing about the
         -- source: its counts are begin_run()'s zeros. mon_detect_run_killed_by_timeout names the kill.
         and coalesce(s.notes, '') !~* 'killed by SIG|before end_run\(\)'
         and not exists (select 1 from public.ops_platform_catalogue_rebase cr
                          where cr.platform = ap.platform and s.started_at < cr.rebased_at)
    ), last as (
      select distinct on (label) * from runs order by label, started_at desc
    ), base as (
      select x.label, percentile_cont(0.5) within group (order by x.rows_seen)::numeric as median_rows, count(*) as healthy_runs
        from runs x join last l using (label)
       where x.ok and x.rows_seen > 0 and x.started_at < l.started_at
       group by x.label
    )
    select l.platform, l.label, l.started_at, l.ok, l.rows_seen, l.notes, b.median_rows, b.healthy_runs
      from last l join base b using (label)
     where b.median_rows >= 1000
       and l.rows_seen < 0.05 * b.median_rows
       and l.started_at > now() - interval '36 hours'
  loop
    live := live || ('crawl_went_silent:' || r.label);
    n := n + public.mon_raise('P1', 'crawl_went_silent', r.platform, 'crawl_went_silent:' || r.label,
      jsonb_build_object('label', r.label, 'last_run_at', r.started_at, 'last_ok', r.ok, 'last_rows_seen', r.rows_seen,
        'median_rows_8d', r.median_rows, 'healthy_runs_8d', r.healthy_runs, 'last_notes', left(r.notes, 300), 'for', '⚡',
        'why', 'This crawl''s latest run saw under 5% of what its own healthy runs see (Dwelleo 6,996 → 0 on '
            || '2026-11-04 paged nobody until the next day). Read last_notes, then the source in a rendered browser '
            || '(four places). If the source really shrank, record it in ops_platform_catalogue_rebase with the '
            || 'evidence; if not, fix the crawl. Its prune guard is holding the old ads meanwhile.'));
  end loop;
  perform public.mon_resolve_stale_keys('crawl_went_silent', live);
  return n;
end $function$;

create or replace function public.mon_detect_mass_inactivation()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record; n int := 0;
  factor numeric; floor_n numeric; frac numeric; gap_days numeric; ev_frac numeric; thresh numeric;
  unexplained numeric; reason text;
begin
  select value::numeric into factor   from public.mon_config where key = 'mass_inact_factor';
  select value::numeric into floor_n  from public.mon_config where key = 'mass_inact_floor';
  select value::numeric into frac     from public.mon_config where key = 'mass_inact_active_frac';
  select value::numeric into gap_days from public.mon_config where key = 'mass_inact_baseline_gap_days';
  select value::numeric into ev_frac  from public.mon_config where key = 'mass_inact_evidenced_frac';
  factor   := coalesce(factor, 3);
  floor_n  := coalesce(floor_n, 50);
  frac     := coalesce(frac, 0.02);
  gap_days := coalesce(gap_days, 5);
  ev_frac  := coalesce(ev_frac, 0.10);

  for rec in
    select d.day, d.platform, d.marked_inactive, d.active_now, h.p90, e.evidenced
    from public.crawl_stats_platform_daily d
    cross join lateral (
      select coalesce(percentile_cont(0.9) within group (order by h2.marked_inactive), 0) as p90
      from public.crawl_stats_platform_daily h2
      where h2.platform = d.platform
        -- `date - integer` (was `date - numeric`, which does not exist and crashed the detector)
        and h2.day >= d.day - (30 + gap_days)::int
        and h2.day <  d.day - gap_days::int
    ) h
    cross join lateral (
      -- Rows this platform's own liveness oracle read GONE on its own URL that day (a direct verdict with
      -- a recorded reason: prune_unseen.verify_gone, fleet_liveness.<site>). crawl_stats days are Riyadh
      -- days; a kill stamped in the two hours before midnight is captured on the next day's row.
      select count(distinct (p.source_table, p.listing_id)) as evidenced
      from public.ops_stale_inactivation_probe p
      where upper(p.verdict) = 'GONE'
        and regexp_replace(p.source_table, '_(residential|commercial)_listings$', '') = d.platform
        and (p.probed_at at time zone 'Asia/Riyadh') >= d.day::timestamp - interval '2 hours'
        and (p.probed_at at time zone 'Asia/Riyadh') <  (d.day + 1)::timestamp
    ) e
    where d.day >= current_date - 1
      and d.marked_inactive > floor_n
  loop
    thresh := greatest(floor_n, factor * rec.p90);
    unexplained := greatest(rec.marked_inactive - coalesce(rec.evidenced, 0), 0);
    reason := null;
    if unexplained > thresh and unexplained > frac * greatest(rec.active_now, 1) then
      reason := 'unexplained: rows hidden with no direct GONE verdict of their own exceed the baseline';
    elsif coalesce(rec.evidenced, 0) > ev_frac * greatest(rec.active_now, 1) then
      reason := 'evidenced: direct-oracle kills alone exceed mass_inact_evidenced_frac of active_now in one day '
                '(a runaway oracle is a mass inactivation too)';
    end if;
    if reason is not null then
      n := n + public.mon_raise('P1', 'mass_inactivation', rec.platform,
        'mass_inactivation:' || rec.platform || ':' || rec.day,
        jsonb_build_object(
          'day', rec.day, 'marked_inactive', rec.marked_inactive,
          'evidenced', coalesce(rec.evidenced, 0), 'unexplained', unexplained, 'reason', reason,
          'threshold', round(thresh), 'p90_30d', round(rec.p90),
          'active_now', rec.active_now,
          'factor', factor, 'floor', floor_n, 'active_frac', frac, 'evidenced_frac', ev_frac,
          'baseline_gap_days', gap_days));
    end if;
  end loop;

  update public.alert_event set resolved_at = now()
   where kind = 'mass_inactivation' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $function$;

-- Proof at apply time, in a rolled-back sub-transaction: a day whose hides are ALL evidenced raises nothing; the
-- same day with no evidence raises; a day of evidenced kills above the evidenced fraction raises.
do $$
declare raised int;
begin
  begin
    delete from public.alert_event where kind = 'mass_inactivation' and dedup_key like 'mass_inactivation:zz_proof%';
    -- 1,000 active, 100 hidden today, 100 evidenced → unexplained 0 → silent
    insert into public.crawl_stats_run (total_active, total_searchable, total_review_queue, total_raw)
      values (0, 0, 0, 0);
    insert into public.crawl_stats_platform (run_id, platform, new_listings, reactivated, marked_inactive, deleted, active_now)
      select max(id), 'zz_proof', 0, 0, 100, 0, 1000 from public.crawl_stats_run;
    insert into public.ops_stale_inactivation_probe (source_table, listing_id, listing_url, verdict, oracle, note, ad_number)
      select 'zz_proof_residential_listings', g, '', 'GONE', 'proof', 'proof', 'ZZ' || g from generate_series(1, 100) g;
    raised := public.mon_detect_mass_inactivation();
    if exists (select 1 from public.alert_event where dedup_key like 'mass_inactivation:zz_proof%') then
      raise exception 'proof 1: a fully evidenced day must not raise';
    end if;
    -- 2. the same day with its evidence gone raises (the classic case is unchanged)
    delete from public.ops_stale_inactivation_probe where source_table = 'zz_proof_residential_listings';
    raised := public.mon_detect_mass_inactivation();
    if not exists (select 1 from public.alert_event where dedup_key like 'mass_inactivation:zz_proof%'
                     and detail->>'reason' like 'unexplained%') then
      raise exception 'proof 2: an unevidenced day must raise';
    end if;
    delete from public.alert_event where dedup_key like 'mass_inactivation:zz_proof%';
    -- 3. 150 evidenced kills of 1,000 active (> 10 %) raise as a runaway oracle
    update public.crawl_stats_platform set marked_inactive = 150 where platform = 'zz_proof';
    insert into public.ops_stale_inactivation_probe (source_table, listing_id, listing_url, verdict, oracle, note, ad_number)
      select 'zz_proof_residential_listings', g, '', 'GONE', 'proof', 'proof', 'ZZ' || g from generate_series(1, 150) g;
    raised := public.mon_detect_mass_inactivation();
    if not exists (select 1 from public.alert_event where dedup_key like 'mass_inactivation:zz_proof%'
                     and detail->>'reason' like 'evidenced%') then
      raise exception 'proof 3: evidenced kills above the fraction must still raise';
    end if;
    raise exception 'ROLLBACK_PROOF';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PROOF' then raise; end if;
  end;
end $$;

-- Adjudicated 2026-11-09: every sakani hide of 11-08/11-09 carries a direct GONE verdict (owner rule, live control);
-- two opened in a real browser show the site's own 403 page while the control renders. Correct behaviour, not an accident.
update public.alert_event set resolved_at = now()
 where kind = 'mass_inactivation' and resolved_at is null
   and dedup_key in ('mass_inactivation:sakani:2026-11-08', 'mass_inactivation:sakani:2026-11-09');