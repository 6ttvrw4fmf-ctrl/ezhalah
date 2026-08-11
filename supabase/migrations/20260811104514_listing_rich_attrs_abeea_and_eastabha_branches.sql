-- abeea and eastabha were the last two cohort platforms with no listing_rich_attrs branch, so their
-- utilities, balcony, laundry, pool/gym/garden and coordinates were captured but STRANDED — sitting
-- in raw columns no view read.
--
-- Measured 2026-08-11 (active rows):
--   abeea    elec 84, water 84, sanit 75, balcony 12, laundry 35, zip 131,
--            pool 12, garden 10, gym 5 (from additional_info.features slugs)
--   eastabha elec 89, water 87, balcony 15, laundry 34, garden 16, pool 4, gym 5
--
-- THREE CORRECTIONS from an adversarial review, each one a rule this project already holds:
--
-- 1. abeea living_rooms is NULL, NOT abeea.halls. abeea publishes no room-count field anywhere; the
--    stored `halls` is parsed from English prose and merges concepts — listing 7124565 reads
--    "Four saloons Three halls" and stored 7. Promoting that into living_rooms would make an
--    unvalidated prose inference indistinguishable from wasalt's published livingRooms panel.
--    (The abeea.halls column itself is a separate parser defect, reported, not fixed here.)
--
-- 2. eastabha kitchen_status is NULL, NOT 'راكب' from «مطبخ مجهز». That is a semantic COLLISION, not
--    a preference: the live satel branch already defines راكب as "with appliances" (its sibling value
--    راكب بدون أجهزة is the without-appliances case) and sanadak's enum defines it against
--    'لا يوجد'/'تأسيس'. eastabha's presence tag establishes neither distinction.
--
-- 3. eastabha garden reads «حديقة» ONLY. «فناء أمامي» (40) and «فناء خلفي» (38) are front/back YARDS,
--    are 5x more common, and are the tempting wrong answer. A yard is not a garden.
--
-- Fan-out safety: pool/gym/garden use the scalar `?` containment operator, never a lateral unnest.
-- A natural unnest of these arrays fans out 6.0x on abeea and 4.5x on eastabha, and the downstream
-- DISTINCT ON would hide it rather than fail. `?` also returns false (not an error) on the 70
-- eastabha rows whose features_ar is a JSON null rather than an array — verified — so it needs no
-- jsonb_typeof guard. Wrapped in CASE ... THEN true END so an absent tag is NULL, never false.
--
-- Where a raw boolean column exists it is the single source path for that fact. abeea's raw columns
-- and its features array already disagree by design (the ambiguous 'air-conditioning' group-header
-- term is deliberately unmapped), so mixing the two paths per fact would be incoherent.
do $$
declare def text; dupes bigint; before_rows bigint; after_rows bigint;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;
  select count(*) into before_rows from public.listing_rich_attrs;

  if position('abeea_residential_listings' in def) > 0
     or position('eastabha_residential_listings' in def) > 0 then
    raise exception 'an abeea/eastabha branch already exists - refusing to duplicate';
  end if;
  if def not like '%FROM raghdan_residential_listings r%WHERE r.active;' then
    raise exception 'view tail is not the expected raghdan branch - shape changed, refusing to guess';
  end if;

  def := rtrim(rtrim(def), ';') || E'\n'
  -- ── abeea ──────────────────────────────────────────────────────────────────
    || E'UNION ALL\n'
    || E' SELECT ''abeea_residential_listings''::text AS source_table,\n'
    || E'    b.id AS listing_id,\n'
    || E'    NULL::text AS ac_type,\n'
    || E'    NULL::text AS kitchen_status,\n'
    || E'    NULL::text AS furnishing_level,\n'
    || E'    NULL::smallint AS parking_count,\n'
    || E'    NULL::text AS parking_type,\n'
    || E'    b.rent_now_pay_later AS installment_available,\n'
    || E'        CASE\n'
    || E'            WHEN b.rent_now_pay_later THEN b.rent_now_pay_later_monthly::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS installment_amount,\n'
    || E'    NULL::smallint AS installment_count,\n'
    || E'    b.separate_electricity_meter,\n'
    || E'    b.separate_water_meter,\n'
    || E'    b.electricity,\n'
    || E'    b.water_supply,\n'
    || E'    b.sanitation,\n'
    || E'    b.balcony_terrace AS balcony,\n'
    || E'    b.laundry_room,\n'
    || E'        CASE WHEN b.additional_info -> ''features''::text ? ''swimming-pool''::text THEN true ELSE NULL::boolean END AS pool,\n'
    || E'        CASE WHEN b.additional_info -> ''features''::text ? ''gym''::text THEN true ELSE NULL::boolean END AS gym,\n'
    || E'        CASE WHEN b.additional_info -> ''features''::text ? ''garden''::text THEN true ELSE NULL::boolean END AS garden,\n'
    || E'    NULL::smallint AS living_rooms,\n'
    || E'    NULL::smallint AS majlis_rooms,\n'
    || E'    NULL::smallint AS total_floors,\n'
    || E'    NULL::smallint AS frontage_count,\n'
    || E'        CASE\n'
    || E'            WHEN (b.additional_info ->> ''latitude''::text) ~ ''^-?[0-9.]+$''::text THEN (b.additional_info ->> ''latitude''::text)::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS latitude,\n'
    || E'        CASE\n'
    || E'            WHEN (b.additional_info ->> ''longitude''::text) ~ ''^-?[0-9.]+$''::text THEN (b.additional_info ->> ''longitude''::text)::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS longitude,\n'
    || E'    NULL::text AS rega_license_status,\n'
    || E'    NULLIF(btrim(COALESCE(b.zip_code, ''''::text)), ''''::text) AS postal_code,\n'
    || E'    NULL::text AS deed_location_text\n'
    || E'   FROM abeea_residential_listings b\n'
    || E'  WHERE b.active\n'
  -- ── eastabha ───────────────────────────────────────────────────────────────
    || E'UNION ALL\n'
    || E' SELECT ''eastabha_residential_listings''::text AS source_table,\n'
    || E'    e.id AS listing_id,\n'
    || E'    NULL::text AS ac_type,\n'
    || E'    NULL::text AS kitchen_status,\n'
    || E'    NULL::text AS furnishing_level,\n'
    || E'    NULL::smallint AS parking_count,\n'
    || E'    NULL::text AS parking_type,\n'
    || E'    e.rent_now_pay_later AS installment_available,\n'
    || E'        CASE\n'
    || E'            WHEN e.rent_now_pay_later THEN e.rent_now_pay_later_monthly::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS installment_amount,\n'
    || E'    NULL::smallint AS installment_count,\n'
    || E'    e.separate_electricity_meter,\n'
    || E'    e.separate_water_meter,\n'
    || E'    e.electricity,\n'
    || E'    e.water_supply,\n'
    || E'    e.sanitation,\n'
    || E'    e.balcony_terrace AS balcony,\n'
    || E'    e.laundry_room,\n'
    || E'        CASE WHEN e.additional_info -> ''features_ar''::text ? ''مسبح''::text THEN true ELSE NULL::boolean END AS pool,\n'
    || E'        CASE WHEN e.additional_info -> ''features_ar''::text ? ''صالة رياضية''::text THEN true ELSE NULL::boolean END AS gym,\n'
    || E'        CASE WHEN e.additional_info -> ''features_ar''::text ? ''حديقة''::text THEN true ELSE NULL::boolean END AS garden,\n'
    || E'    NULL::smallint AS living_rooms,\n'
    || E'    NULL::smallint AS majlis_rooms,\n'
    || E'    NULL::smallint AS total_floors,\n'
    || E'    NULL::smallint AS frontage_count,\n'
    || E'        CASE\n'
    || E'            WHEN (e.additional_info ->> ''lat''::text) ~ ''^-?[0-9.]+$''::text THEN (e.additional_info ->> ''lat''::text)::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS latitude,\n'
    || E'        CASE\n'
    || E'            WHEN (e.additional_info ->> ''lng''::text) ~ ''^-?[0-9.]+$''::text THEN (e.additional_info ->> ''lng''::text)::numeric\n'
    || E'            ELSE NULL::numeric\n'
    || E'        END AS longitude,\n'
    || E'    NULL::text AS rega_license_status,\n'
    || E'    NULLIF(btrim(COALESCE(e.zip_code, ''''::text)), ''''::text) AS postal_code,\n'
    || E'    NULL::text AS deed_location_text\n'
    || E'   FROM eastabha_residential_listings e\n'
    || E'  WHERE e.active;';

  execute 'create or replace view public.listing_rich_attrs as ' || def;

  select count(*) into dupes from (
    select 1 from public.listing_rich_attrs group by source_table, listing_id having count(*) > 1
  ) q;
  if dupes > 0 then
    raise exception 'view now emits % duplicated (source_table, listing_id) keys', dupes;
  end if;

  select count(*) into after_rows from public.listing_rich_attrs;
  if after_rows <= before_rows then
    raise exception 'row count did not grow (% -> %)', before_rows, after_rows;
  end if;
  raise notice 'listing_rich_attrs: % -> % rows', before_rows, after_rows;
end $$;
