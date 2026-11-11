-- served_despite_direct_404 v6 — A KILL THE TRUST GATE HELD BACK IS NOT A CONFIRMATION
-- (lane: dealapp + adjudication, 2026-11-09; alert_event 13977 / 13978).
--
-- WHAT WAS MEASURED. Both dealapp arms raised at 06:32 UTC with oldest_trusted_confirm =
-- 2026-11-09 05:43:07 — the start of dealapp_liveness shard 3/4, a run that finished ok=true in
-- 12 minutes reading alive=54 dead=32 unknown=514 and wrote «QUARANTINED: verified-rate or canary
-- failed, no deactivation written». Its 26 'kill' verdicts (22 residential + 4 commercial) landed in
-- dealapp_liveness_detail with applied=false — scrapers/dealapp/liveness_run.py writes the ledger
-- AFTER the trust gate on purpose, so `applied` records what reached the row. The detector read
-- verdict='kill' as "a TRUSTED direct probe confirmed it gone" and the run's ok=true as trust.
-- Both halves were wrong for that row: the sweep itself had judged its own environment untrustworthy
-- and deliberately kept the rows alive (LISTING_LIVENESS.md: UNKNOWN never deactivates). The same
-- rows were then re-probed by trusted runs inside the hour and killed for real (all 26 carry a later
-- applied=true kill and are inactive now) — the chain verdict → kill → sync worked; the alert fired
-- in the window where the ONLY dead reading was one the sweep had refused to act on.
--
-- THE RULE. For dealapp — the one platform whose ledger carries `applied` — a 'kill' is a confirmed
-- death only when the sweep applied it (`d.applied is true`). An unapplied kill is the sweep saying
-- UNKNOWN out loud, and this detector must not promote it to a verdict. Nothing else moves: the
-- aqar/gathern/wasalt arms keep their vocabulary, the trusted-run anchor keeps its 6-hour window,
-- the resolve branch keeps its 48-hour gate, and an APPLIED kill that is active again with no later
-- re-sighting (last_seen_at <= run_at) still raises exactly as before — that is the real chain
-- failure this detector exists for.

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
      -- gathern speaks 404; the verdict limb is a proven subset (2530/2530 + 3848/3848 are 404).
      select 'gathern_residential_listings'::text src, 'gathern'::text tok,
             d.listing_id, d.http_status,
             (d.verdict in ('kill','dead_confirmed')) as ledger_dead,
             d.run_at, r0.last_seen_at, r0.active
        from public.gathern_liveness_detail d
        join public.gathern_residential_listings r0 on r0.id = d.listing_id
    ), wr as (
      -- wasalt's ledger says 'dead'; 16677/16677 of those are 404, so this too is a no-op.
      select 'wasalt_residential_listings'::text, 'wasalt'::text,
             d.listing_id, d.get_status, (d.get_verdict = 'dead'),
             d.run_at, r0.last_seen_at, r0.active
        from public.wasalt_liveness_pilot_detail d
        join public.wasalt_residential_listings r0 on r0.id = d.listing_id
       where d.tbl = 'wasalt_residential_listings'
    ), wc as (
      select 'wasalt_commercial_listings'::text, 'wasalt'::text,
             d.listing_id, d.get_status, (d.get_verdict = 'dead'),
             d.run_at, r0.last_seen_at, r0.active
        from public.wasalt_liveness_pilot_detail d
        join public.wasalt_commercial_listings r0 on r0.id = d.listing_id
       where d.tbl = 'wasalt_commercial_listings'
    ), ar as (
      -- aqar NEVER returns 404: its dead shape is a 200 with a «مغلق» badge. Without this limb the
      -- arm cannot fire at all, which it could not from 2026-08-31 to 2026-09-13.
      select 'aqar_residential_listings'::text, 'aqar'::text,
             d.listing_id, d.http_status, (d.verdict = 'kill'),
             d.run_at, r0.last_seen_at, r0.active
        from public.aqar_liveness_detail d
        join public.aqar_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'aqar_residential_listings'
    ), ac as (
      select 'aqar_commercial_listings'::text, 'aqar'::text,
             d.listing_id, d.http_status, (d.verdict = 'kill'),
             d.run_at, r0.last_seen_at, r0.active
        from public.aqar_liveness_detail d
        join public.aqar_commercial_listings r0 on r0.id = d.listing_id
       where d.source_table = 'aqar_commercial_listings'
    ), dr as (
      -- dealapp serves an identical shell for a real id and a bogus one, so it has no 404 either.
      -- v6: a 'kill' the sweep did NOT apply (quarantined run, held-alive row, dry run) is the
      -- sweep's own UNKNOWN — liveness_run.py writes `applied` after its trust gate for exactly
      -- this reading. Only an applied kill is a confirmed death here.
      select 'dealapp_residential_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, (d.verdict = 'kill' and d.applied is true),
             d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_residential_listings'
    ), dc as (
      select 'dealapp_commercial_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, (d.verdict = 'kill' and d.applied is true),
             d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_commercial_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_commercial_listings'
    ), probes(src, tok, listing_id, http_status, ledger_dead, run_at, last_seen_at, active) as (
      select * from g  union all select * from wr union all select * from wc
      union all select * from ar union all select * from ac
      union all select * from dr union all select * from dc
    ), latest_probe as (
      select distinct on (src, listing_id)
             src, tok, listing_id, http_status, ledger_dead, run_at, last_seen_at, active
        from probes
       order by src, listing_id, run_at desc
    ), latest_trusted_dead as (
      select distinct on (p.src, p.listing_id) p.src, p.listing_id, p.run_at as trusted_run_at
        from probes p
       where (p.http_status in (404, 410) or p.ledger_dead)
         and exists (
               select 1 from trusted_runs tr
                where tr.tok = p.tok
                  and tr.started_at <= p.run_at
                  and tr.started_at >  p.run_at - interval '6 hours')
       order by p.src, p.listing_id, p.run_at desc
    )
    select lp.src,
           count(*) as cnt,
           count(*) filter (where lp.http_status in (404, 410)) as by_http_status,
           count(*) filter (where lp.ledger_dead)               as by_ledger_verdict,
           min(ltd.trusted_run_at) as oldest_trusted_confirm,
           max(lp.run_at) as newest_probe
      from latest_probe lp
      join latest_trusted_dead ltd on ltd.src = lp.src and ltd.listing_id = lp.listing_id
      join public.search_listings_ar s
        on s.source_table = lp.src and s.listing_id = lp.listing_id and s.production_ready
     where (lp.http_status in (404, 410) or lp.ledger_dead)
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
        'by_http_status', r.by_http_status,
        'by_ledger_verdict', r.by_ledger_verdict,
        'oldest_trusted_confirm', r.oldest_trusted_confirm,
        'newest_probe', r.newest_probe,
        'why', 'these listings are production_ready and returned to users. A TRUSTED direct probe of '
            || 'each listing''s own URL confirmed it gone at some point — either an HTTP 404/410, or '
            || 'the platform''s own liveness ledger recording a confirmed-dead verdict for a source '
            || 'whose death is NOT an HTTP status (aqar answers 200 with a «مغلق» badge; dealapp '
            || 'serves an identical shell for any id, and only a kill the sweep APPLIED counts — an '
            || 'unapplied kill is the sweep''s own UNKNOWN, v6) — the crawl has not seen it in the '
            || 'platform''s feed since, and no later probe has contradicted that reading. A later '
            || 'UNTRUSTED re-probe that still reads dead no longer erases the earlier trusted '
            || 'confirmation (ops_incident #188) — but any 200, trusted or not, still clears a '
            || 'listing immediately, since a blocked environment cannot manufacture a live page.',
        'read_the_split', 'by_ledger_verdict rows reached a KILL decision, which is full strike '
            || 'grace by construction. by_http_status rows are keyed on the wire status alone and '
            || 'carry no grace filter, so on a platform that 404s while merely struck (gathern) a '
            || 'row there may be at 1-2 of 3 and has NOT earned a kill.',
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
end
$function$;

