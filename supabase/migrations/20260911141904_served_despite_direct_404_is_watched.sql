-- A listing may not be SERVED while our own DIRECT probe of its own URL says it is gone.
--
-- Found 2026-09-11 (routine #3 data integrity, ops_incident #168): the gathern liveness sweep
-- stopped writing on 2026-09-06 and 1,431 listings whose detail page returns 404 stayed
-- production_ready and searchable. A barrier DID notice the sweep had gone quiet
-- (rows_collapse/gathern_liveness, raised 09-08) but "the sweep is quiet" and "N dead listings are
-- being served" are DIFFERENT FACTS, and only the second one is what a user experiences. This
-- watches the second.
--
-- Three deliberate properties:
--   1. DEFINITIVE-DEAD ONLY. 404/410 count. 403/429/5xx/timeout/NULL never do — those are UNKNOWN,
--      and LISTING_LIVENESS.md says UNKNOWN never kills and must never be laundered into a verdict
--      by a monitor either.
--   2. RESURRECTION GUARD. A row re-seen by the crawl AFTER the probe (search_listings_ar.last_updated
--      > the probe's run_at) is excluded: the 404 is superseded and the listing is legitimately back.
--      Without this the detector would cry wolf on every genuine resurrection. It excluded 47 gathern
--      rows and all 3 wasalt rows on the day it was written.
--   3. PER-PLATFORM raise AND resolve, so ownership is legible and a fixed platform clears itself
--      instead of leaving a stale alert lit.
--
-- Coverage is every liveness-detail table that exists today. aqar/dealapp carry source_table;
-- gathern's table is residential-only by construction; wasalt's pilot table uses tbl/get_status.
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
  -- platforms currently lit, so a platform that has become clean can be resolved explicitly
  select coalesce(array_agg(distinct platform), '{}')
    into v_open
    from public.alert_event
   where kind = 'served_despite_direct_404' and resolved_at is null;

  for r in
    with g as (
      select distinct on (listing_id)
             'gathern_residential_listings'::text as src, listing_id, http_status, run_at
        from public.gathern_liveness_detail
       order by listing_id, run_at desc
    ), a as (
      select distinct on (source_table, listing_id)
             source_table as src, listing_id, http_status, run_at
        from public.aqar_liveness_detail
       order by source_table, listing_id, run_at desc
    ), d as (
      select distinct on (source_table, listing_id)
             source_table as src, listing_id, http_status, run_at
        from public.dealapp_liveness_detail
       order by source_table, listing_id, run_at desc
    ), w as (
      select distinct on (tbl, listing_id)
             tbl as src, listing_id, get_status as http_status, run_at
        from public.wasalt_liveness_pilot_detail
       order by tbl, listing_id, run_at desc
    ), probes as (
      select * from g
      union all select * from a
      union all select * from d
      union all select * from w
    )
    select p.src,
           count(*) as cnt,
           min(p.run_at) as oldest_probe,
           max(p.run_at) as newest_probe
      from probes p
      join public.search_listings_ar s
        on s.source_table = p.src
       and s.listing_id   = p.listing_id
       and s.production_ready
     where p.http_status in (404, 410)   -- definitive dead only; never 403/429/5xx/timeout/NULL
       and s.last_updated <= p.run_at    -- resurrection guard: not re-seen since the probe
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
        'why', 'these listings are production_ready and returned to users, but the most recent DIRECT '
            || 'fetch of each listing''s own URL returned 404/410 and the row has not been re-seen since. '
            || 'We are advertising listings our own evidence says are gone.',
        'adjudicate', 'This is normally a RETIREMENT PATH that stopped, not bad data: check that the '
            || 'platform''s liveness sweep is still running and still applying. Do NOT bulk-flip active=false '
            || 'to clear this alert — LISTING_LIVENESS.md requires a DIRECT fetch at full grace, and the '
            || 'sweeps carry anomaly caps that will (correctly) quarantine a large kill batch. Restore the '
            || 'sweep and let its own strike logic retire them. If the 404s are instead a broken URL scheme, '
            || 'the fix is the scraper, and nothing may be inactivated at all.'
      ));
    v_open := array_remove(v_open, r.src);
  end loop;

  -- any platform still listed was lit and is now clean
  if v_open is not null then
    foreach r.src in array v_open loop
      perform public.mon_resolve('served_despite_direct_404', r.src);
    end loop;
  end if;

  return n;
end $function$;

comment on function public.mon_detect_served_despite_direct_404() is
  'P1. Raises when a production_ready listing''s latest DIRECT liveness probe was 404/410 and it has not '
  'been re-seen since. Definitive-dead statuses only (never 403/429/5xx/timeout). Added 2026-09-11 for '
  'ops_incident #168 (gathern sweep stopped 09-06, 1,431 dead rows still served). Scheduled as pg_cron '
  'job mon-served-despite-direct-404 at ''32 */6 * * *''.';
