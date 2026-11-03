-- quarantine_growth learns the dormant registry (2026-11-03).
--
-- listing_native_location_v2 clears production_ready for EVERY row of a platform whose platform_registry.status is
-- 'dormant' (owner down-rule: the source is down at its own end, a card would send a customer to a dead page). This
-- detector counted that decision as growth: measured 2026-11-03 00:40 UTC, five of its nine P1 alerts were dormant
-- platforms at exactly frac 1.000 — sadin 83/83 (502 since 09-25), senan 57/57 and snam 32/32 (down since 10-19),
-- moftah 13/13 (domain expired 10-29), almuteb 11/11 (NXDOMAIN since 10-24). The 2026-10-16 migration
-- qa_detectors_learn_dormant_platforms taught three other monitors the same predicate; this is the fourth caller.
--
-- Nothing is loosened for an ACTIVE platform: same thresholds, same fields. A dormant platform resolves its key and
-- is not snapshotted, so its 100%-held weeks never inflate the 7-day median it is judged against on return.
create or replace function public.mon_detect_quarantine_growth()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  v_median numeric;
  v_thresh_abs numeric;
  v_fired boolean;
begin
  for rec in
    select platform,
           count(*) filter (where not production_ready) as unready,
           -- Unlocated rows are still served by the unlocated-search fallback: quarantined, but a
           -- real user reaches them whenever location is not constrained.
           count(*) filter (where not production_ready and city_id is null) as unready_fallback_reachable,
           -- Located AND withheld: these are the rows no search can return. This is the number that
           -- actually means "invisible".
           count(*) filter (where not production_ready and city_id is not null) as unready_unreachable,
           count(*) as total
    from public.search_listings_ar
    group by platform
  loop
    -- A dormant platform is held out of search on purpose (owner down-rule), not quarantined by a defect.
    if public.ops_platform_is_dormant(rec.platform) then
      update public.alert_event set resolved_at = now()
      where kind='quarantine_growth' and resolved_at is null
        and dedup_key = 'quarantine_growth:'||rec.platform;
      continue;
    end if;

    select percentile_cont(0.5) within group (order by h.unready)
      into v_median
    from public.mon_quarantine_snapshot h
    where h.platform = rec.platform
      and h.captured_at > now() - interval '7 days';

    v_thresh_abs := case when v_median is null then 20 else greatest(20, 2 * v_median) end;

    v_fired := rec.unready > v_thresh_abs
            or (rec.total > 0 and rec.unready::numeric / rec.total > 0.25);

    if v_fired then
      n := n + public.mon_raise('P1','quarantine_growth', rec.platform,
        'quarantine_growth:'||rec.platform,
        jsonb_build_object('platform', rec.platform, 'unready', rec.unready, 'total', rec.total,
          'frac', round(rec.unready::numeric / nullif(rec.total,0), 3),
          'median_7d', v_median, 'threshold_abs', v_thresh_abs,
          'unready_fallback_reachable', rec.unready_fallback_reachable,
          'unready_unreachable', rec.unready_unreachable,
          'why','quarantined (not production_ready) rows exceed 2x the 7-day median (floor 20) or '
             || '25% of the platform. NOT necessarily invisible: a row quarantined only for an '
             || 'unresolved city is still served by the unlocated-search fallback and a real user '
             || 'reaches it whenever location is not constrained. Read unready_unreachable — those '
             || 'are the rows no search can return. Verified 2026-08-26 through the anon RPC: all 59 '
             || 'active erapulse listings were retrievable, including all 17 quarantined ones.',
          'adjudicate','If unready_unreachable is 0, nothing is lost to users and this is a LOCATION '
             || 'RESOLVER signal, not a searchability outage — fix city resolution, and never '
             || '"repair" the listings themselves (§4: they are intact and reachable). If '
             || 'unready_unreachable is non-zero, those rows are genuinely withheld: find the gate '
             || 'that is holding them and adjudicate it against source truth before changing data.'));
    else
      update public.alert_event set resolved_at = now()
      where kind='quarantine_growth' and resolved_at is null
        and dedup_key = 'quarantine_growth:'||rec.platform;
    end if;

    insert into public.mon_quarantine_snapshot (platform, unready, total)
    select rec.platform, rec.unready, rec.total
    where not exists (select 1 from public.mon_quarantine_snapshot h2
                      where h2.platform = rec.platform
                        and h2.captured_at > now() - interval '55 minutes');
  end loop;
  delete from public.mon_quarantine_snapshot where captured_at < now() - interval '30 days';
  return n;
end $function$;