-- APPLY-TIME SELF-TEST on the LIVE compiled body (v5 precedent): both dealapp limbs require the
-- applied kill, nothing else changed shape.
do $$
declare src text; n_applied int; n_dead_tests int;
begin
  src := pg_get_functiondef('public.mon_detect_served_despite_direct_404'::regproc);
  n_applied := (select count(*) from regexp_matches(src, 'd\.verdict = ''kill'' and d\.applied is true', 'g'));
  if n_applied <> 2 then
    raise exception 'v6 self-test: expected 2 dealapp limbs gated on d.applied, found %', n_applied;
  end if;
  n_dead_tests := (select count(*) from regexp_matches(src, '\(lp\.http_status in \(404, 410\) or lp\.ledger_dead\)|\(p\.http_status in \(404, 410\) or p\.ledger_dead\)', 'g'));
  if n_dead_tests <> 2 then
    raise exception 'v6 self-test: the two ledger-aware dead tests must survive, found %', n_dead_tests;
  end if;
  if position($a$(d.verdict = 'kill'),$a$ in src) = 0 then
    raise exception 'v6 self-test: the aqar limbs must keep their unconditional kill vocabulary';
  end if;
end $$;

-- Re-evaluate now: an open dealapp alert whose only dead reading was an unapplied kill resolves on
-- this sweep through the v5 48-hour gate (dealapp_liveness runs ok=true hourly); a real one re-raises.
select public.mon_detect_served_despite_direct_404();
