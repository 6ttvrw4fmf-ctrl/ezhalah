-- THE SAME DEFECT AS 20260925062556, in the one sibling that genuinely shares its shape.
--
-- mon_detect_source_proven_period_unreachable() builds a PER-ROW dedup key inside a cohort scan
-- capped at `limit 200`, then calls mon_resolve_stale_keys() unconditionally. That sweep resolves
-- every open key of the kind absent from live_keys, and a row cut off by the LIMIT is absent for a
-- reason that is not "it was fixed". Its own comment — "the cohort that raises is the cohort that
-- resolves" — is true only while the cohort fits in the window, and nothing checked that.
--
-- This one is LATENT, not active: its cohort measured 0 rows on 2026-09-25 06:3xZ, so no finding has
-- been falsely resolved. It is fixed now because the cohort is a repair backlog that grows in
-- bursts — a parser that starts losing a period it used to capture adds rows in the hundreds, which
-- is exactly the moment the sweep would start declaring the overflow fixed.
--
-- HOW THE CLASS WAS BOUNDED, because a regex over 75 sweeping detectors is not evidence. Ten
-- detectors pair mon_resolve_stale_keys() with a literal LIMIT; the other nine were read, not
-- pattern-matched, and eight are NOT vulnerable — their LIMIT caps rows embedded in a payload or a
-- subquery lookup, not the key set. mon_detect_adjudicated_reactivation() is the instructive false
-- positive: it also carries `limit 200`, but it raises ONE key per day
-- ('adjudicated_reactivation:' || current_date), so a truncated payload under-reports its row list
-- and cannot resolve anything real. Only a per-row key set can be silently swept.
--
-- Guard identical to the sibling migration, including the self-healing resolve so the new kind
-- cannot become the ratchet mon_detect_unresolvable_alert_kinds() exists to catch. Raise predicate,
-- severity, dedup key and payload are unchanged for every row in the window.

create or replace function public.mon_detect_source_proven_period_unreachable()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record; n int := 0; live_keys text[] := '{}';
  window_limit constant int := 200;
  cohort_total int;
begin
  select count(*) into cohort_total
    from ops_rent_period_source_probe p
    join search_listings_ar s
      on s.source_table = p.source_table and s.listing_id = p.listing_id
   where p.observed_subtype in ('سنوي','شهري','annual','monthly')
     and s.rent_period_ar is null
     and s.deal_ar = 'إيجار';

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
     limit window_limit
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

  if cohort_total <= window_limit then
    -- Evaluated path only (§23a/§25a): the cohort that raises is the cohort that resolves — safe
    -- ONLY because the whole cohort was inside the window, which is now checked rather than assumed.
    perform public.mon_resolve_stale_keys('source_proven_period_unreachable', live_keys);
    perform public.mon_resolve_key('source_proven_period_unreachable_truncated',
                                   'source_proven_period_unreachable_truncated:fleet');
  else
    n := n + public.mon_raise('P1', 'source_proven_period_unreachable_truncated', 'all',
      'source_proven_period_unreachable_truncated:fleet',
      jsonb_build_object(
        'why', 'mon_detect_source_proven_period_unreachable() found more rows than its scan window, '
             || 'so it cannot see its whole cohort. The stale-key sweep was SKIPPED this run on '
             || 'purpose: a row past the window is missing from live_keys for a reason that is not '
             || '"it was fixed", and resolving on that would turn a real open finding into a false '
             || 'all-clear.',
        'fix', 'Repair the period-capture backlog until the cohort fits, or establish why it grew. '
             || 'Do NOT raise window_limit to clear this — that moves the blind spot instead of '
             || 'removing it. This alert self-resolves on the next sweep in which the cohort fits.',
        'cohort_total', cohort_total, 'window_limit', window_limit,
        'not_resolved_this_run', true));
  end if;

  return n;
end $function$;
