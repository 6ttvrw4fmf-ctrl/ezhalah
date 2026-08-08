-- A scraper job killed by its CI timeout leaves scrape_runs.ok = NULL and finished_at = NULL
-- forever: end_run() never ran. Nothing watched for that.
--
-- Evidence (2026-08-08): the daily "Small sources sync" run 31239278341 had its dealapp job
-- cancelled at exactly timeout-minutes:90 (04:22:49 -> 05:52:46). scrape_runs id 25397 is still
-- ok=NULL/finished_at=NULL, 1,800 rows were upserted, prune_unseen() and the sold-pin never ran,
-- and ops_freshness_by_layer still shows dealapp scraper_last_ok = 2026-08-07 while every other
-- platform advanced to 08-08. Zero alerts fired.
--
-- mon_detect_silent_scraper_death() cannot cover this: it needs the last THREE runs to be
-- unhealthy, so a job that is killed every day is only noticed on day three, and a dangling row
-- also reports rows_seen=0 even though the run did write rows -- so it reads as a dead source
-- rather than an infrastructure kill.
--
-- Grace is 3h so a legitimately long run never alerts while still in flight: the longest job
-- budget in the repo is souq24's timeout-minutes:150 (small-sources-sync.yml).
create or replace function public.mon_detect_dangling_scrape_run()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; n int := 0;
begin
  for rec in
    select s.platform,
           count(*)                                   as dangling_runs,
           min(s.started_at)                          as oldest,
           max(s.started_at)                          as newest,
           (array_agg(s.id order by s.started_at desc))[1:5] as sample_run_ids
    from public.scrape_runs s
    where s.ok is null
      and s.finished_at is null
      and s.started_at between now() - interval '48 hours' and now() - interval '3 hours'
    group by s.platform
  loop
    n := n + public.mon_raise('P1','dangling_scrape_run', rec.platform,
      'dangling_scrape_run:'||rec.platform||':'||to_char(rec.newest,'YYYY-MM-DD'),
      jsonb_build_object(
        'platform', rec.platform,
        'dangling_runs', rec.dangling_runs,
        'oldest', rec.oldest,
        'newest', rec.newest,
        'sample_run_ids', rec.sample_run_ids,
        'why','scrape_runs row started but never finalized (ok and finished_at both still null) — the job was killed before end_run(), most often the GitHub Actions timeout-minutes budget. Rows it upserted are kept, but prune/sold-pin never ran and the platform''s last-OK freshness signal did not advance. Fix the run budget or the per-run cap; never hand-edit the row.'));
  end loop;

  -- self-heal: resolve once the platform has no dangling run left in the window (the run
  -- finalized late, or it aged past 48h)
  update public.alert_event a set resolved_at = now()
  where a.kind = 'dangling_scrape_run'
    and a.resolved_at is null
    and not exists (
      select 1 from public.scrape_runs s
      where s.platform = a.platform
        and s.ok is null
        and s.finished_at is null
        and s.started_at between now() - interval '48 hours' and now() - interval '3 hours');

  return n;
end $function$;

-- Wire it into the roster. Needle-edit: the array is reproduced verbatim from the live definition
-- with exactly one entry appended, so no existing detector can be dropped the way
-- 20260803194308 silently dropped the unverified-inactivation detector (run #5 finding).
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fns text[] := array[
    'mon_detect_silent_scraper_death',
    'mon_detect_zero_new_stall',
    'mon_detect_stale_active_fraction',
    'mon_detect_volume_drop',
    'mon_detect_cron_health',
    'mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables',
    'mon_detect_field_integrity',
    'mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth',
    'mon_detect_registry_orphans',
    'mon_detect_rls_reachability',
    'mon_detect_mass_inactivation',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation',
    'mon_detect_deletion_spike',
    'mon_detect_buy_token_price_suppression',
    'mon_detect_price_source_mismatch',
    'mon_detect_dangling_scrape_run',
    'mon_detect_orphaned_detectors'
  ];
  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
begin
  foreach fn in array fns loop
    begin
      execute format('select public.%I()', fn) into raised;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);
    exception when others then
      failed := failed || fn;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), 'ERROR: ' || sqlerrm);
      begin
        perform public.mon_raise('P1', 'detector_crash', 'all',
          'detector_crash:' || fn || ':' || current_date,
          jsonb_build_object('detector', fn, 'sqlstate', sqlstate, 'error', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end loop;
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed));
end $function$;
