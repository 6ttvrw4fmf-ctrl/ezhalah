-- listing_rich_attrs carries dealapp residential utilities (🆕 New Listings Engineer, 2026-10-10).
-- dealapp publishes «utilities» as a STRUCTURED JSON-LD list («Electricity, Waters, Sanitation …»),
-- read by scrapers/dealapp/run.py af_answers() since 2026-10-05 (listed = yes, unlisted = unknown).
-- Measured: of 1,576 dealapp residential arrivals in 24 h the raw table holds electricity on 1,200,
-- water on 1,151, sewage on 1,011 — and search held 0 of each, because the residential branch of
-- this view reads «NULL::boolean AS electricity / water_supply / sanitation». The commercial branch
-- already reads x.electricity / x.water_supply / x.sanitation. A value the source publishes never
-- reached the Advanced Filter (Nothing trapped, ADVANCED_FILTER_SOURCE_TRUTH).
-- Needle edit of the LIVE definition (the recipe of 20261010062805): the anchor is the dealapp
-- residential branch header, so no other branch can be touched; it must match exactly once or this
-- raises and nothing changes. Same columns, same order: CREATE OR REPLACE, no DROP.
do $m$
declare
  v text := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  o text := $q$'dealapp_residential_listings'::text AS source_table,
    d.id AS listing_id,
    NULL::text AS ac_type,
    NULL::text AS kitchen_status,
    NULL::text AS furnishing_level,
    NULL::smallint AS parking_count,
    NULL::text AS parking_type,
    NULL::boolean AS installment_available,
    NULL::numeric AS installment_amount,
    NULL::smallint AS installment_count,
    NULL::boolean AS separate_electricity_meter,
    NULL::boolean AS separate_water_meter,
    NULL::boolean AS electricity,
    NULL::boolean AS water_supply,
    NULL::boolean AS sanitation,$q$;
  n text := $q$'dealapp_residential_listings'::text AS source_table,
    d.id AS listing_id,
    NULL::text AS ac_type,
    NULL::text AS kitchen_status,
    NULL::text AS furnishing_level,
    NULL::smallint AS parking_count,
    NULL::text AS parking_type,
    NULL::boolean AS installment_available,
    NULL::numeric AS installment_amount,
    NULL::smallint AS installment_count,
    NULL::boolean AS separate_electricity_meter,
    NULL::boolean AS separate_water_meter,
    d.electricity AS electricity,
    d.water_supply AS water_supply,
    d.sanitation AS sanitation,$q$;
  hits int;
begin
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  if hits <> 1 then raise exception 'dealapp residential anchor matched % times (want 1)', hits; end if;
  execute 'create or replace view public.listing_rich_attrs as ' || replace(v, o, n);
end $m$;

-- Check (executes the view): every active dealapp residential row's raw utility equals the view's.
do $c$
declare bad int; seen int;
begin
  select count(*) filter (where v.electricity is distinct from r.electricity
                             or v.water_supply is distinct from r.water_supply
                             or v.sanitation is distinct from r.sanitation),
         count(*) filter (where r.electricity is not null)
    into bad, seen
    from (select id, electricity, water_supply, sanitation from public.dealapp_residential_listings
           where active and electricity is not null order by id desc limit 2000) r
    join public.listing_rich_attrs v on v.source_table = 'dealapp_residential_listings' and v.listing_id = r.id;
  if seen = 0 then raise exception 'view check: no dealapp row with electricity was read'; end if;
  if bad > 0 then raise exception 'view check: % of % dealapp rows disagree with the raw table', bad, seen; end if;
end $c$;
