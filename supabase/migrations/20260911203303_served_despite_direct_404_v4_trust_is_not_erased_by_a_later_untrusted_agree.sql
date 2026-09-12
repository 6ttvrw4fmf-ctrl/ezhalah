-- v4 of mon_detect_served_despite_direct_404. Supersedes v3 (20260911145248).
--
-- BUG (ops_incident #188): v3 requires the SINGLE LATEST probe per listing to itself carry a
-- trusted (ok=true, within 6h) anchor. Re-probing during a QUARANTINED run still writes a fresh
-- detail row with no trust anchor, silently dropping the listing even when an EARLIER trusted
-- probe already confirmed the same 404/410 and nothing has said otherwise since.
--
-- FIX: a later UNTRUSTED probe may no longer ERASE an earlier TRUSTED one.
--   (a) LATEST PROBE, any trust level, must still read 404/410 (resurrection still clears instantly).
--   (b) SOME probe that specifically carries a trust anchor must ALSO have read 404/410.
-- Nothing about what counts as "trusted", the kill/strike pipeline, or ops_incident #180's owner
-- decision changed. Read-only alerting fix only.
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
      select 'gathern_residential_listings'::text src, 'gathern'::text tok,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.gathern_liveness_detail d
        join public.gathern_residential_listings r0 on r0.id = d.listing_id
    ), wr as (
      select 'wasalt_residential_listings'::text, 'wasalt'::text,
             d.listing_id, d.get_status, d.run_at, r0.last_seen_at, r0.active
        from public.wasalt_liveness_pilot_detail d
        join public.wasalt_residential_listings r0 on r0.id = d.listing_id
       where d.tbl = 'wasalt_residential_listings'
    ), wc as (
      select 'wasalt_commercial_listings'::text, 'wasalt'::text,
             d.listing_id, d.get_status, d.run_at, r0.last_seen_at, r0.active
        from public.wasalt_liveness_pilot_detail d
        join public.wasalt_commercial_listings r0 on r0.id = d.listing_id
       where d.tbl = 'wasalt_commercial_listings'
    ), ar as (
      select 'aqar_residential_listings'::text, 'aqar'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.aqar_liveness_detail d
        join public.aqar_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'aqar_residential_listings'
    ), ac as (
      select 'aqar_commercial_listings'::text, 'aqar'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.aqar_liveness_detail d
        join public.aqar_commercial_listings r0 on r0.id = d.listing_id
       where d.source_table = 'aqar_commercial_listings'
    ), dr as (
      select 'dealapp_residential_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_residential_listings'
    ), dc as (
      select 'dealapp_commercial_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_commercial_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_commercial_listings'
    ), probes(src, tok, listing_id, http_status, run_at, last_seen_at, active) as (
      select * from g  union all select * from wr union all select * from wc
      union all select * from ar union all select * from ac
      union all select * from dr union all select * from dc
    ), latest_probe as (
      select distinct on (src, listing_id) src, tok, listing_id, http_status, run_at, last_seen_at, active
        from probes
       order by src, listing_id, run_at desc
    ), latest_trusted_dead as (
      select distinct on (p.src, p.listing_id) p.src, p.listing_id, p.run_at as trusted_run_at
        from probes p
       where p.http_status in (404, 410)
         and exists (
               select 1 from trusted_runs tr
                where tr.tok = p.tok
                  and tr.started_at <= p.run_at
                  and tr.started_at >  p.run_at - interval '6 hours')
       order by p.src, p.listing_id, p.run_at desc
    )
    select lp.src,
           count(*) as cnt,
           min(ltd.trusted_run_at) as oldest_trusted_confirm,
           max(lp.run_at) as newest_probe
      from latest_probe lp
      join latest_trusted_dead ltd on ltd.src = lp.src and ltd.listing_id = lp.listing_id
      join public.search_listings_ar s
        on s.source_table = lp.src and s.listing_id = lp.listing_id and s.production_ready
     where lp.http_status in (404, 410)
       and lp.active
       and lp.last_seen_at <= lp.run_at
     group by lp.src
  loop
    n := n + public.mon_raise(
      'P1', 'served_despite_direct_404', r.src,
      'served_despite_direct_404:' || r.src,
      jsonb_build_object(
        'count', r.cnt,
        'source_table', r.src,
        'oldest_trusted_confirm', r.oldest_trusted_confirm,
        'newest_probe', r.newest_probe,
        'why', 'these listings are production_ready and returned to users. A TRUSTED direct probe of '
            || 'each listing''s own URL returned 404/410 at some point, the crawl has not seen it in '
            || 'the platform''s feed since, and no later probe (trusted or not) has contradicted that '
            || 'reading. A later UNTRUSTED re-probe that still reads 404 no longer erases the earlier '
            || 'trusted confirmation (ops_incident #188) — but any 200, trusted or not, still clears a '
            || 'listing immediately, since a blocked environment cannot manufacture a live page.',
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
  'P1. Raises when a production_ready listing''s most recent direct liveness probe is 404/410, some '
  'TRUSTED probe (ok=true run, within 6h) also read 404/410 for it, and the crawl has not re-seen it '
  'in the platform feed since. v4 (2026-09-11, ops_incident #188): a later UNTRUSTED re-probe that '
  'still reads dead no longer erases an earlier TRUSTED dead confirmation — only a 200 (from any run) '
  'or a feed re-sighting clears a listing, since a blocked environment cannot manufacture a live page. '
  'Scheduled as pg_cron job mon-served-despite-direct-404 at ''32 */6 * * *''.';
