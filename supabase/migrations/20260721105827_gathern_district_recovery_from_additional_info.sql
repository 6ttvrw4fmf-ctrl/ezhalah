-- Monthly (gathern) district recovery — 2026-07-21.
--
-- WHY: gathern is ≈99% of monthly-rent inventory but is NOT a `native` source arm in
-- listing_native_location_v1, so the pipeline never reads its district. Its district comes only from
-- the incompletely-populated listings_arabic_locations bridge → ~20% of monthly listings (4,403 in the
-- live index, ~10,152 in v1) have a NULL district. But gathern's OWN already-Arabic district sits in
-- `additional_info->>'district_ar'` for 99.7% of rows and is simply never ingested. This is the same
-- structural gap the earlier district-recovery project fixed for other platforms — extend it to gathern.
--
-- HOW (faithful + consistent, reuses the EXACT existing resolver): add one arm to refresh_district_recovery()
-- that feeds gathern's Arabic `additional_info->>'district_ar'` to the SAME `resolve_district_ar(city_id, …)`
-- every other platform already uses. Its Arabic branch normalizes the token and matches it against
-- `loc_canonical_district` SCOPED TO THE ROW'S city_id, returning the CANONICAL district or NULL. So:
--   • canonical  → matchable + district-picker-consistent (DB canonical = truth for matching, per the
--     district-canonicalization rule);
--   • city-attested → a district is only recovered if it belongs to the resolved city — this also fixes
--     the "district not matching the city" symptom;
--   • NULL for un-catalogable free-text → NEVER invented (listing-fidelity contract preserved).
-- listings_arabic_locations / the neighborhood arm stay untouched; district_recovery is already
-- COALESCE'd into listing_native_location_v2, so the next sync_search_listings_ar() propagates the
-- recovered districts to search_listings_ar. Additive; existing platforms/rows are byte-identical.
--
-- Verified READ-ONLY before shipping (live prod): of 10,152 gathern v1 rows with a resolved city but no
-- district, 10,119 carry an Arabic additional_info district and 8,710 resolve to a canonical, city-attested
-- district (the ~1,400 non-catalog free-text tokens correctly stay NULL). Reproduced verbatim from the
-- live pg_get_functiondef of refresh_district_recovery(), adding only the gathern arm.

CREATE OR REPLACE FUNCTION public.refresh_district_recovery()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare
  r record;
  n bigint := 0;
  m bigint;
begin
  truncate public.district_recovery;
  for r in
    select c.table_name as t
    from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'neighborhood' and c.table_name like '%\_listings'
      and exists (select 1 from information_schema.columns i
                  where i.table_schema = 'public' and i.table_name = c.table_name and i.column_name = 'id')
  loop
    execute format($f$
      insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at)
      select %L, v1.listing_id, d.val, now()
      from public.listing_native_location_v1 v1
      join (select distinct on (id) id, neighborhood from public.%I order by id, neighborhood) x
        on x.id = v1.listing_id
      cross join lateral (select public.resolve_district_ar(v1.city_id, x.neighborhood) as val) d
      where v1.source_table = %L
        and v1.city_id is not null
        and (v1.district_ar is null or btrim(v1.district_ar) = '')
        and d.val is not null
      on conflict (source_table, listing_id)
        do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at
    $f$, r.t, r.t, r.t);
    get diagnostics m = row_count;
    n := n + m;
  end loop;

  -- Gathern arm (2026-07-21): gathern's district lives in its Arabic additional_info->>'district_ar',
  -- not the English `neighborhood` the loop above reads, so recover it through the SAME resolver's
  -- Arabic branch (canonical + city-attested + NULL for non-catalog). additional_info wins over any
  -- value the neighborhood loop produced for gathern (on conflict do update).
  insert into public.district_recovery (source_table, listing_id, district_ar, resolved_at)
  select v1.source_table, v1.listing_id, d.val, now()
  from public.listing_native_location_v1 v1
  join (select distinct on (id) id, additional_info from public.gathern_residential_listings order by id) g
    on g.id = v1.listing_id
  cross join lateral (select public.resolve_district_ar(v1.city_id, g.additional_info->>'district_ar') as val) d
  where v1.source_table = 'gathern_residential_listings'
    and v1.city_id is not null
    and (v1.district_ar is null or btrim(v1.district_ar) = '')
    and d.val is not null
  on conflict (source_table, listing_id)
    do update set district_ar = excluded.district_ar, resolved_at = excluded.resolved_at;
  get diagnostics m = row_count;
  n := n + m;

  return n;
end;
$function$;
