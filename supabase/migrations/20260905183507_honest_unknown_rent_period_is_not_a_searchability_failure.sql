-- OWNER RULE (2026-09-05): keep the strict period behaviour. If the source does not truthfully
-- establish the rent period, rent_period stays NULL. A NULL/UNKNOWN-period rental MAY remain
-- searchable when the user applies no period filter, but it must NOT appear under شهري, سنوي or
-- كلاهما. No fallback, and no inferring the period from price, description tokens or neighbours.
--
-- THEREFORE an honest UNKNOWN excluded from the strict chips is CORRECT BEHAVIOUR, and a detector
-- that counts it as a searchability failure is measuring the product rule as if it were a bug.
--
-- THE DEFECT. mon_searchability_now.pct_period_searchable divided
--     rows reachable under a period chip
--   by
--     ALL rent apartments held (minus rows individually registered in
--     ops_rent_period_source_limited, a table that has 0 rows and never had any)
-- so every honest UNKNOWN sat in the denominator and dragged the ratio down. When the owner retired
-- the سنوي fallback on 2026-09-03 (migration 20260903175817), rows the fallback had been filling
-- reverted to their truthful NULL and seven platforms went ~100% -> 0% overnight: raghdan 0/72,
-- eaqartabuk 4/85, alkhaas 0/10, mizlaj 0/5, hajer 0/3, jurash 0/1, sadin 0/1. Seven P1
-- SEARCHABILITY_COLLAPSE alerts, every one describing the product rule working correctly.
--
-- Worse than noise: mon_raise() dedups on an open key, so while those seven sat open the detector
-- could not raise a REAL collapse on those platforms at all (§23a/§25a).
--
-- THE FIX IS THE DENOMINATOR, AND IT IS ERA-PROOF BY CONSTRUCTION. The question becomes
--   "of the listings whose period the source DID establish, how many are actually reachable?"
-- An UNKNOWN row now leaves the numerator AND the denominator together, so it cannot move the
-- metric in either direction - no future product decision about UNKNOWN handling can make this
-- detector lie again. Verified against the live 14-day history recomputed on the new denominator:
-- every platform's baseline matches its current value (aqar 100->100, gathern 100->100, wasalt
-- 100->99.9, eastabha 96.2->97.1, abeea 87.1->87.1, erapulse 66.7->66.7) and the seven
-- honest-UNKNOWN platforms read NULL (nothing to measure) instead of 0%.
--
-- WHAT IS NOT GIVEN UP. Dropping UNKNOWN from the denominator would blind a statistical detector to
-- a parser that STARTS losing periods. That protection is not removed, it is moved somewhere a
-- product change cannot fool it: mon_detect_source_proven_period_unreachable() below fires on
-- EVIDENCE (a recorded live source probe proving the source publishes a period, against a row we
-- serve as NULL), never on a ratio. Honest UNKNOWN has no such probe and can never trip it.
--
-- New columns are APPENDED (CREATE OR REPLACE VIEW cannot reposition columns) and
-- mon_snapshot_searchability() selects by name, so the daily history writer is unaffected.

