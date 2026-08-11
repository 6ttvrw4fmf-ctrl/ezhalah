-- raghdan had no listing_rich_attrs branch at all, so «وصف الموقع حسب الصك» — which the scraper now
-- captures on 268 of 342 active listings — had nowhere to go. This adds the branch.
--
-- What raghdan can truthfully fill (measured 2026-08-11, active rows): electricity 319,
-- water_supply 300, sanitation 280, latitude/longitude 167, postal_code 176, deed_location_text 268.
-- Zero `false` exists in any of its amenity booleans, so the branch is strictly true-or-NULL and no
-- COALESCE(...,false) appears anywhere below.
--
-- Columns wired to raw columns rather than hardcoded NULL (rent_now_pay_later, the separate meters,
-- balcony_terrace, laundry_room) are all NULL for raghdan today, but reading the column means a
-- future scraper change flows through automatically instead of silently hitting a NULL literal.
--
-- living_rooms / majlis_rooms are deliberately NULL, NOT r.halls. raghdan publishes no room
-- breakdown — its «عدد الغرف» is a generic total-room count, which is why the scraper already
-- refuses to store it as bedrooms. Wiring halls here would invite exactly the defect an adversarial
-- review just found in abeea, where `halls` is parsed from English prose and one listing summed
-- "Four saloons Three halls" into 7.
--
-- rega_license_status stays NULL: raghdan publishes a licence NUMBER (already carried by
-- listing_extra_attrs.license_number) but no licence STATUS. Those are different facts.
--
-- Residential only, matching the view's existing shape — all 6 current branches are residential and
-- the view covers no commercial table for any platform. raghdan_commercial's 4 deed values stay
-- unexposed, which is a fleet-wide gap, not a raghdan one.
do $$
declare def text; dupes bigint; before_rows bigint; after_rows bigint;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  select count(*) into before_rows from public.listing_rich_attrs;

  if position('raghdan_residential_listings' in def) > 0 then
    raise exception 'a raghdan branch already exists - refusing to duplicate it';
  end if;
  -- the view must still END with the dealapp branch, or the append target has moved
  if def not like '%FROM dealapp_residential_listings d%WHERE d.active;' then
    raise exception 'view tail is not the expected dealapp branch - shape changed, refusing to guess';
  end if;

  def := rtrim(rtrim(def), ';') || E'\n'
    || E'UNION ALL\n'
    || E' SELECT ''raghdan_residential_listings''::text AS source_table,\n'
    || E'    r.id AS listing_id,\n'
    || E'    NULL::text AS ac_type,\n'
    || E'    NULL::text AS kitchen_status,\n'
    || E'    NULL::text AS furnishing_level,\n'
    || E'    NULL::smallint AS parking_count,\n'
    || E'    NULL::text AS parking_type,\n'
    || E'    r.rent_now_pay_later AS installment_available,\n'
    || E'        CASE\n'
    || E'            WHEN r.rent_now_pay_later THEN r.rent_now_pay_later_monthly::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS installment_amount,\n'
    || E'    NULL::smallint AS installment_count,\n'
    || E'    r.separate_electricity_meter,\n'
    || E'    r.separate_water_meter,\n'
    || E'    r.electricity,\n'
    || E'    r.water_supply,\n'
    || E'    r.sanitation,\n'
    || E'    r.balcony_terrace AS balcony,\n'
    || E'    r.laundry_room,\n'
    || E'    NULL::boolean AS pool,\n'
    || E'    NULL::boolean AS gym,\n'
    || E'    NULL::boolean AS garden,\n'
    || E'    NULL::smallint AS living_rooms,\n'
    || E'    NULL::smallint AS majlis_rooms,\n'
    || E'    NULL::smallint AS total_floors,\n'
    || E'    NULL::smallint AS frontage_count,\n'
    || E'        CASE\n'
    || E'            WHEN (r.additional_info ->> ''latitude''::text) ~ ''^-?[0-9.]+$''::text THEN (r.additional_info ->> ''latitude''::text)::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS latitude,\n'
    || E'        CASE\n'
    || E'            WHEN (r.additional_info ->> ''longitude''::text) ~ ''^-?[0-9.]+$''::text THEN (r.additional_info ->> ''longitude''::text)::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS longitude,\n'
    || E'    NULL::text AS rega_license_status,\n'
    || E'    NULLIF(btrim(COALESCE(r.zip_code, ''''::text)), ''''::text) AS postal_code,\n'
    || E'    NULLIF(btrim(COALESCE(r.additional_info ->> ''deed_location_text''::text, ''''::text)), ''''::text) AS deed_location_text\n'
    || E'   FROM raghdan_residential_listings r\n'
    || E'  WHERE r.active;';

  execute 'create or replace view public.listing_rich_attrs as ' || def;

  -- POST-CONDITION. (source_table, listing_id) must stay 1:1. Downstream consumers resolve this key
  -- with DISTINCT ON and no tiebreak, so a duplicated key is not an error there — it silently picks
  -- one arbitrarily. The sibling view listing_native_location_v2 has already shipped that exact bug
  -- once (see migration 20260809154813, souq24 double-emit, caught only as a +2 row-count gap).
  -- Assert it here, where it still fails loudly.
  select count(*) into dupes from (
    select 1 from public.listing_rich_attrs group by source_table, listing_id having count(*) > 1
  ) q;
  if dupes > 0 then
    raise exception 'view now emits % duplicated (source_table, listing_id) keys', dupes;
  end if;

  select count(*) into after_rows from public.listing_rich_attrs;
  if after_rows <= before_rows then
    raise exception 'row count did not grow (% -> %) - the branch matched nothing', before_rows, after_rows;
  end if;
  raise notice 'listing_rich_attrs: % -> % rows', before_rows, after_rows;
end $$;
