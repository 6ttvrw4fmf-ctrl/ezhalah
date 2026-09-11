-- served_despite_direct_404 v5: the resolve limb may only clear a platform it could SEE.
--
-- v4 (20260911203303) fixed the raise side: a later UNTRUSTED 404 no longer erases an earlier
-- trusted confirmation. This fixes the other half of ops_incident #188: the resolve limb still
-- auto-resolved every open platform the raise loop did not re-raise — including platforms the
-- loop could not re-raise because their observation channel was dark. The observed 2026-09-11
-- timeline: every gathern liveness run since 09-06 finished ok=false (quarantined), so the raise
-- loop had no trusted gathern group, gathern stayed in v_open, and mon_resolve closed alert 2381
-- at 14:52:54 while ~1,456 rows still matched the ungated predicate. Absence of trusted evidence
-- was treated as evidence of absence — the exact inversion SOURCE-IS-TRUTH forbids (silent →
-- UNKNOWN, never unknown → CLEAR).
--
-- The gate: resolve 'served_despite_direct_404:<src>' only when <src>'s platform has at least one
-- ok=true liveness run inside the last 48 hours (double the daily sweep cadence — one missed run
-- never flips an alert). A platform with an open alert and no trusted run keeps the alert; the
-- stuck-open/last_affirmed_at watchers are the escalation path, never auto-resolve.
--
-- Everything above the resolve limb is byte-identical to the live v4 body (pulled via
-- pg_get_functiondef immediately before this migration — never rebuilt from an older copy, per
-- the rpc-full-body-replace revert hazard).

CREATE OR REPLACE FUNCTION public.mon_detect_served_despite_direct_404()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- RESOLVE ONLY WHAT WAS OBSERVED (v5, ops_incident #188 second half). A platform still in
  -- v_open was not re-raised — either its condition cleared, OR its observation channel was dark
  -- (no trusted liveness run, so the raise loop had no group for it and could not re-raise even
  -- a persisting condition). Only the first may resolve. The bar: at least one ok=true liveness
  -- run for the platform inside the last 48 hours (double the daily cadence). Without it the
  -- alert stays open and ages via last_affirmed_at, which the stuck-open watchers escalate.
  if v_open is not null then
    foreach r.src in array v_open loop
      if exists (select 1
                   from public.scrape_runs sr
                  where sr.platform like split_part(r.src, '_', 1) || '\_liveness%'
                    and sr.ok is true
                    and sr.started_at > now() - interval '48 hours') then
        perform public.mon_resolve('served_despite_direct_404', r.src);
      end if;
    end loop;
  end if;

  return n;
end $function$;

-- Self-test: the resolve call must sit inside the observability gate, and the naive unguarded
-- resolve loop must be gone. Asserts on the LIVE compiled body (never a comment).
do $$
declare
  body text := pg_get_functiondef('public.mon_detect_served_despite_direct_404()'::regprocedure);
begin
  if body !~ 'if exists \(select 1\s+from public\.scrape_runs sr\s+where sr\.platform like split_part\(r\.src' then
    raise exception 'v5 self-test: the resolve limb lost its observability gate';
  end if;
  if body ~ 'foreach r\.src in array v_open loop\s+perform public\.mon_resolve' then
    raise exception 'v5 self-test: the naive unguarded resolve loop is still present';
  end if;
end $$;