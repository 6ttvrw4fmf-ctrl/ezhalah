-- served_despite_direct_404 asked for a 404, and aqar does not speak 404.
--
-- This detector is, in ops_incident #188's words, "the ONLY thing watching whether source-confirmed-
-- dead listings are being served to users". Its dead test was `http_status in (404, 410)`, in both
-- the latest_trusted_dead CTE and the final WHERE.
--
-- aqar's dead shape is an HTTP **200** carrying a «مغلق» badge and no offers node. That is not an
-- edge case: docs/ops/LISTING_LIVENESS.md §0 opens on it, and records that ~14.8% of aqar's active
-- population reported healthy forever because of exactly this shape. Measured 2026-09-13, on the
-- first run after the ledger gained a writer (ops_incident #214, PR #2390):
--
--     select verdict, count(*) filter (where http_status in (404,410)) is_404, count(*)
--       from aqar_liveness_detail group by 1;
--     kill     is_404 = 0   n = 905
--     strike   is_404 = 0   n = 898
--
-- Not one of 1,803 rows could ever match, including all 905 kills. Filling the ledger fixed the
-- dark-evidence half and revealed a second blind spot sitting behind it, on the platform with
-- 90,906 active rows — and the newly non-empty table made the arm READ as covered.
--
-- THE FIX: ASK THE LEDGER WHAT IT DECIDED, NOT WHAT THE WIRE SAID. Each arm now emits a
-- `ledger_dead` boolean in ITS OWN vocabulary, and the shared test is `http_status in (404,410) OR
-- ledger_dead`. Vocabulary stays per-arm on purpose: a platform's word for "confirmed dead" is a
-- fact about that platform, and a new one declares its own rather than inheriting a guess.
--
--     gathern   verdict in ('kill','dead_confirmed')
--     wasalt    get_verdict = 'dead'
--     aqar      verdict = 'kill'
--     dealapp   verdict = 'kill'
--
-- THIS IS ADDITIVE, AND FOR TWO PLATFORMS IT IS A PROVEN NO-OP. Measured over every ledger row:
-- gathern's kill/dead_confirmed/strike rows are 404 at 2530/2530, 3848/3848 and 14977/14977;
-- wasalt's 'dead' rows are 404 at 16677/16677. For those two the new limb is a subset of the old
-- one and the arm cannot change behaviour. Only aqar and dealapp gain anything, which is the whole
-- point. Nothing is narrowed and no threshold moves — LISTING_LIVENESS.md §7.
--
-- IT ALSO ANSWERS THE GRACE QUESTION PR #2390 LEFT OPEN, in the safe direction. That PR noted the
-- 404-keyed arm has no grace filter, so a row struck 1-of-3 counts as confirmed dead. A `kill`
-- verdict IS full grace by construction — the runner only writes it when it retires the row — so
-- the aqar and dealapp arms are strictly better behaved than a status-keyed version would have
-- been. gathern's status limb is deliberately left ALONE: narrowing it would risk silencing the
-- live 1,061-row exposure on alert_event 2428, and a detector is never narrowed to quiet it.
--
-- PROVEN REACHABLE BEFORE APPLYING, because an empty result from a predicate nobody has seen return
-- rows is indistinguishable from a broken one. The aqar funnel, run by hand 2026-09-13:
--
--     A  probe rows reaching the arm .................... 1803
--     B  ledger_dead ................................... 905     (0 under the old test)
--     C  survive the 6h trusted-run gate ............... 905
--     D  are the row's LATEST probe .................... 905
--     E  ...and the row is STILL ACTIVE ................   0   <- the assertion
--     F  ...and not re-seen by a crawl since ...........   0
--     G  ...and served in search_listings_ar ...........   0
--
-- Every limb passes traffic; the arm ends at E because aqar has no leak, not because it cannot see.
-- Under the old test it ended at B. That is the whole difference between a green arm and a dark one.
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
      select 'dealapp_residential_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, (d.verdict = 'kill'),
             d.run_at, r0.last_seen_at, r0.active
        from public.dealapp_liveness_detail d
        join public.dealapp_residential_listings r0 on r0.id = d.listing_id
       where d.source_table = 'dealapp_residential_listings'
    ), dc as (
      select 'dealapp_commercial_listings'::text, 'dealapp'::text,
             d.listing_id, d.http_status, (d.verdict = 'kill'),
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
            || 'serves an identical shell for any id) — the crawl has not seen it in the platform''s '
            || 'feed since, and no later probe has contradicted that reading. A later UNTRUSTED '
            || 're-probe that still reads dead no longer erases the earlier trusted confirmation '
            || '(ops_incident #188) — but any 200, trusted or not, still clears a listing '
            || 'immediately, since a blocked environment cannot manufacture a live page.',
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
