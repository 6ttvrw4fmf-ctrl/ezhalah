-- QA & Repair 2026-10-07: searchability_collapse must tell a DELIBERATELY dormant site from a broken search.
-- dwelleo (12,328 rows, source catalogue 404) and nafithh (domain gone) were set status='dormant' in
-- platform_registry by the Scraping Engineer on 2026-10-07 and hidden from search on purpose. The detector
-- read that intended state as a P1 SEARCHABILITY_COLLAPSE (alerts 8538, 8549), which buries the two real
-- NEW_ROWS_STUCK_BEFORE_SEARCH cases (muhaysini, sadiqeltajer) in noise. A dormant platform is skipped;
-- reactivate_recovered_dormant_platforms() flips it back to 'active' the hour it serves listings again, and
-- from then on this detector watches it exactly as before. Every non-dormant platform is unchanged.
CREATE OR REPLACE FUNCTION public.mon_detect_searchability_collapse()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0; r record; live_keys text[] := '{}';
begin
  for r in
    -- ONE predicate. Every verdict whose name begins with OK is a healthy, non-alerting state:
    -- 'OK' (measured and fine) and 'OK_NO_SOURCE_ESTABLISHED_PERIOD' (nothing to measure, because
    -- the source established no period for any listing here - correct under the strict period rule,
    -- owner 2026-09-05). A platform the registry marks 'dormant' is hidden from search ON PURPOSE
    -- (its source stopped serving listings), so its zero searchability is the intended state, not a
    -- collapse (QA 2026-10-07).
    select a.* from public.mon_searchability_alerts a
     where a.verdict not like 'OK%'
       and not exists (select 1 from public.platform_registry pr
                        where pr.platform = a.platform and pr.status = 'dormant')
     order by a.held desc
  loop
    live_keys := live_keys || ('searchability_collapse:' || r.platform);
    n := n + public.mon_raise(
      case when r.verdict = 'SEARCHABILITY_COLLAPSE' then 'P1' else 'P2' end,
      'searchability_collapse', r.platform,
      'searchability_collapse:' || r.platform,
      jsonb_build_object(
        'verdict', r.verdict,
        'held', r.held,
        'period_known', r.period_known,
        'period_unknown', r.period_unknown,
        'searchable_by_period', r.searchable_by_period,
        'pct_period_searchable', r.pct_period_searchable,
        'baseline_pct', r.baseline_pct,
        'baseline_samples', r.baseline_samples,
        'blocked_not_production_ready', r.blocked_not_production_ready,
        'period_waived', r.period_waived,
        'why', 'Rent APARTMENT searchability for this platform fell against its own 14-day '
               'baseline, measured over the rows whose period the SOURCE established '
               '(period_known). Rows with an honest UNKNOWN period are excluded from BOTH sides of '
               'that ratio and can never cause this alert - under the owner rule of 2026-09-05 they '
               'are correctly absent from شهري, سنوي and كلاهما, and remain reachable with no '
               'period filter. Do NOT "fix" this by defaulting a rent period; that fabricates a '
               'source fact (§22). Find what stopped resolving: the scraper''s period field, '
               'production_ready, or the location resolver.'));
  end loop;

  -- Evaluated path only, one predicate (§23a/§25a): the cohort that raised above is exactly the
  -- cohort that stays open; everything else resolves.
  perform public.mon_resolve_stale_keys('searchability_collapse', live_keys);
  return n;
end $function$;
