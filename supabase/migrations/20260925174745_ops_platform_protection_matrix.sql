-- ops_platform_protection_matrix(): the owner's 104-platform checklist, MEASURED from production on
-- every call (owner, 2026-09-25: "PROVE whether they actually cover all active platforms. Do not
-- assume they are global because of their names.").
--
-- Every yes/no is a fact about data, never about code existing:
--   direct_liveness_check   the registry strategy is a per-listing oracle (not crawl presence alone)
--   production_verified     >= 90% of active rows carry last_verified_alive_at inside the SLA
--   location_protections    every active row is in BOTH relations the generic location detectors
--                           read (search_listings_ar, listing_native_location_v1) - a row missing
--                           from them is invisible to those detectors whatever their names say
--   district_source_check   the platform has rows in listing_source_district_ar, the only input
--                           mon_detect_district_contradicts_source compares against (measured
--                           2026-09-25: gathern only)
create or replace function public.ops_platform_protection_matrix()
returns table (
  platform text, active bigint, liveness_strategy text,
  direct_liveness_check boolean, production_verified boolean, pct_verified_in_sla numeric,
  location_protections boolean, district_source_check boolean,
  served bigint, native_resolved bigint, pct_with_city numeric, source_district_rows bigint,
  remaining_issue text, final_status text)
language sql stable
set statement_timeout = '180s'
as $$
  with inv as (
    select c.platform, c.active, c.strategy, c.pct_verified_in_sla
      from public.ops_platform_liveness_coverage c where c.active > 0),
  s as (select s.platform, count(*) n, count(*) filter (where s.city_id is not null) with_city
          from public.search_listings_ar s group by 1),
  st as (select distinct s.platform, s.source_table from public.search_listings_ar s),
  v1 as (select v.platform, count(*) n from public.listing_native_location_v1 v group by 1),
  sd as (select st.platform, count(*) n
           from public.listing_source_district_ar d join st using (source_table) group by 1),
  m as (
    select inv.*,
           coalesce(s.n, 0) served, coalesce(s.with_city, 0) with_city,
           coalesce(v1.n, 0) native_resolved, coalesce(sd.n, 0) sd_rows,
           inv.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT') as direct_chk,
           coalesce(inv.pct_verified_in_sla, 0) >= 90 as prod_ok,
           coalesce(s.n, 0) >= inv.active and coalesce(v1.n, 0) >= inv.active as loc_ok,
           coalesce(sd.n, 0) > 0 as sd_ok
      from inv left join s using (platform) left join v1 using (platform) left join sd using (platform))
  select m.platform, m.active, m.strategy,
         m.direct_chk, m.prod_ok, round(coalesce(m.pct_verified_in_sla, 0), 1),
         m.loc_ok, m.sd_ok,
         m.served, m.native_resolved,
         round(100.0 * m.with_city / nullif(m.served, 0), 1), m.sd_rows,
         nullif(concat_ws('; ',
           case when not m.direct_chk then 'no direct per-listing liveness check (crawl presence only)' end,
           case when m.direct_chk and not m.prod_ok then
             format('liveness not verified in production (%s%% in SLA)', round(coalesce(m.pct_verified_in_sla, 0), 1)) end,
           case when not m.loc_ok then
             format('rows invisible to location detectors (served %s, resolved %s of %s)', m.served, m.native_resolved, m.active) end,
           case when m.served > 0 and m.with_city < 0.98 * m.served then
             format('%s%% of served rows have no city', round(100 - 100.0 * m.with_city / m.served, 1)) end,
           case when not m.sd_ok then 'district never compared against source' end), ''),
         case when m.prod_ok and m.loc_ok and m.sd_ok then 'PROTECTED'
              when m.direct_chk and m.loc_ok then 'PARTIAL'
              else 'UNPROTECTED' end
    from m
   order by m.active desc;
$$;

comment on function public.ops_platform_protection_matrix() is
  'Owner checklist (2026-09-25): per active platform, measured liveness + location/district protection. Every column is computed from production data on each call.';
