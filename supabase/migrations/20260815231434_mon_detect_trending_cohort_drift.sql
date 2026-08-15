-- Barrier: Trending counts = search counts, forever (owner barrier #18 and #1-#4).
--
-- Compares, for a fixed probe set of cohorts (typed AND untyped, Rent-annual AND Buy):
--   • top_cities_by_deal_ar(city row) vs location_search_candidates_ar total_count — must be EQUAL;
--   • district_options_ar(top district, via its own match_values) vs search — must be EQUAL;
--   • percentage invariants: 0 <= count <= denominator (no >100%, no negatives);
--   • sum of city counts <= cohort denominator (unresolved-city rows explain any gap, never exceed).
-- The probe caught a real drift on day one: RNPL rows are ANNUAL in search but were missing from
-- trending's period clause (fixed in trending_period_semantics_mirror_search_rnpl_annual).
--
-- Reachability (AGENTS.md): a detector must be swept or own a cron job. This one owns
-- pg_cron 'mon-trending-cohort-drift' — rebuilding mon_run_all_detectors from a stale base is the
-- documented dark-detector hazard, so the sweep is deliberately not modified.

create or replace function public.mon_detect_trending_cohort_drift()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  n int := 0; bad jsonb := '[]'::jsonb;
  r record; s_cnt int; d record; ds_cnt int;
begin
  for r in
    with probe(label, deal, pm, period, types) as (values
      ('apt-rent-annual', 'إيجار', false, 'سنوي', array['شقة']),
      ('apt-buy',         'بيع',   null::boolean, null::text, array['شقة']),
      ('floor-rent-annual','إيجار', false, 'سنوي', array['دور']),
      ('building-buy',    'بيع',   null, null, array['عمارة']),
      ('untyped-rent-annual','إيجار', false, 'سنوي', null::text[])
    )
    select p.label, p.deal, p.pm, p.period, p.types,
           tc.city_ar, tc.listing_count, tc.total_in_cohort,
           sum(tc.listing_count) over (partition by p.label) as sum_cities
    from probe p
    cross join lateral (
      select * from top_cities_by_deal_ar(p.deal, p.pm, 'Residential', p.types)
      order by listing_count desc limit 1
    ) tc
  loop
    if r.listing_count < 0 or r.listing_count > r.total_in_cohort or r.sum_cities > r.total_in_cohort then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'pct_invariant',
        'count', r.listing_count, 'total', r.total_in_cohort, 'sum_cities', r.sum_cities);
    end if;
    select max(total_count) into s_cnt from location_search_candidates_ar(
      p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
      p_category := 'Residential', p_cities := array[r.city_ar], p_limit := 1);
    if coalesce(s_cnt, 0) <> r.listing_count then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'city_drift',
        'city', r.city_ar, 'trending', r.listing_count, 'search', s_cnt);
    end if;
    select dd.* into d from district_options_ar(
        (select city_id from loc_catalog_city where city_ar = r.city_ar limit 1),
        r.deal, 'Residential', r.pm, r.types) dd
      where dd.listing_count > 0 order by dd.listing_count desc limit 1;
    if found then
      select max(total_count) into ds_cnt from location_search_candidates_ar(
        p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
        p_category := 'Residential', p_cities := array[r.city_ar],
        p_districts := d.match_values, p_limit := 1);
      if coalesce(ds_cnt, 0) <> d.listing_count
         or d.listing_count > d.total_in_city or d.listing_count < 0 then
        bad := bad || jsonb_build_object('probe', r.label, 'kind', 'district_drift',
          'district', d.district_ar, 'trending', d.listing_count, 'search', ds_cnt,
          'total_in_city', d.total_in_city);
      end if;
    end if;
  end loop;

  if jsonb_array_length(bad) > 0 then
    n := n + public.mon_raise('P1', 'trending_cohort_drift', 'search',
      'trending_cohort_drift',
      jsonb_build_object('failures', bad,
        'why', 'Trending city/district counts or percentages no longer equal what the search RPC '
            || 'returns for the same cohort. The number on the chip is a promise; fix the predicate '
            || 'drift, never the display.'));
  else
    update public.alert_event set resolved_at = now()
     where kind = 'trending_cohort_drift' and dedup_key = 'trending_cohort_drift'
       and resolved_at is null;
  end if;
  return n;
end $$;

comment on function mon_detect_trending_cohort_drift() is
  'Owner barriers #1-#4 + #18 for cohort-aware Trending: trending count == search count, exact '
  'denominators, no >100% or negative percentages. Runs on its own pg_cron '
  '(mon-trending-cohort-drift); self-heals its alert when clean.';

select cron.schedule('mon-trending-cohort-drift', '37 */6 * * *',
                     $c$select mon_detect_trending_cohort_drift();$c$);

select mon_detect_trending_cohort_drift() as fired_alerts;
