-- Wasalt Arabic-enrichment pipeline fix (owner-approved, 2026-07-16).
--
-- ROOT CAUSE: wasalt-enrich-ar.yml (the ONLY job that sets ar_fetched=true / city_ar / district_ar —
-- the flag listing_native_location_v1 requires for a Wasalt row to ever reach search_listings_ar) was
-- created 2026-06-25 with "workflow_dispatch only... enable the pg_cron entry when ready" explicitly
-- left as a follow-up. That pg_cron entry was never added. The DAILY job that DOES run
-- (gh-wasalt-enrich → wasalt-enrich.yml → enrich.py) is a completely different, unrelated pipeline
-- (deep REGA detail-page fields) that never touches ar_fetched — confirmed by grep, zero references.
-- Result: ~19 days of un-enriched, unsearchable Wasalt listings piled up with zero processing —
-- 5,445 residential + 166 commercial as of this migration, oldest from 2026-06-27. A one-time manual
-- run likely happened right after creation (oldest pending is 2 days after the creation commit), then
-- nothing since. A circuit breaker added 2026-07-07 (enrich.py/enrich_ar.py, max_pending=5000) also
-- means the backlog, once it crossed 5000, would refuse to self-heal even if someone tried a plain
-- workflow_dispatch — it needs the new allow_backfill override (added alongside this migration in the
-- same PR) for the one-time drain.
--
-- MEASURED (this session): steady-state residential intake ~15-130 new pending rows/day, one
-- anomalous spike day (2026-07-12, +4,126 in a single day — a one-time bulk event, not the new
-- normal). Commercial is light, ~1-91/day. Default enrich_ar.py capacity is limit=2000/table/run,
-- workers=6 — comfortably above steady-state even at a daily cadence, but the schedule below runs
-- every 4 hours (6x/day, 12,000/table/day theoretical capacity) so intake can never outrun capacity
-- again, including a repeat of the 2026-07-12-sized spike, and so a newly-scraped listing's worst-case
-- wait for enrichment is ~4h (then up to ~75min more for the existing v1-refresh + search-sync hourly
-- chain to surface it — see listing_native_location_v1 refresh, jobid 17, and sync_search_listings_ar,
-- jobid 28).
--
-- FIX (this migration):
--   1) Schedule wasalt-enrich-ar.yml every 4 hours (mirrors the existing gh-wasalt-* naming/pattern).
--   2) A dedicated detector, mon_detect_wasalt_enrich_backlog(), added as its OWN standalone function +
--      cron entry — NOT wired into the shared mon_run_all_detectors() dispatcher, since a concurrent
--      session's "Batch 0/1/2/4" work is actively editing that exact function on unmerged branches
--      right now; a standalone entry gets identical monitoring (same alert_event table, same mon_raise
--      dedup, same mon_dispatch_alerts delivery) with zero risk of colliding with that other work.
--   3) enrich_ar.py/wasalt-enrich-ar.yml changes (allow_backfill/max_pending inputs, scrape_runs
--      begin_run/end_run wiring under distinct platform names wasalt_enrich_ar_residential/commercial)
--      ship in the same PR as this migration — see scrapers/wasalt/enrich_ar.py.

begin;

-- (1) Actually schedule the job that was always meant to run automatically.
select cron.schedule(
  'gh-wasalt-enrich-ar',
  '15 */4 * * *',
  $$select public.trigger_gh_workflow('wasalt-enrich-ar.yml')$$
);

