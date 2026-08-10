-- `price_per_meter * area_m2` overflowed int4 on large land parcels (a 5,000,000 m² farm at any
-- realistic rate exceeds 2.1B), aborting the whole monitor with "integer out of range". Cast to
-- bigint before multiplying. Found immediately on first run, 2026-08-09.
create or replace function public.mon_source_is_truth_violations()
returns table(check_name text, platform text, n bigint, detail text)
language sql
stable
as $$
  select 'rent_period_missing_on_priced_rent'::text, s.platform,
         count(*)::bigint,
         'priced rent listings with NO period — unreachable by both annual and monthly filters'::text
  from public.search_listings_ar s
  where s.deal_ar = 'إيجار' and s.price_annual is not null and s.rent_period_ar is null
  group by s.platform
  having count(*) > 0

  union all
  select 'buy_total_equals_per_metre_rate', s.platform, count(*)::bigint,
         'price_total == price_per_meter — a RATE stored as the whole asking price'
  from public.search_listings_ar s
  where s.deal_ar = 'بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.price_total > 0
  group by s.platform
  having count(*) > 0

  union all
  select 'buy_total_is_ppm_times_area', s.platform, count(*)::bigint,
         'price_total == price_per_meter * area_m2 exactly — arithmetic, not a published price'
  from public.search_listings_ar s
  where s.deal_ar = 'بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.area_m2 is not null and s.area_m2 > 0 and s.price_per_meter > 0
    and s.price_total::bigint = s.price_per_meter::bigint * s.area_m2::bigint
  group by s.platform
  having count(*) > 0

  union all
  select 'amenity_false_for_whole_platform', t.platform, t.n_false::bigint,
         'furnished=false on 100% of a platform''s rows — a default asserting NO, not a reading'
  from (
    select s.platform,
           count(*) filter (where s.furnished is false) n_false,
           count(*) filter (where s.furnished is true)  n_true,
           count(*) filter (where s.furnished is null)  n_null
    from public.search_listings_ar s
    group by s.platform
  ) t
  where t.n_false > 50 and t.n_true = 0 and t.n_null = 0

  union all
  select 'active_listing_with_no_price', s.platform, count(*)::bigint,
         'active with neither price_annual nor price_total — check for a degraded fetch blanking rows'
  from public.search_listings_ar s
  where s.price_annual is null and s.price_total is null
  group by s.platform
  having count(*) > 0
$$;
