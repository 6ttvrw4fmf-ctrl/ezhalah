-- deep-location-matching-audit 2026-08-04. This function self-heals loc_canonical_district from
-- any production_ready row's district_ar (the "liv" CTE below) with no placeholder exclusion. As
-- a result it had already promoted "غير محدد" ("unspecified" -- a sentinel in
-- scrapers/common/placeholder_tokens.py PLACEHOLDER_TOKENS, never a real district) as a FAKE
-- canonical district for 18 city_ids -- which was masking most of the display-layer leak fixed
-- separately in listing_native_location_v1 from ever surfacing in a "district not in catalog"
-- audit. Needle edit: same 3-token exclusion already used elsewhere in this codebase (see
-- supabase/migrations/20260729123358_mon_field_integrity_phone_id_price_detector.sql's `ph`
-- array) added to the "liv" CTE's WHERE clause. Nothing else in the live function body changed.
CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar
    where production_ready and district_ar is not null and btrim(district_ar) <> ''
      and district_ar not in ('غير محدد','اخرى','أخرى')
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k order by pref asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k, sp, case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;
  return n;
end;
$function$
;