-- (2) Detector: backlog size, oldest-pending age, and "run reported ok but processed too few rows".
-- Standalone (see note above for why this isn't added to mon_run_all_detectors()).
create or replace function public.mon_detect_wasalt_enrich_backlog()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  res_pending int; res_oldest timestamptz;
  com_pending int; com_oldest timestamptz;
  rec record;
begin
  select count(*), min(scraped_at) into res_pending, res_oldest
    from public.wasalt_residential_listings where active and not ar_fetched;
  select count(*), min(scraped_at) into com_pending, com_oldest
    from public.wasalt_commercial_listings where active and not ar_fetched;

  -- Backlog-size alert: 3000 is a comfortable early warning well below the 5000 circuit-breaker
  -- threshold, so an operator gets paged before the pipeline would ever refuse to self-heal again.
  if res_pending > 3000 then
    n := n + public.mon_raise('P1', 'wasalt_enrich_backlog_high', 'wasalt_residential_listings',
      'wasalt_enrich_backlog_high:wasalt_residential_listings',
      jsonb_build_object('pending', res_pending, 'threshold', 3000));
  end if;
  if com_pending > 3000 then
    n := n + public.mon_raise('P1', 'wasalt_enrich_backlog_high', 'wasalt_commercial_listings',
      'wasalt_enrich_backlog_high:wasalt_commercial_listings',
      jsonb_build_object('pending', com_pending, 'threshold', 3000));
  end if;

  -- Oldest-pending-age alert: with a 4-hourly schedule, nothing genuinely healthy should ever sit
  -- un-enriched for a full day.
  if res_oldest is not null and now() - res_oldest > interval '24 hours' then
    n := n + public.mon_raise('P1', 'wasalt_enrich_stale_oldest', 'wasalt_residential_listings',
      'wasalt_enrich_stale_oldest:wasalt_residential_listings',
      jsonb_build_object('oldest_pending_scraped_at', res_oldest, 'age', (now() - res_oldest)::text));
  end if;
  if com_oldest is not null and now() - com_oldest > interval '24 hours' then
    n := n + public.mon_raise('P1', 'wasalt_enrich_stale_oldest', 'wasalt_commercial_listings',
      'wasalt_enrich_stale_oldest:wasalt_commercial_listings',
      jsonb_build_object('oldest_pending_scraped_at', com_oldest, 'age', (now() - com_oldest)::text));
  end if;

  -- "Reports success but processes too few rows": the exact shape of this incident (circuit breaker
  -- or mass failure silently no-ops while the job still exits 0). Looks at each enrich platform's
  -- most recent scrape_runs row; rows_seen is the pending backlog at the START of that run (set by
  -- enrich_ar.py), rows_upserted is what it actually got through.
  for rec in
    select platform, rows_seen, rows_upserted, started_at
    from (
      select platform, coalesce(rows_seen, 0) rows_seen, coalesce(rows_upserted, 0) rows_upserted,
             started_at,
             row_number() over (partition by platform order by started_at desc) rn
      from public.scrape_runs
      where platform in ('wasalt_enrich_ar_residential', 'wasalt_enrich_ar_commercial')
    ) x where rn = 1
  loop
    if rec.rows_seen > 100 and rec.rows_upserted < rec.rows_seen * 0.1 then
      n := n + public.mon_raise('P1', 'wasalt_enrich_low_throughput', rec.platform,
        'wasalt_enrich_low_throughput:' || rec.platform,
        jsonb_build_object('rows_seen', rec.rows_seen, 'rows_upserted', rec.rows_upserted,
          'started_at', rec.started_at));
    end if;
  end loop;

  -- Self-heal: resolve once the underlying condition clears, same pattern as the existing detectors.
  update public.alert_event set resolved_at = now()
  where kind = 'wasalt_enrich_backlog_high' and resolved_at is null
    and ((platform = 'wasalt_residential_listings' and res_pending <= 3000)
      or (platform = 'wasalt_commercial_listings' and com_pending <= 3000));

  update public.alert_event set resolved_at = now()
  where kind = 'wasalt_enrich_stale_oldest' and resolved_at is null
    and ((platform = 'wasalt_residential_listings'
          and (res_oldest is null or now() - res_oldest <= interval '24 hours'))
      or (platform = 'wasalt_commercial_listings'
          and (com_oldest is null or now() - com_oldest <= interval '24 hours')));

  update public.alert_event set resolved_at = now()
  where kind = 'wasalt_enrich_low_throughput' and resolved_at is null
    and platform in (
      select platform from (
        select platform, coalesce(rows_seen, 0) rows_seen, coalesce(rows_upserted, 0) rows_upserted,
               row_number() over (partition by platform order by started_at desc) rn
        from public.scrape_runs
        where platform in ('wasalt_enrich_ar_residential', 'wasalt_enrich_ar_commercial')
      ) y where rn = 1 and (rows_seen <= 100 or rows_upserted >= rows_seen * 0.1)
    );

  return n;
end
$function$;

-- Runs every hour at :35 — offset from the existing mon-detectors-and-dispatch job (:20/:50) and
-- location-pipeline-monitor (:45) so they don't all contend for the same tick. mon_dispatch_alerts()
-- (already scheduled) picks up whatever mon_raise() inserted here on its own next run — no separate
-- dispatch needed.
select cron.schedule(
  'wasalt-enrich-backlog-monitor',
  '35 * * * *',
  $$select public.mon_detect_wasalt_enrich_backlog()$$
);

commit;
