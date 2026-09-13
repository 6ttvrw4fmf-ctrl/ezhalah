-- Add "حي الرياض" as an official Hofuf (city_id=12) district — evidenced by two amlakalahsa land
-- listings whose own titles explicitly say "بالهفوف" (in Hofuf) while naming this exact
-- neighborhood; the neighborhood is real, it was just missing from the catalog. (owner-approved
-- 2026-09-13, verified against production data.)
insert into loc_catalog_district (city_id, district_ar, district_norm)
values (12, 'حي الرياض', norm_district_tok('حي الرياض'));

-- resolve_amlakalahsa_locations(): mirrors resolve_aqar_locations()'s proven pattern — a per-
-- platform resolver that writes into the SHARED listings_arabic_locations shadow table, never the
-- raw table (which stays verbatim per the scraper's own documented contract — see
-- scrapers/amlakalahsa/run.py's pw-dis comment: "production's own view chain does that
-- canonicalization"). Needed because amlakalahsa (onboarded 2026-09-12) had ZERO rows in
-- listings_arabic_locations — nothing was ever resolving it, so any one-off direct edit to the raw
-- table's own district_ar/city_id got silently reverted on the next scrape.
--
-- Part A matches the raw neighborhood text against the district catalog (scoped to region 5 /
-- Eastern Province — this office is Al-Ahsa-only, per run.py) so a correct DISTRICT match also
-- fixes city even when the scraper's own Google-geocoded city_id disagrees with the catalog's city
-- for that district. Part B is a city-only fallback for rows with no district match but a geocoded
-- city. Idempotent / safe to re-run: only ever INSERTs a row that doesn't exist yet (on conflict do
-- nothing), matching resolve_aqar_locations()'s own concurrency-safe shape.
--
-- NOTE (2026-09-13): a cluster of ~52 "ضاحية هجر" / "الضاحية <ordinal>" land listings (city الجفر)
-- is deliberately NOT hard-mapped here — الجفر's district catalog was being actively restructured
-- elsewhere while this was written (its "حي هجر <ordinal>" entries were replaced with a different
-- official list mid-session), so hard-coding a match against a moving target risked wiring in a
-- name that would already be wrong by the time this ships. This resolver picks that cluster up for
-- free, automatically, on a future hourly run once that catalog settles — no code change needed.
-- (Superseded by migration 20260913083220 — see that file for what actually happened.)
create or replace function public.resolve_amlakalahsa_locations()
returns table(district_matched integer, city_only_matched integer)
language plpgsql
as $function$
declare d1 int := 0; c1 int := 0;
begin
  with ins as (
    insert into listings_arabic_locations
      (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, raw_district, district_ar, matched, review_reason)
    select distinct on (a.id)
           'amlakalahsa_residential_listings:'||a.id::text, 'amlakalahsa', 'amlakalahsa_residential_listings', a.id,
           case when a.transaction_type = 'Buy' then 'buy' else 'rent' end,
           a.city, cc.city_ar, cr.region_ar, a.neighborhood, d.district_ar, true,
           'amlakalahsa_district_first_match'
    from amlakalahsa_residential_listings a
    join loc_catalog_district d on d.district_norm = public.norm_district_tok(a.neighborhood)
    join loc_catalog_city cc on cc.city_id = d.city_id and cc.region_id = 5
    join loc_catalog_region cr on cr.region_id = cc.region_id
    where a.active
      and not exists (select 1 from listings_arabic_locations l where l.index_id = 'amlakalahsa_residential_listings:'||a.id::text)
    order by a.id, cc.city_id
    on conflict (index_id) do nothing
    returning 1
  ) select count(*) into d1 from ins;

  with ins2 as (
    insert into listings_arabic_locations
      (index_id, platform, source_table, listing_id, purpose, raw_city_en, city_ar, region_ar, matched, review_reason)
    select distinct on (a.id)
           'amlakalahsa_residential_listings:'||a.id::text, 'amlakalahsa', 'amlakalahsa_residential_listings', a.id,
           case when a.transaction_type = 'Buy' then 'buy' else 'rent' end,
           a.city, cc.city_ar, cr.region_ar, true, 'amlakalahsa_city_only_fallback'
    from amlakalahsa_residential_listings a
    join loc_catalog_city cc on cc.city_id = a.city_id
    join loc_catalog_region cr on cr.region_id = cc.region_id
    where a.active and a.city_id is not null
      and not exists (select 1 from listings_arabic_locations l where l.index_id = 'amlakalahsa_residential_listings:'||a.id::text)
    order by a.id
    on conflict (index_id) do nothing
    returning 1
  ) select count(*) into c1 from ins2;

  return query select d1, c1;
end
$function$;

-- Hourly, offset to :25 — not used by any existing resolver cron (existing jobs sit on 1/3/6-59/10
-- and fixed minutes 12/16/50; see cron.job).
select cron.schedule('resolve-amlakalahsa-locations', '25 * * * *', $$select resolve_amlakalahsa_locations();$$);
