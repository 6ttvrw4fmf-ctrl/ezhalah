-- v3 of mon_detect_served_despite_direct_404. Supersedes v2 (20260911...) which was CORRECT but
-- TIMED OUT: its feed-resurrection guard ran a correlated NOT EXISTS against listing_native_location_v2,
-- which is a VIEW, so the view was re-planned per candidate row and the function exceeded 60s. A
-- detector that cannot finish is a DARK detector — the exact failure this repo has been burned by —
-- so the fix is not optional. v3 reads each platform's RAW table directly for last_seen_at, which is
-- both the faster path and the more honest signal: last_seen_at is written by the crawl that actually
-- saw the listing in the platform's feed.
--
-- The two narrowing conditions from v2 are unchanged in meaning:
--   A. TRUSTED RUNS ONLY — a probe counts only if a liveness run for that platform finished ok=true
--      within the 6h before it. A quarantined run's 404s are UNKNOWN, never death.
--   B. FEED RESURRECTION — a row the crawl re-saw after its 404 is alive, full stop.
--
-- Measured on gathern the day this was written: 5,128 dead probes -> 1,439 after (B) -> 0 after (A).
-- Zero is the truth: every gathern probe we hold came from a quarantined run, so we have NO
-- trustworthy evidence that any gathern listing is dead. See ops_incident #168.
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
    with trusted_runs as (
      select split_part(platform, '_liveness', 1) as tok, started_at
        from public.scrape_runs
       where platform like '%\_liveness%' and ok is true
         and started_at > now() - interval '90 days'
    ), g as (
      select distinct on (d.listing_id) 'gathern_residential_listings'::text src, 'gathern'::text tok,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.gathern_liveness_detail d
        join public.gathern_residential_listings r0 on r0.id = d.listing_id
       order by d.listing_id, d.run_at desc
    ), wr as (
      select distinct on (d.listing_id) 'wasalt_residential_listings'::text, 'wasalt'::text,
             d.listing_id, d.get_status, d.run_at, r0.last_seen_at, r0.active
        from public.wasalt_liveness_pilot_detail d
        join public.wasalt_residential_listings r0 on r0.id = d.listing_id
       where d.tbl = 'wasalt_residential_listings'
       order by d.listing_id, d.run_at desc
    ), wc as (
      select distinct on (d.listing_id) 'wasalt_commercial_listings'::text, 'wasalt'::text,
             d.listing_id, d.get_status, d.run_at, r0.last_seen_at, r0.active
        from public.wasalt_liveness_pilot_detail d
        join public.wasalt_commercial_listings r0 on r0.id = d.listing_id
       where d.tbl = 'wasalt_commercial_listings'
       order by d.listing_id, d.run_at desc
    ), ar as (
      select distinct on (d.listing_id) 'aqar_residential_listings'::text, 'aqar'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.aqar_liveness_detail d
        join public.aqar_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'aqar_residential_listings'
       order by d.listing_id, d.run_at desc
    ), ac as (
      select distinct on (d.listing_id) 'aqar_commercial_listings'::text, 'aqar'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.aqar_liveness_detail d
        join public.aqar_commercial_listings r0 on r0.id = d.listing_id
       where d.source_table = 'aqar_commercial_listings'
       order by d.listing_id, d.run_at desc
    ), dr as (
      select distinct on (d.listing_id) 'dealapp_residential_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_residential_listings'
       order by d.listing_id, d.run_at desc
    ), dc as (
      select distinct on (d.listing_id) 'dealapp_commercial_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_commercial_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_commercial_listings'
       order by d.listing_id, d.run_at desc
    ), probes(src, tok, listing_id, http_status, run_at, last_seen_at, active) as (
      select * from g  union all select * from wr union all select * from wc
      union all select * from ar union all select * from ac
      union all select * from dr union all select * from dc
    )
    select p.src,
           count(*) as cnt,
           min(p.run_at) as oldest_probe,
           max(p.run_at) as newest_probe
      from probes p
      join public.search_listings_ar s
        on s.source_table = p.src and s.listing_id = p.listing_id and s.production_ready
     where p.http_status in (404, 410)          -- definitive dead only; never 403/429/5xx/timeout
       and p.active
       and p.last_seen_at <= p.run_at           -- (B) not re-seen in the platform feed since the 404
       and exists (                              -- (A) the probing run must have been TRUSTED
             select 1 from trusted_runs tr
              where tr.tok = p.tok
                and tr.started_at <= p.run_at
                and tr.started_at >  p.run_at - interval '6 hours')
     group by p.src
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
            || 'platform''s feed since. Probes from quarantined runs are excluded, so this is evidence '
            || 'of death rather than of a refused egress.',
        'adjudicate', 'Check that the platform''s liveness sweep is running AND finishing ok=true. Do '
            || 'NOT bulk-flip active=false to clear this alert: LISTING_LIVENESS.md requires a DIRECT '
            || 'fetch at full grace, the sweeps carry anomaly caps that will correctly quarantine a '
            || 'large kill batch, and a row whose missing_count is below grace has not earned a kill '
            || 'no matter how many 404s one day produced. Restore the sweep and let its strike logic '
            || 'retire them.'
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
  'the crawl has not re-seen it in the platform feed since. v3 (2026-09-11): reads raw tables for '
  'last_seen_at instead of the listing_native_location_v2 VIEW, because the correlated view lookup '
  'made v2 exceed 60s and a detector that cannot finish is dark. Excludes probes from quarantined '
  'runs: a refused egress answers 404 and is UNKNOWN, never death. Scheduled as pg_cron job '
  'mon-served-despite-direct-404 at ''32 */6 * * *''.';