-- ─────────────────────────────────────────────────────────────────────────────────────────
-- INCIDENT 2026-08-10 (~16:20–17:45 UTC): DB WEDGED, USERS GOT 522s ON EVERY SEARCH.
-- Root cause: cron stampede. 40+ jobs with colliding minute-slots — :00 fired FIVE at once
-- (900s matview refresh + */15 tick + two */10 resolvers + a */20 15k-row PII scan); the
-- 10-minute resolver ladder had 8 jobs with two same-minute pairs; parallel agent sessions
-- kept adding jobs (ids 45→66) with no global schedule coordination. Under the aligned load
-- Postgres stopped logging for ~80 min (frozen), refused all connections, and PostgREST
-- returned 522 until it self-recovered at 17:45.
--
-- FIX 1 (applied live via cron.alter_job, recorded here): ONE JOB PER MINUTE-SLOT.
--   :00 reserved for the 900s matview refresh (jobid 17) ALONE. 10-min lanes 1/3/5/6/8 for
--   the big-platform resolvers only (aqar/dealapp/payment). Tiny-platform + scan jobs
--   downgraded to hourly (raghdan has 361 listings; a 10-min resolver was pure load):
--     25 resolve_aqar_locations            → '1-59/10 * * * *'
--     41 resolve_dealapp_districts         → '3-59/10 * * * *'  (unchanged)
--     44 sync_payment_monthly              → '5-59/10 * * * *'  (unchanged)
--     54 resolve_dealapp_city              → '6-59/10 * * * *'  (unchanged)
--     61 propagate_dealapp_resolved_locs   → '8-59/10 * * * *'  (unchanged)
--     22 loc_rel_refresh_tick              → '4-59/15 * * * *'
--     28 sync_search_listings_ar (117s)    → '14 * * * *'
--     35 resolve_english_city_overlay      → '6 * * * *'
--     38 mon detectors + dispatch          → '29,59 * * * *'
--     46 rebuild_age_producer              → '44 * * * *'
--     53 mon_watchdog                      → '9,39 * * * *'
--     55 resolve_small_platform_cities     → '12 * * * *'
--     57 resolve_raghdan_city              → '16 * * * *'
--     65 mon_scan_pii_capture_batch(15000) → '36 * * * *'
--   (idempotent re-assert so a replay converges on the canonical schedule)
select cron.alter_job(25, schedule := '1-59/10 * * * *');
select cron.alter_job(22, schedule := '4-59/15 * * * *');
select cron.alter_job(28, schedule := '14 * * * *');
select cron.alter_job(35, schedule := '6 * * * *');
select cron.alter_job(38, schedule := '29,59 * * * *');
select cron.alter_job(46, schedule := '44 * * * *');
select cron.alter_job(53, schedule := '9,39 * * * *');
select cron.alter_job(55, schedule := '12 * * * *');
select cron.alter_job(57, schedule := '16 * * * *');
select cron.alter_job(65, schedule := '36 * * * *');

-- FIX 2 (the never-again barrier): a LIVE collision detector. Any future session that adds or
-- edits a cron job into a pileup (≥3 every-hour jobs sharing a minute, or ANY second job at :00)
-- raises a P1 within one detector cycle — regardless of how the job was added. Self-resolves.
create or replace function public.mon_detect_cron_minute_collision()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_bad text; v_open boolean; n int := 0;
begin
  with hourly_jobs as (
    select jobid, split_part(schedule,' ',1) as min_f
    from cron.job where active and split_part(schedule,' ',2) = '*'
  ),
  expanded as (
    select j.jobid, m.minute
    from hourly_jobs j cross join generate_series(0,59) m(minute)
    where (j.min_f = '*')
       or (j.min_f ~ '^\d+$' and m.minute = j.min_f::int)
       or (j.min_f ~ '^\d+(,\d+)+$' and m.minute::text = any(string_to_array(j.min_f,',')))
       or (j.min_f ~ '^\*/\d+$' and m.minute % split_part(j.min_f,'/',2)::int = 0)
       or (j.min_f ~ '^\d+-59/\d+$' and m.minute >= split_part(j.min_f,'-',1)::int
           and (m.minute - split_part(j.min_f,'-',1)::int) % split_part(j.min_f,'/',2)::int = 0)
  )
  select string_agg(format('min %s → jobs %s', minute, jobids), '; ')
    into v_bad
  from (
    select minute, count(*) as c, string_agg(jobid::text,',' order by jobid) as jobids
    from expanded group by minute
    having count(*) >= 3 or (minute = 0 and count(*) > 1)
  ) x;

  v_open := exists (select 1 from public.alert_event
                    where dedup_key='cron_minute_collision' and resolved_at is null);
  if v_bad is null then
    if v_open then perform public.mon_resolve('cron_minute_collision','cron'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P1','cron_minute_collision','cron','cron_minute_collision',
      jsonb_build_object('collisions', v_bad,
        'why','cron stampede risk: overlapping minute-slots wedged the DB on 2026-08-10 (522 outage). One job per minute-slot; :00 belongs to the matview refresh alone.'));
  end if;
  return n;
end $$;

-- wire into the roster: rebuild from the LIVE body shape (array literal + one new entry)
-- NOTE: this version accidentally rebuilt from the stale 20260804120000 roster — corrected by
-- 20260810175245_restore_full_detector_roster_union (kept verbatim for history fidelity).
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
    'mon_detect_search_gate_leak',
    'mon_detect_cron_minute_collision',    -- new 2026-08-10: cron-stampede tripwire (522 incident)
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
