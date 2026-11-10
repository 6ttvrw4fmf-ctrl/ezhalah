-- served_despite_direct_404 v7 — A ROW STILL INSIDE ITS STRIKE GRACE IS NOT A STUCK DEATH
-- (lane: alarms dead-ads-served, 2026-11-10; alert_event 12977, open since 2026-11-04).
--
-- WHAT WAS MEASURED. The gathern arm had been open for six days. On 2026-11-10 03:40 UTC it held 72
-- served rows; every one read 404 for the FIRST time in the 00:38 sweep (verdict 'strike',
-- missing_count 1-2 of 3) and every one had been seen and verified alive on 2026-11-09. Followed
-- backwards, the rows of earlier days went the same way: struck, re-read about every 6 hours, and
-- killed at the third strike roughly 13 hours later (id 1816396: strike 11-05 23:04, strike 11-06
-- 04:42, kill 11-06 11:38). The chain source-removes, detect, direct re-read, deactivate was
-- completing every day; the alert stayed open because a NEW cohort entered its grace window every
-- day. The detector's own text already said so: «by_http_status rows carry no grace filter ... a
-- row there may be at 1-2 of 3 and has NOT earned a kill» (LISTING_LIVENESS.md: only a direct
-- read AT FULL GRACE kills, and gathern expresses a block as 404). A P1 that is always open
-- cannot say when the chain really stops.
--
-- THE RULE. Every flagged row now gets `dead_since`: the first reading of its current unbroken run
-- of dead readings. Only a live reading (a 200 the ledger did not call dead) or a re-sighting by
-- the crawl resets it; an unreadable probe resets nothing. ops_direct_dead_class() then says:
--   overdue  : the ledger reached a kill and the row is still served (unchanged from v6, no
--              waiting), OR the row has read dead for more than 24 hours with nothing live in
--              between (the tightest SLA in ops_liveness_registry; three strikes take ~13 h).
--   in_grace : first read dead under 24 hours ago, no kill yet.
-- The alert raises when ANY row is overdue, for every platform this detector reads (gathern,
-- wasalt, aqar, dealapp). in_grace rows are still counted in the detail. Nothing else moves: the
-- row set, the trusted-run anchor, the dealapp applied-kill gate and the 48-hour resolve gate are
-- the same as v6. This is not a threshold raise: a stuck row raises exactly as before, and a
-- sweep that stops re-reading turns every in_grace row overdue within a day.

create or replace function public.ops_direct_dead_class(
  p_ledger_dead boolean, p_dead_since timestamptz, p_now timestamptz)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_ledger_dead is true then 'overdue'
    when p_dead_since is null then 'overdue'
    when p_dead_since <= p_now - interval '24 hours' then 'overdue'
    else 'in_grace'
  end
$function$;

