-- A P1 must not assert something production disproves.
--
-- mon_detect_quarantine_growth() has told us since 2026-08-11 that quarantined rows "are invisible
-- to search". On 2026-08-26 that was tested against the real production RPC through the anon key
-- rather than believed: all 59 active erapulse listings were retrieved by the Normal Filter,
-- INCLUDING all 17 quarantined ones. Every one of the 434 not-production_ready rows in
-- listing_native_location_v2, across 16 platforms, is quarantined for exactly one reason — no city
-- resolved — and those rows are served by the unlocated-search fallback. So the claim was false for
-- 100% of the detector's live cohort.
--
-- This is the run #62 shape from the other side. There, a barrier called a thing healthy that was
-- broken ("configured" read as "delivered"). Here, a barrier calls a thing broken that users can
-- actually reach. Both are the same defect: a barrier reporting a claim it never measured.
--
-- What deliberately does NOT change: the cohort, the 2x-median/floor-20/25% thresholds, the P1
-- severity, and the resolve branch. Quarantine growth is still worth alerting on — an unlocated row
-- is reachable only while the user has not constrained location, so a rising quarantine really does
-- shrink how findable that platform's inventory is. The detector was made to DISCRIMINATE, never
-- silenced (§21/§23b): the payload now separates rows that are merely unlocated-but-reachable from
-- rows that are genuinely withheld from every search, so a future engineer can tell at a glance
-- which kind of problem they have — and does not go "repair" listings that were never lost.

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

comment on function public.mon_detect_quarantine_growth() is
  'P1. Quarantined (not production_ready) rows exceed 2x the 7-day median (floor 20) or 25% of the '
  'platform. Thresholds and cohort unchanged since 2026-08-11; on 2026-08-26 the payload was made to '
  'DISCRIMINATE unlocated-but-fallback-reachable rows from genuinely unreachable ones, after the '
  'production RPC disproved the old "invisible to search" claim for 100% of the live cohort.';
