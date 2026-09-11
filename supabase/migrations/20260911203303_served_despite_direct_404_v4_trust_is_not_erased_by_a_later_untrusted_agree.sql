-- v4 of mon_detect_served_despite_direct_404. Supersedes v3 (20260911145248).
--
-- BUG (ops_incident #188, found by routine-11-lifecycle 2026-09-11 while reporting on #168): v3
-- requires the SINGLE LATEST probe per listing to itself carry a trusted (ok=true, within 6h)
-- anchor. Re-probing a listing during a QUARANTINED run — canary-block or the aggregate alive-rate
-- floor, both legitimate anti-false-kill gates (docs/ops/LISTING_LIVENESS.md 5, ops_incident #180)
-- — still WRITES a fresh gathern_liveness_detail row (measured: TRUST-QUARANTINED runs today wrote
-- 2,093 fresh 404 rows and 57 fresh 200 rows despite `ok=false`). That fresh, untrusted row becomes
-- the new "latest" and, having no trust anchor of its own, silently DROPS the listing from this
-- P1 detector — even when an EARLIER, genuinely trusted probe already confirmed the exact same
-- 404/410 and nothing has said otherwise since. Measured live 2026-09-11 20:19: v3 reported 388
-- gathern rows (only today's freshly-touched, freshly-trusted batch); the true count of listings
-- carrying a real trusted-dead confirmation that nothing has since contradicted is 1,244.
--
-- Gathern had gone EIGHT DAYS (2026-09-03 to 2026-09-11) with no `ok=true` liveness run at all, so
-- under v3 any listing touched even once by an intervening quarantined run — and quarantined runs
-- ran repeatedly across that week — had already gone dark to this detector. This is the barrier of
-- record for ops_incident #168's exposure; a barrier that a quarantined run can blind is not a
-- barrier.
--
-- FIX: a later UNTRUSTED probe may no longer ERASE an earlier TRUSTED one. Split "is the listing
-- still dead" from "was death ever proven":
--   (a) LATEST PROBE, any trust level, must still read 404/410 — unchanged safety property: if the
--       most recent look (trusted or not) saw 200, or the raw crawl re-saw it in the feed, this is
--       an immediate resurrection signal and the listing is excluded, full stop. A blocked/quarantined
--       environment cannot manufacture a 200 (scrapers/common/liveness_trust.py's own reasoning for
--       why restorative writes are never gated), so an untrusted 200 is still honest evidence of life.
--   (b) SOME probe — the most recent one that specifically carries a trust anchor — must ALSO have
--       read 404/410. This is exactly v3's existing per-probe trust condition, just no longer forced
--       onto the single latest row.
-- Nothing about WHAT counts as "trusted" changed (same ok=true-within-6h anchor, same 90-day ceiling
-- on the anchor's own age). Nothing about the KILL/STRIKE pipeline changed — this function only ever
-- raises a read-only P1 alert; it does not write active/inactive and never has. ops_incident #180's
-- semantics question (whether a passed in-run canary alone may authorise the SWEEP to strike/kill
-- despite a low aggregate rate) is untouched and remains an owner decision — this fix does not touch
-- MIN_ALIVE_RATE_FOR_TRUST, the canary thresholds, or the anomaly cap.
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
      -- (a) the single most recent probe per listing, at ANY trust level — must still read dead.
      select distinct on (src, listing_id) src, tok, listing_id, http_status, run_at, last_seen_at, active
        from probes
       order by src, listing_id, run_at desc
    ), latest_trusted_dead as (
      -- (b) the most recent probe per listing that specifically carries a trust anchor AND read
      -- dead — unchanged from v3's per-row condition, just decoupled from being "the" latest row.
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
     where lp.http_status in (404, 410)          -- (a) most recent look, any trust level, still dead
       and lp.active
       and lp.last_seen_at <= lp.run_at           -- not re-seen in the platform feed since
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
