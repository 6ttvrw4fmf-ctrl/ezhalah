-- v2 of mon_detect_served_despite_direct_404 (v1 landed earlier today in 20260911141904).
--
-- WHY THIS COULD NOT WAIT. v1 asked "is a production_ready row's latest direct probe a 404?" and
-- reported 1,431 rows for gathern. That number READ AS A KILL LIST, and this routine came within one
-- step of retiring those listings on it. It would have destroyed live inventory. Three facts, all
-- measured 2026-09-11, say why:
--
--   1. EVERY gathern probe in the table came from a QUARANTINED run. scrape_runs shows the sweep ran
--      every single day: 09-04/05/06 TRUST-QUARANTINED (alive_rate 1.2%/0.9%/3.4%, would_strike~1480,
--      inactivated=0) and 09-07..09-11 CANARY-QUARANTINED (0/10 known-alive controls returned 200,
--      worklist never probed). The sweep's own words: "the SOURCE answered and refused this egress —
--      a different route may work, but these 404s are UNKNOWN, never death."
--   2. 139 rows in that cohort were RE-SEEN IN GATHERN'S OWN FEED AFTER their 404, 40 of them within
--      24h. Those listings are provably alive; the 404 was false for them.
--   3. All 1,478 carry missing_count = 0 — not one liveness strike, because every quarantined run
--      correctly wrote none. The platform's approved grace is THREE strikes. Acting on v1's number
--      would have gone 0 -> deactivated in one step.
--
-- So v1 measured a real condition and attached it to the wrong conclusion. A monitor that turns
-- UNKNOWN into an apparent death toll is the same laundering the liveness contract forbids in the
-- kill path — just moved into the alerting layer, where it is read by whoever acts next.
--
-- TWO ADDED CONDITIONS, both narrowing:
--   A. TRUSTED RUNS ONLY. A probe counts only if a liveness run for that platform finished ok=true
--      within the 6h before it. A quarantined run's 404s are UNKNOWN and are now excluded by
--      construction rather than by the reader's judgement.
--   B. FEED RESURRECTION, from the RAW table. v1 used search_listings_ar.last_updated; the raw
--      last_seen_at is the stronger signal because it is written by the crawl that actually saw the
--      listing in the platform's feed. A row seen in the feed after its 404 is alive, full stop.
--
-- Net effect today: gathern reports 0, which is the truth — we currently hold NO trustworthy
-- direct-probe evidence that any gathern listing is dead. The inability to verify is a real problem,
-- but it is already alerted as refresh_coverage/rows_collapse and as ops_incident #168; it is not
-- this detector's to restate as a body count.
create or replace function public.mon_detect_served_despite_direct_404()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  v_open text[];
begin
  select coalesce(array_agg(distinct platform), '{}')
    into v_open
    from public.alert_event
   where kind = 'served_despite_direct_404' and resolved_at is null;

  for r in
    with g as (
      select distinct on (listing_id)
             'gathern_residential_listings'::text as src, listing_id, http_status, run_at
        from public.gathern_liveness_detail order by listing_id, run_at desc
    ), a as (
      select distinct on (source_table, listing_id)
             source_table as src, listing_id, http_status, run_at
        from public.aqar_liveness_detail order by source_table, listing_id, run_at desc
    ), d as (
      select distinct on (source_table, listing_id)
             source_table as src, listing_id, http_status, run_at
        from public.dealapp_liveness_detail order by source_table, listing_id, run_at desc
    ), w as (
      select distinct on (tbl, listing_id)
             tbl as src, listing_id, get_status as http_status, run_at
        from public.wasalt_liveness_pilot_detail order by tbl, listing_id, run_at desc
    ), probes as (
      select * from g union all select * from a union all select * from d union all select * from w
    ), trusted as (
      select p.*
        from probes p
       where p.http_status in (404, 410)          -- definitive dead only; never 403/429/5xx/timeout
         and exists (                              -- (A) the probing run must have been TRUSTED
              select 1 from public.scrape_runs sr
               where sr.platform like split_part(p.src, '_', 1) || '_liveness%'
                 and sr.ok is true
                 and sr.started_at <= p.run_at
                 and sr.started_at >  p.run_at - interval '6 hours')
    )
    select t.src,
           count(*) as cnt,
           min(t.run_at) as oldest_probe,
           max(t.run_at) as newest_probe
      from trusted t
      join public.search_listings_ar s
        on s.source_table = t.src and s.listing_id = t.listing_id and s.production_ready
     where not exists (                            -- (B) feed resurrection, from the RAW crawl
             select 1 from public.listing_native_location_v2 c
              where c.source_table = t.src and c.listing_id = t.listing_id
                and c.last_updated > t.run_at)
     group by t.src
  loop
    n := n + public.mon_raise(
      'P1', 'served_despite_direct_404', r.src,
      'served_despite_direct_404:' || r.src,
      jsonb_build_object(
        'count', r.cnt,
        'source_table', r.src,
        'oldest_probe', r.oldest_probe,
        'newest_probe', r.newest_probe,
        'why', 'these listings are production_ready and returned to users, but a TRUSTED direct probe '
            || 'of each listing''s own URL returned 404/410 and the crawl has not seen it in the '
            || 'platform''s feed since. Probes from quarantined runs are excluded, so this count is '
            || 'evidence of death rather than of a refused egress.',
        'adjudicate', 'Check that the platform''s liveness sweep is running AND finishing ok=true. Do '
            || 'NOT bulk-flip active=false to clear this alert: LISTING_LIVENESS.md requires a DIRECT '
            || 'fetch at full grace, the sweeps carry anomaly caps that will correctly quarantine a '
            || 'large kill batch, and a row with missing_count below grace has not earned a kill no '
            || 'matter how many 404s a single day produced. Restore the sweep and let its own strike '
            || 'logic retire them.'
      ));
    v_open := array_remove(v_open, r.src);
  end loop;

  if v_open is not null then
    foreach r.src in array v_open loop
      perform public.mon_resolve('served_despite_direct_404', r.src);
    end loop;
  end if;

  return n;
end $function$;

comment on function public.mon_detect_served_despite_direct_404() is
  'P1. Raises when a production_ready listing''s latest TRUSTED direct liveness probe was 404/410 and '
  'the crawl has not re-seen it in the platform feed since. v2 (2026-09-11): probes from quarantined '
  'runs are excluded, because a refused egress answers 404 and is UNKNOWN, never death — v1 reported '
  '1,431 gathern rows that were entirely the product of quarantined runs, 139 of which the feed had '
  'already re-seen alive. Scheduled as pg_cron job mon-served-despite-direct-404 at ''32 */6 * * *''.';