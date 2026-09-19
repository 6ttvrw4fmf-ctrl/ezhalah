-- WATCHES THE CLAIM MADE BY MIGRATION 20260919010944.
--
-- That repair deactivated six wasalt listings that were dead on wasalt.sa (HTTP 404 on BOTH the
-- /ar and /en routes) yet still active=true AND in search_listings_ar — clickable straight through
-- to a 404. The repair proves the invariant held for one instant. This detector is what proves it
-- still holds, which is the whole point of verify-repair-migrations-are-guarded.ts.
--
-- WHY THE EXISTING DETECTORS DID NOT CATCH THOSE SIX. mon_detect_served_after_source_confirmed_gone
-- and mon_detect_served_despite_direct_404 both key off the liveness ledger, and wasalt liveness had
-- produced no evidence for a month: it ran on the curl_cffi chrome124 + Saudi-proxy transport that
-- wasalt.sa has null-routed since 2026-08-17 (issue #1019), so every read was UNKNOWN, nothing was
-- ever written, and the detectors were dark. A detector that depends on a dead evidence source
-- reports 0 for the same reason there is a problem. So ARM A below reads the AR ENRICHER's evidence
-- instead, which is produced on the browser transport and is therefore independent of liveness.
create or replace function public.mon_detect_wasalt_dead_but_active()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  r        record;
  v_fresh  timestamptz;
begin
  -- BLINDNESS GUARD. Arm A is only meaningful while the AR enricher is actually running; if it has
  -- stalled, "no dead-but-active rows" means "no new evidence", not "all clear". Say so rather than
  -- returning a 0 that reads as health (AGENTS.md: a monitor that cannot see is not a clean bill).
  select max(finished_at) into v_fresh
    from public.scrape_runs
   where platform like 'wasalt_enrich_ar_%' and ok;

  if v_fresh is null or v_fresh < now() - interval '7 days' then
    live := live || 'wasalt_dead_but_active:BLIND';
    n := n + public.mon_raise('P1', 'wasalt_dead_but_active', 'wasalt',
      'wasalt_dead_but_active:BLIND',
      jsonb_build_object(
        'blind', true,
        'last_ok_enrich_run', v_fresh,
        'why', 'This detector finds wasalt listings the SOURCE has confirmed gone that are still '
            || 'active. Its evidence comes from the AR enricher''s direct fetches, and no '
            || 'successful enricher run has landed in 7 days — so a 0 here proves nothing.',
        'action', 'Fix the enricher first (.github/workflows/wasalt-enrich-ar.yml). Do NOT '
            || 'deactivate anything in response to this alert.'));
    perform public.mon_resolve_stale_keys('wasalt_dead_but_active', live);
    return n;
  end if;

  -- ARM A — the enricher fetched this listing's own URL on BOTH language routes, more than once,
  -- days apart (the retry pass enforces a 24h backoff), and neither route had a listing. That is
  -- DIRECT, REPEATED evidence of death. `_errn >= 2` is deliberate: one definitive miss can be a
  -- slug that drifted between capture and enrichment, which is the exact case the retry pass exists
  -- to recover, so a single marker is not yet a finding.
  for r in
    select t.tbl, count(*) as rows_affected,
           (array_agg(t.id order by t.id))[1:20] as sample_ids,
           min(t.ar_fetched_at) as oldest_evidence
      from (
        select 'wasalt_residential_listings'::text as tbl, id, ar_fetched_at
          from public.wasalt_residential_listings
         where active
           and ar_data->>'_err' in ('nodetail', '404', '410')
           and coalesce((ar_data->>'_errn')::int, 0) >= 2
        union all
        select 'wasalt_commercial_listings'::text, id, ar_fetched_at
          from public.wasalt_commercial_listings
         where active
           and ar_data->>'_err' in ('nodetail', '404', '410')
           and coalesce((ar_data->>'_errn')::int, 0) >= 2
      ) t
     group by t.tbl
  loop
    live := live || ('wasalt_dead_but_active:enricher:' || r.tbl);
    n := n + public.mon_raise('P1', 'wasalt_dead_but_active', 'wasalt',
      'wasalt_dead_but_active:enricher:' || r.tbl,
      jsonb_build_object(
        'arm', 'enricher_direct_evidence',
        'source_table', r.tbl,
        'rows', r.rows_affected,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'oldest_evidence', r.oldest_evidence,
        'why', 'These rows are active=true, but the AR enricher fetched each listing''s own URL on '
            || 'BOTH the /ar and /en routes at least twice, days apart, and wasalt answered with no '
            || 'listing each time. Six rows in exactly this state were found active AND searchable '
            || 'on 2026-09-19 and repaired by migration 20260919010944.',
        'likely_cause', 'wasalt liveness is not converting that evidence into strikes — either it '
            || 'is not running (wasalt-enum-liveness.yml) or its confirm step is failing.',
        'action', 'Check the enum-liveness run history first. Deactivate ONLY through the liveness '
            || 'contract (grace of 3 DIRECT dead verdicts); a hand repair needs the same '
            || 'evidence trail migration 20260919010944 wrote.'));
  end loop;

  -- ARM B — the liveness ledger itself reached grace and the row is still active. Independent of
  -- arm A, and the arm that would have fired had liveness ever been able to read the source.
  for r in
    select d.tbl, count(*) as rows_affected,
           (array_agg(d.listing_id order by d.listing_id))[1:20] as sample_ids
      from (
        select p.tbl, p.listing_id, count(*) as dead_verdicts
          from public.wasalt_liveness_pilot_detail p
         where p.get_verdict = 'dead'
         group by p.tbl, p.listing_id
        having count(*) >= 3
      ) d
     where exists (
       select 1 from public.wasalt_residential_listings w
        where d.tbl = 'wasalt_residential_listings' and w.id = d.listing_id and w.active)
        or exists (
       select 1 from public.wasalt_commercial_listings w
        where d.tbl = 'wasalt_commercial_listings' and w.id = d.listing_id and w.active)
     group by d.tbl
  loop
    live := live || ('wasalt_dead_but_active:ledger:' || r.tbl);
    n := n + public.mon_raise('P1', 'wasalt_dead_but_active', 'wasalt',
      'wasalt_dead_but_active:ledger:' || r.tbl,
      jsonb_build_object(
        'arm', 'liveness_ledger_grace_reached',
        'source_table', r.tbl,
        'rows', r.rows_affected,
        'sample_listing_ids', to_jsonb(r.sample_ids),
        'why', 'wasalt_liveness_pilot_detail holds 3+ DIRECT dead verdicts for these listings — the '
            || 'policy grace — and they are still active. The sweep reached a verdict and then did '
            || 'not act on it.',
        'action', 'Read the enum-liveness run log for a collapse-guard abort or a dry run before '
            || 'deactivating anything.'));
  end loop;

  perform public.mon_resolve_stale_keys('wasalt_dead_but_active', live);
  return n;
end;
$function$;
