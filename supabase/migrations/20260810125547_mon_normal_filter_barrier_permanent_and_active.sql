-- PERMANENT, ACTIVE Normal Filter Safety Barrier (owner request 2026-08-10). One view aggregating a
-- per-field OUR-MISTAKE invariant for every Normal Filter field; a self-check fn that alerts on any
-- regression; and an hourly cron so it catches regressions automatically, not just in a one-time audit.
--
-- DESIGN PRINCIPLE (source-is-truth): every count flags ONLY Ezhalah-side mistakes — fabrication,
-- cross-field contamination, unreachable/dropped listings. Source-published UNUSUAL values (high
-- bedroom/area counts, unusual prices of any magnitude) are deliberately NOT flagged. All columns
-- must read 0. Price/rent-period internals are the FROZEN domain and are only READ here, never mutated;
-- deeper price-fabrication is covered by the dedicated price monitors (mon_detect_price_source_mismatch,
-- mon_detect_impossible_price_size, mon_detect_buy_token_price_suppression). District dead-ends are
-- covered by the live 6-hourly verify-district-suggestion-parity-live.ts (deal/monthly/category scopes).
create or replace view public.mon_normal_filter_barrier as
select
  (select count(*) from search_listings_ar where production_ready and deal_ar not in ('بيع','إيجار')) as deal_invalid,
  (select count(*) from search_listings_ar where production_ready and deal_ar='بيع' and (payment_monthly is true or rent_period_ar is not null)) as buy_has_rent_signal,
  (select count(*) from search_listings_ar where production_ready and payment_monthly is true and rent_period_ar='سنوي') as monthly_annual_overlap,
  (select count(*) from search_listings_ar where production_ready and (region_id is null or city_id is null)) as located_but_null_region_or_city,
  (select count(*) from search_listings_ar where production_ready and city_id is not null
     and coalesce(cardinality(match_city_ids),0)>0 and not (city_id = any(match_city_ids))) as cityid_not_in_match,
  (select count(*) from search_listings_ar where production_ready and district_ar ~ '[A-Za-z]') as district_english_leak,
  (select count(*) from search_listings_ar s where production_ready
     and not exists (select 1 from known_type_ar k where k.type_ar=s.type_ar)) as untaxonomized_type,
  (select count(*) from known_type_ar where macro not in ('Residential','Commercial','both')) as bad_type_macro,
  (select count(*) from search_listings_ar where production_ready and bedrooms is not null and bedrooms < 0) as bedrooms_negative,
  (select count(*) from search_listings_ar where production_ready and area_m2 is not null and area_m2 < 0) as area_negative;

comment on view public.mon_normal_filter_barrier is
  'PERMANENT Normal Filter safety barrier — per-field Ezhalah-side-mistake invariants (all must be 0). '
  'Source-published unusual values are NOT flagged (source-is-truth). Checked hourly by '
  'mon_check_normal_filter_barrier(); asserted nightly by check_audit_invariants.py::check_normal_filter_barrier; '
  'district dead-ends covered by verify-district-suggestion-parity-live.ts.';

-- Root-cause detector for the ambiguous-city ("never guess") class: catalog cities that share a
-- normalized name within the same region (e.g. بيشة city_id 1301 & 1514 in عسير). These are what force
-- a resolver to guess; the souq24 arm currently picks the lowest id (staged fix: HAVING count(DISTINCT
-- city_id)=1 → NULL). Dedup is a Region→City→District catalog change (owner-gated); this surfaces it.
create or replace view public.mon_duplicate_city_catalog as
select normalize_ar(city_ar) as city_norm, region_id,
       count(*) as dup_count, array_agg(city_id order by city_id) as city_ids,
       array_agg(distinct city_ar) as spellings
from loc_catalog_city
group by normalize_ar(city_ar), region_id
having count(*) > 1;

-- Active self-check: raise ONE alert per regressed field (dedup key = alert_type) so it escalates but
-- doesn't spam; returns the total number of violating fields.
create or replace function public.mon_check_normal_filter_barrier()
 returns integer language plpgsql as $fn$
declare j jsonb; total int := 0; col text; v int;
begin
  select to_jsonb(b) into j from public.mon_normal_filter_barrier b;
  for col in select jsonb_object_keys(j) loop
    v := coalesce((j->>col)::int, 0);
    if v > 0 then
      total := total + 1;
      insert into public.location_pipeline_alerts(alert_type, metric, detail)
      values ('normal_filter_barrier_'||col, v,
              'Normal Filter barrier regression: '||col||'='||v||' (Ezhalah-side mistake; source-published unusual values are exempt).');
    end if;
  end loop;
  return total;
end $fn$;

-- Hourly, at an off-hot minute (:41) to respect the cron-load staggering already in place.
select cron.schedule('normal-filter-barrier', '41 * * * *', $$select public.mon_check_normal_filter_barrier();$$);
