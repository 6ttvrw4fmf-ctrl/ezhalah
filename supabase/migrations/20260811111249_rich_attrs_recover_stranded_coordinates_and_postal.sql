-- Source-published location facts that reach nothing today:
--   sanadak  185 cohort rows carry latitude, longitude AND postalCode in source_capture; the branch
--            emitted NULL for all three.
--   dealapp  640 cohort rows carry zip_code; the branch emitted NULL postal_code.
--   generated branches  aqaratikom 132, eaqartabuk 519, mizlaj 27, fursaghyr 18 active rows carry
--            coordinates in additional_info under either 'latitude'/'longitude' or 'lat'/'lng'.
--
-- COALESCE across the two key spellings is normalisation, not concept-merging: both name the same
-- fact and differ only by platform convention. Each stays numeric-validated, so a non-numeric value
-- becomes NULL rather than an error or a guess.
--
-- 41 = the generated branches (50 total - 9 bespoke). A first attempt asserted 43, because two
-- BESPOKE branches (sanadak, satel) also emit `NULL::numeric AS latitude`; the guard rejected it.
-- The anchor below ends on `x.zip_code`, which only the generated template produces, so bespoke
-- branches cannot be caught by it.
do $$
declare def text; n int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  -- 1. generated branches (alias `x`)
  n := (select count(*) from regexp_matches(def,
        E'NULL::numeric AS latitude,\n    NULL::numeric AS longitude,\n    NULL::text AS rega_license_status,\n    NULLIF\\(btrim\\(COALESCE\\(x\\.zip_code', 'g'));
  if n <> 41 then
    raise exception 'expected 41 generated coordinate slots, found %', n;
  end if;
  def := replace(def,
    E'NULL::numeric AS latitude,\n    NULL::numeric AS longitude,\n    NULL::text AS rega_license_status,\n    NULLIF(btrim(COALESCE(x.zip_code',
    E'        CASE\n'
 || E'            WHEN COALESCE(x.additional_info ->> ''latitude''::text, x.additional_info ->> ''lat''::text) ~ ''^-?[0-9.]+$''::text THEN COALESCE(x.additional_info ->> ''latitude''::text, x.additional_info ->> ''lat''::text)::numeric\n'
 || E'            ELSE NULL::numeric\n'
 || E'        END AS latitude,\n'
 || E'        CASE\n'
 || E'            WHEN COALESCE(x.additional_info ->> ''longitude''::text, x.additional_info ->> ''lng''::text) ~ ''^-?[0-9.]+$''::text THEN COALESCE(x.additional_info ->> ''longitude''::text, x.additional_info ->> ''lng''::text)::numeric\n'
 || E'            ELSE NULL::numeric\n'
 || E'        END AS longitude,\n'
 || E'    NULL::text AS rega_license_status,\n    NULLIF(btrim(COALESCE(x.zip_code');

  -- 2. sanadak postal, then its coordinates (the postal edit creates the anchor the coord edit uses)
  if position(E'NULL::text AS rega_license_status,\n    NULL::text AS postal_code,\n    NULLIF(btrim(COALESCE(s.source_capture ->> ''locationAsPerDeed''' in def) = 0 then
    raise exception 'sanadak postal anchor not found';
  end if;
  def := replace(def,
    E'NULL::text AS rega_license_status,\n    NULL::text AS postal_code,\n    NULLIF(btrim(COALESCE(s.source_capture ->> ''locationAsPerDeed''',
    E'NULL::text AS rega_license_status,\n'
 || E'    NULLIF(btrim(COALESCE(s.source_capture ->> ''postalCode''::text, ''''::text)), ''''::text) AS postal_code,\n'
 || E'    NULLIF(btrim(COALESCE(s.source_capture ->> ''locationAsPerDeed''');

  n := (select count(*) from regexp_matches(def,
        E'NULL::numeric AS latitude,\n    NULL::numeric AS longitude,\n    NULL::text AS rega_license_status,\n    NULLIF\\(btrim\\(COALESCE\\(s\\.source_capture ->> ''postalCode''', 'g'));
  if n <> 1 then
    raise exception 'expected 1 sanadak coordinate slot, found %', n;
  end if;
  def := replace(def,
    E'NULL::numeric AS latitude,\n    NULL::numeric AS longitude,\n    NULL::text AS rega_license_status,\n    NULLIF(btrim(COALESCE(s.source_capture ->> ''postalCode''',
    E'        CASE\n'
 || E'            WHEN (s.source_capture ->> ''latitude''::text) ~ ''^-?[0-9.]+$''::text THEN (s.source_capture ->> ''latitude''::text)::numeric\n'
 || E'            ELSE NULL::numeric\n'
 || E'        END AS latitude,\n'
 || E'        CASE\n'
 || E'            WHEN (s.source_capture ->> ''longitude''::text) ~ ''^-?[0-9.]+$''::text THEN (s.source_capture ->> ''longitude''::text)::numeric\n'
 || E'            ELSE NULL::numeric\n'
 || E'        END AS longitude,\n'
 || E'    NULL::text AS rega_license_status,\n    NULLIF(btrim(COALESCE(s.source_capture ->> ''postalCode''');

  -- 3. dealapp postal from its own zip_code column
  if position(E'NULL::text AS rega_license_status,\n    NULL::text AS postal_code,\n    NULL::text AS deed_location_text,\n    d.car_entrance' in def) = 0 then
    raise exception 'dealapp anchor not found';
  end if;
  def := replace(def,
    E'NULL::text AS rega_license_status,\n    NULL::text AS postal_code,\n    NULL::text AS deed_location_text,\n    d.car_entrance',
    E'NULL::text AS rega_license_status,\n    NULLIF(btrim(COALESCE(d.zip_code, ''''::text)), ''''::text) AS postal_code,\n    NULL::text AS deed_location_text,\n    d.car_entrance');

  execute 'create or replace view public.listing_rich_attrs as ' || def;

  if (select count(*) from (select 1 from public.listing_rich_attrs
        group by source_table, listing_id having count(*) > 1) q) > 0 then
    raise exception 'duplicate keys after rewrite';
  end if;
end $$;
