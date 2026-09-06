-- Companion to 20260905183507 (the honest-UNKNOWN denominator fix), and a correction to a trap that
-- fix would otherwise have sprung.
--
-- mon_detect_searchability_collapse() had TWO independently worded predicates for one question:
--   raise:   from mon_searchability_alerts where verdict <> 'OK'
--   resolve: mon_resolve_key(...) from mon_searchability_alerts where verdict = 'OK' and not seen
-- Those agree only while 'OK' is the single healthy value. Adding the new, equally healthy verdict
-- OK_NO_SOURCE_ESTABLISHED_PERIOD breaks the agreement in the worst direction: it is <> 'OK' so it
-- would RAISE, and it is not = 'OK' so the self-heal could never CLEAR it - a permanently red P2 on
-- the seven honest-UNKNOWN platforms, which is precisely the false alert the denominator fix exists
-- to remove, re-created one layer up.
--
-- §25a states the cure and it is structural, not a second edit: derive the live key set from the
-- cohort that raises and hand exactly that to mon_resolve_stale_keys(). There is then only one
-- predicate, so no two phrasings of "is it still broken?" can disagree. The healthy test is
-- `verdict LIKE 'OK%'`, written ONCE, so a future verdict named OK_SOMETHING_ELSE inherits the
-- correct behaviour instead of quietly becoming an alert.

create or replace function public.mon_detect_searchability_collapse()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; r record; live_keys text[] := '{}';
begin
  for r in
    -- ONE predicate. Every verdict whose name begins with OK is a healthy, non-alerting state:
    -- 'OK' (measured and fine) and 'OK_NO_SOURCE_ESTABLISHED_PERIOD' (nothing to measure, because
    -- the source established no period for any listing here - correct under the strict period rule,
    -- owner 2026-09-05).
    select * from public.mon_searchability_alerts
     where verdict not like 'OK%'
     order by held desc
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

comment on function public.mon_detect_searchability_collapse() is
  'Rent-apartment searchability per platform, measured ONLY over rows whose period the source '
  'established. Honest UNKNOWN periods are excluded from both numerator and denominator (owner rule '
  '2026-09-05) so the strict period behaviour can never read as a collapse. Raise and resolve share '
  'one predicate (verdict NOT LIKE ''OK%%'').';
