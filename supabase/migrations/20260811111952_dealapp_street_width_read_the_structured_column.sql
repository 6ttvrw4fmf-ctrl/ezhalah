-- BROKEN MAPPING, not a missing one: dealapp street width reached 0 of 710 cohort rows.
--
-- The branch reads additional_info->>'street_width', but dealapp publishes that key with an Arabic
-- unit suffix ("15 متر"), so the `~ '^[0-9]+(\.[0-9]+)?$'` guard rejects every value — correctly,
-- since a guard that accepted it would have to strip prose. Meanwhile dealapp ALSO populates the
-- structured smallint column street_width_m on 4,791 active rows, which this branch never read.
--
-- Fix reads the STRUCTURED column first and keeps the prose key only as a fallback. That is the
-- house rule — prose must never override a structured source field — applied in the one direction
-- that matters here: the column is the published number, the string is its display rendering.
--
-- 0 stays NULL, not zero: dealapp prints "0 متر" on 485 rows, which is its blank, not a
-- zero-metre street.
do $$
declare def text; old text; new text; n int;
begin
  select pg_get_viewdef('public.listing_extra_attrs'::regclass, true) into def;

  old := E'        CASE\n'
      || E'            WHEN COALESCE(a.additional_info ->> ''street_width''::text, a.additional_info ->> ''street_width_m''::text) ~ ''^[0-9]+(\\.[0-9]+)?$''::text THEN COALESCE(a.additional_info ->> ''street_width''::text, a.additional_info ->> ''street_width_m''::text)::numeric::smallint\n'
      || E'            ELSE NULL::smallint\n'
      || E'        END AS street_width_m,\n'
      || E'    NULL::integer AS floor_number,\n'
      || E'    NULL::text AS tenant_category,\n'
      || E'    NULLIF(btrim(COALESCE(a.additional_info ->> ''rega_ad_license_number''::text, ''''::text)), ''''::text) AS license_number,';

  if position(old in def) = 0 then
    raise exception 'dealapp street_width anchor not found verbatim - refusing to guess';
  end if;
  n := (select count(*) from regexp_matches(def, regexp_replace(
        'NULL::integer AS floor_number', '([().*+?\[\]])', '\\\1', 'g'), 'g'));

  new := E'        CASE\n'
      || E'            WHEN a.street_width_m > 0 THEN a.street_width_m\n'
      || E'            WHEN COALESCE(a.additional_info ->> ''street_width''::text, a.additional_info ->> ''street_width_m''::text) ~ ''^[0-9]+(\\.[0-9]+)?$''::text THEN NULLIF(COALESCE(a.additional_info ->> ''street_width''::text, a.additional_info ->> ''street_width_m''::text)::numeric::smallint, 0::smallint)\n'
      || E'            ELSE NULL::smallint\n'
      || E'        END AS street_width_m,\n'
      || E'    NULL::integer AS floor_number,\n'
      || E'    NULL::text AS tenant_category,\n'
      || E'    NULLIF(btrim(COALESCE(a.additional_info ->> ''rega_ad_license_number''::text, ''''::text)), ''''::text) AS license_number,';

  def := replace(def, old, new);
  if position('WHEN a.street_width_m > 0 THEN a.street_width_m' in def) = 0 then
    raise exception 'rewrite did not take';
  end if;

  execute 'create or replace view public.listing_extra_attrs as ' || def;
end $$;
