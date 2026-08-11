-- Make listing_rich_attrs FLEET-WIDE, the way listing_extra_attrs already is.
--
-- The barrier added minutes ago immediately caught what hand-writing branches was always going to
-- miss: 14 more platforms in the Annual Rent -> Apartment cohort had no branch, so their captured
-- utilities were stranded — aqaratikom (43 cohort rows, electricity on 107 active), mizlaj, souq24,
-- sadin, fursaghyr, erapulse, dealapp_commercial. Writing seven more branches by hand would have
-- left the same trap for platform number 15.
--
-- All 41 remaining source tables in search_listings_ar share ONE 70-column template, so the generic
-- branch below is generated for each. Bespoke branches (aqar, wasalt, sanadak, satel, aqarcity,
-- dealapp, raghdan, abeea, eastabha) are untouched — they read platform-specific JSONB the template
-- cannot know about.
--
-- Every generated column is a DIRECT column read. Nothing is inferred, nothing is derived.
--
-- living_rooms is deliberately NULL even though every table has a `halls` column. Its provenance is
-- not uniform: abeea's `halls` is parsed from English prose and merges concepts (one listing reads
-- "Four saloons Three halls" and stored 7). Blanket-mapping an unproven column fleet-wide is exactly
-- the "parser uncertainty -> NULL" rule. majlis_rooms IS mapped: reception_rooms_majlis is a
-- dedicated structured column, not a prose parse.
do $$
declare def text; t text; n int := 0; dupes bigint; before_rows bigint; after_rows bigint;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  select count(*) into before_rows from public.listing_rich_attrs;
  def := rtrim(rtrim(def), ';');

  for t in
    with plats as materialized (select distinct source_table st from public.search_listings_ar),
         std as (select table_name,
                   count(*) filter (where column_name in
                     ('electricity','water_supply','sanitation','balcony_terrace','laundry_room',
                      'separate_electricity_meter','separate_water_meter','rent_now_pay_later',
                      'rent_now_pay_later_monthly','reception_rooms_majlis','zip_code',
                      'additional_info','active','id')) hits
                 from information_schema.columns group by 1)
    select p.st from plats p join std s on s.table_name = p.st
     where s.hits = 14 order by p.st
  loop
    continue when position(t in def) > 0;   -- already has a bespoke branch
    n := n + 1;
    def := def || E'\nUNION ALL\n'
      || format(E' SELECT %L::text AS source_table,\n', t)
      || E'    x.id AS listing_id,\n'
      || E'    NULL::text AS ac_type,\n'
      || E'    NULL::text AS kitchen_status,\n'
      || E'    NULL::text AS furnishing_level,\n'
      || E'    NULL::smallint AS parking_count,\n'
      || E'    NULL::text AS parking_type,\n'
      || E'    x.rent_now_pay_later AS installment_available,\n'
      || E'        CASE\n'
      || E'            WHEN x.rent_now_pay_later THEN x.rent_now_pay_later_monthly::numeric\n'
      || E'            ELSE NULL::numeric\n'
      || E'        END AS installment_amount,\n'
      || E'    NULL::smallint AS installment_count,\n'
      || E'    x.separate_electricity_meter,\n'
      || E'    x.separate_water_meter,\n'
      || E'    x.electricity,\n'
      || E'    x.water_supply,\n'
      || E'    x.sanitation,\n'
      || E'    x.balcony_terrace AS balcony,\n'
      || E'    x.laundry_room,\n'
      || E'    NULL::boolean AS pool,\n'
      || E'    NULL::boolean AS gym,\n'
      || E'    NULL::boolean AS garden,\n'
      || E'    NULL::smallint AS living_rooms,\n'
      || E'    x.reception_rooms_majlis AS majlis_rooms,\n'
      || E'    NULL::smallint AS total_floors,\n'
      || E'    NULL::smallint AS frontage_count,\n'
      || E'    NULL::numeric AS latitude,\n'
      || E'    NULL::numeric AS longitude,\n'
      || E'    NULL::text AS rega_license_status,\n'
      || E'    NULLIF(btrim(COALESCE(x.zip_code, ''''::text)), ''''::text) AS postal_code,\n'
      || E'    NULL::text AS deed_location_text\n'
      || format(E'   FROM %I x\n', t)
      || E'  WHERE x.active';
  end loop;

  if n = 0 then
    raise notice 'no unmapped standard tables - nothing to generate';
    return;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def || ';';

  select count(*) into dupes from (
    select 1 from public.listing_rich_attrs group by source_table, listing_id having count(*) > 1
  ) q;
  if dupes > 0 then
    raise exception 'view now emits % duplicated (source_table, listing_id) keys', dupes;
  end if;

  select count(*) into after_rows from public.listing_rich_attrs;
  raise notice 'generated % branches; listing_rich_attrs % -> % rows', n, before_rows, after_rows;
end $$;