create or replace view public.mon_searchability_now as
 select s.platform,
    count(*) as held,
    count(*) filter (where s.rent_period_ar = 'سنوي' and s.production_ready) as searchable_annual,
    round(100.0 * count(*) filter (where s.rent_period_ar = 'سنوي' and s.production_ready)::numeric
          / nullif(count(*), 0)::numeric, 1) as pct_annual_searchable,
    count(*) filter (where s.rent_period_ar = 'شهري') as monthly_by_source,
    count(*) filter (where s.rent_period_ar is null) as period_unknown,
    count(*) filter (where s.rent_period_ar is null and s.price_annual is null and s.price_total is null)
      as correctly_withheld_no_source_data,
    count(*) filter (where s.rent_period_ar is null and (s.price_annual is not null or s.price_total is not null))
      as suspect_price_without_period,
    count(*) filter (where not s.production_ready) as blocked_not_production_ready,
    count(*) filter (where s.last_updated > (now() - '48:00:00'::interval)) as new_last_48h,
    count(*) filter (where (s.rent_period_ar = any (array['سنوي','شهري'])) and s.production_ready)
      as searchable_by_period,
    -- THE FIX: denominator is the source-established cohort, not "everything held". NULL when the
    -- platform has no source-established period at all - nothing to measure is not a failure.
    round(100.0 * count(*) filter (where (s.rent_period_ar = any (array['سنوي','شهري'])) and s.production_ready)::numeric
          / nullif(count(*) filter (where s.rent_period_ar = any (array['سنوي','شهري'])), 0)::numeric, 1)
      as pct_period_searchable,
    (s.platform in (select ops_rent_period_sourceless.platform from ops_rent_period_sourceless)) as period_waived,
    -- Vestigial: this per-listing list existed only to hand-remove honest UNKNOWNs from the OLD
    -- denominator. It has always been empty and the new denominator makes it unnecessary.
    count(*) filter (where sl.listing_id is not null) as source_limited_excluded,
    -- Appended (see header): the only rows this detector may judge.
    count(*) filter (where s.rent_period_ar = any (array['سنوي','شهري'])) as period_known
   from search_listings_ar s
     left join ops_rent_period_source_limited sl
       on sl.source_table = s.source_table and sl.listing_id = s.listing_id
  where s.deal_ar = 'إيجار' and s.type_ar = 'شقة'
  group by s.platform;

create or replace view public.mon_searchability_alerts as
 with now_ as (select * from mon_searchability_now),
      base as (
       select h.platform,
          -- Baseline recomputed on the SAME denominator as the live figure. (held - period_unknown)
          -- is the historical period_known; comparing a new-definition figure against an
          -- old-definition baseline is how a metric change becomes a fleet of false alerts.
          percentile_cont(0.5) within group (
            order by ((100.0 * h.searchable_by_period::numeric
                       / nullif(h.held - h.period_unknown, 0)::numeric)::double precision)
          )::numeric as baseline_pct,
          percentile_cont(0.5) within group (order by (h.held::double precision))::numeric as baseline_held,
          count(*) as samples
         from mon_searchability_history h
        where h.captured_at > (now() - '14 days'::interval)
          and h.captured_at < date_trunc('day', now())
        group by h.platform)
 select n.platform,
    n.held,
    n.searchable_by_period,
    n.pct_period_searchable,
    round(b.baseline_pct, 1) as baseline_pct,
    round(b.baseline_held, 0) as baseline_held,
    coalesce(b.samples, 0::bigint) as baseline_samples,
    n.period_waived,
    n.suspect_price_without_period,
    n.correctly_withheld_no_source_data,
    n.blocked_not_production_ready,
    case
        -- Nothing to measure: no listing here has a source-established period. Named as its own
        -- verdict rather than falling through, so a reader can tell "correct by the product rule"
        -- from "checked and fine". Both are non-alerting; only one is informative.
        when n.pct_period_searchable is null then 'OK_NO_SOURCE_ESTABLISHED_PERIOD'
        when not n.period_waived and coalesce(b.samples, 0::bigint) >= 3 and b.baseline_pct >= 50
             and n.pct_period_searchable < (b.baseline_pct * 0.5) then 'SEARCHABILITY_COLLAPSE'
        when not n.period_waived and coalesce(b.samples, 0::bigint) >= 3 and b.baseline_pct >= 50
             and n.pct_period_searchable < (b.baseline_pct - 15) then 'SEARCHABILITY_DROP'
        when coalesce(b.samples, 0::bigint) >= 3 and n.held >= 20
             and n.held::numeric > (b.baseline_held * 1.20)
             and n.searchable_by_period::numeric <= b.baseline_held then 'NEW_ROWS_STUCK_BEFORE_SEARCH'
        when n.held >= 20 and n.blocked_not_production_ready::numeric >= (n.held::numeric * 0.20)
             then 'PRODUCTION_READY_FELL'
        else 'OK'
    end as verdict,
    n.period_known,
    n.period_unknown
   from now_ n left join base b on b.platform = n.platform;