revoke all on function public.ops_direct_dead_class(boolean, timestamptz, timestamptz) from public, anon, authenticated;

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
    ), flagged as (
      -- exactly the v6 row set, one row per served listing whose latest direct reading is dead
      select lp.src, lp.listing_id, lp.http_status, lp.ledger_dead, lp.run_at, lp.last_seen_at,
             ltd.trusted_run_at
        from latest_probe lp
        join latest_trusted_dead ltd on ltd.src = lp.src and ltd.listing_id = lp.listing_id
        join public.search_listings_ar s
          on s.source_table = lp.src and s.listing_id = lp.listing_id and s.production_ready
       where (lp.http_status in (404, 410) or lp.ledger_dead)
         and lp.active
         and lp.last_seen_at <= lp.run_at
    ), last_alive as (
      -- v7: the newest LIVE reading of each flagged row: a 200 the ledger did not call dead.
      select f.src, f.listing_id, max(a.run_at) as alive_at
        from flagged f
        join probes a on a.src = f.src and a.listing_id = f.listing_id
       where a.http_status = 200 and a.ledger_dead is not true
       group by f.src, f.listing_id
    ), streak as (
      -- v7: WHEN did the current unbroken run of dead readings begin? Only a live reading or the
      -- crawl seeing the ad again resets it. An unreadable probe in between (403, timeout, null)
      -- resets nothing, so it cannot hide a stuck row.
      select f.src, f.listing_id, min(q.run_at) as dead_since
        from flagged f
        join probes q on q.src = f.src and q.listing_id = f.listing_id
        left join last_alive la on la.src = f.src and la.listing_id = f.listing_id
       where (q.http_status in (404, 410) or q.ledger_dead is true)
         and q.run_at >= f.last_seen_at
         and (la.alive_at is null or q.run_at > la.alive_at)
       group by f.src, f.listing_id
    )
    select f.src,
           count(*) as cnt,
           count(*) filter (where f.http_status in (404, 410)) as by_http_status,
           count(*) filter (where f.ledger_dead)               as by_ledger_verdict,
           count(*) filter (where public.ops_direct_dead_class(f.ledger_dead, st.dead_since, now()) = 'overdue')  as overdue,
           count(*) filter (where public.ops_direct_dead_class(f.ledger_dead, st.dead_since, now()) = 'in_grace') as in_grace,
           min(st.dead_since) as oldest_dead_since,
           min(f.trusted_run_at) as oldest_trusted_confirm,
           max(f.run_at) as newest_probe
      from flagged f
      left join streak st on st.src = f.src and st.listing_id = f.listing_id
     group by f.src
    having count(*) filter (where public.ops_direct_dead_class(f.ledger_dead, st.dead_since, now()) = 'overdue') > 0
  loop
    n := n + public.mon_raise(
      'P1', 'served_despite_direct_404', r.src,
      'served_despite_direct_404:' || r.src,
      jsonb_build_object(
        'count', r.cnt,
        'source_table', r.src,
        'by_http_status', r.by_http_status,
        'by_ledger_verdict', r.by_ledger_verdict,
        'overdue', r.overdue,
        'in_grace', r.in_grace,
        'oldest_dead_since', r.oldest_dead_since,
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
        'read_the_split', 'overdue = rows that RAISE this alert: the ledger reached a kill and the row is '
            || 'still served, or the row has read dead on its own URL, with no live reading and no '
            || 're-sighting in between, for more than 24 hours. The sweep should have re-read it '
            || 'to full grace and retired it by now, so the chain is stuck. in_grace = rows first '
            || 'read dead less than 24 hours ago that have not reached a kill: they are at 1-2 of 3 '
            || 'strikes, the sweep is still re-reading them, and they have NOT earned a kill. They '
            || 'are counted here so they stay visible, but in_grace rows alone do not raise (v7).',
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


-- APPLY-TIME SELF-TEST: the classifier EXECUTED on both sides of every edge, and the v6 shape kept.
do $$
declare src text; n int;
begin
  if public.ops_direct_dead_class(false, now() - interval '23 hours', now()) <> 'in_grace' then
    raise exception 'v7 self-test: a row first read dead 23h ago must be in_grace';
  end if;
  if public.ops_direct_dead_class(false, now() - interval '25 hours', now()) <> 'overdue' then
    raise exception 'v7 self-test: a row dead for 25h must be overdue';
  end if;
  if public.ops_direct_dead_class(true, now() - interval '1 minute', now()) <> 'overdue' then
    raise exception 'v7 self-test: a ledger kill that is still served must be overdue at once';
  end if;
  if public.ops_direct_dead_class(false, null, now()) <> 'overdue' then
    raise exception 'v7 self-test: an unknown streak start must fail closed to overdue';
  end if;
  src := pg_get_functiondef('public.mon_detect_served_despite_direct_404'::regproc);
  n := (select count(*) from regexp_matches(src, 'd\.verdict = ''kill'' and d\.applied is true', 'g'));
  if n <> 2 then
    raise exception 'v7 self-test: expected 2 dealapp limbs gated on d.applied, found %', n;
  end if;
  if position('having count(*) filter (where public.ops_direct_dead_class(' in src) = 0 then
    raise exception 'v7 self-test: the raise must be gated on an overdue row';
  end if;
  if position('where a.http_status = 200 and a.ledger_dead is not true' in src) = 0 then
    raise exception 'v7 self-test: only a live reading may reset the dead streak';
  end if;
end $$;

-- Re-evaluate now.
select public.mon_detect_served_despite_direct_404();