-- ── The protection the denominator change gives up, restored on EVIDENCE instead of a ratio ──────
--
-- The owner's sentence: alert only when a listing with a known / source-proven applicable period is
-- unexpectedly unreachable. That is exactly this predicate, and it needs no baseline and no guess:
-- a row for which ops_rent_period_source_probe records a LIVE observation that the source publishes
-- a period, while search_listings_ar serves it with rent_period_ar NULL - so the user who picks that
-- very period cannot find it.
--
-- Mirror image of mon_detect_rent_period_contradicts_probe(), which catches us INVENTING a period
-- the source does not publish. Together they pin both directions of PERIOD = SOURCE.
create or replace function public.mon_detect_source_proven_period_unreachable()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}';
begin
  for rec in
    select p.source_table, p.listing_id, s.platform, p.observed_subtype, p.probed_at, p.method,
           s.production_ready
      from ops_rent_period_source_probe p
      join search_listings_ar s
        on s.source_table = p.source_table and s.listing_id = p.listing_id
     where p.observed_subtype in ('سنوي','شهري','annual','monthly')
       and s.rent_period_ar is null
       and s.deal_ar = 'إيجار'
     order by p.source_table, p.listing_id
     limit 200
  loop
    live_keys := live_keys
      || ('source_proven_period_unreachable:' || rec.source_table || ':' || rec.listing_id::text);
    n := n + public.mon_raise('P1', 'source_proven_period_unreachable', rec.platform,
      'source_proven_period_unreachable:' || rec.source_table || ':' || rec.listing_id::text,
      jsonb_build_object(
        'why', 'A recorded LIVE probe of this listing''s own source observed the period '
             || coalesce(rec.observed_subtype,'?') || ', but we serve the row with rent_period_ar '
             || 'NULL. Under the strict period rule a NULL row is excluded from شهري, سنوي AND '
             || 'كلاهما, so the user who picks the period the source actually published cannot '
             || 'reach this listing. That is a period we LOST, not a period the source withheld.',
        'adjudicate', 'This is the one period cohort that is NOT an honest UNKNOWN - the evidence '
             || 'that the source publishes a period is already recorded. Fix the parser so the '
             || 'period is captured, then repair the affected rows. Do NOT resolve this by writing '
             || 'the probe value straight onto the row without fixing the capture path, and do NOT '
             || 'delete the probe. If the source has since STOPPED publishing a period, re-probe the '
             || 'row live and record the new observation - that clears this by itself.',
        'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'observed_subtype', rec.observed_subtype, 'probed_at', rec.probed_at,
        'method', rec.method, 'production_ready', rec.production_ready));
  end loop;

  -- Evaluated path only (§23a/§25a): the cohort that raises is the cohort that resolves.
  perform public.mon_resolve_stale_keys('source_proven_period_unreachable', live_keys);
  return n;
end $function$;

comment on function public.mon_detect_source_proven_period_unreachable() is
  'P1. A listing whose OWN recorded live source probe proves the source publishes a rent period, '
  'served with rent_period_ar NULL - so the strict period chips (شهري/سنوي/كلاهما) cannot reach it. '
  'The owner rule of 2026-09-05 in one predicate: honest UNKNOWN is correct and never alerts; a '
  'period we LOST always does. Mirror of mon_detect_rent_period_contradicts_probe(). Standing 0 is '
  'the healthy reading.';

-- Roster wiring in the SAME migration (§11a), appended to the LIVE definition (§26).
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'REFUSING: mon_run_all_detectors() not found'; end if;
  if position('mon_detect_source_proven_period_unreachable' in v_def) > 0 then
    raise notice 'already wired'; return;
  end if;
  if position('''mon_detect_rent_period_contradicts_probe''' in v_def) = 0 then
    raise exception 'REFUSING: roster anchor not found - refusing to guess where to append';
  end if;
  v_def := replace(v_def, '''mon_detect_rent_period_contradicts_probe''',
    '''mon_detect_rent_period_contradicts_probe'',' || chr(10)
    || '    ''mon_detect_source_proven_period_unreachable''');
  execute v_def;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_source_proven_period_unreachable' in v_def) = 0 then
    raise exception 'REFUSING: roster rewrite did not take';
  end if;
end $$;
