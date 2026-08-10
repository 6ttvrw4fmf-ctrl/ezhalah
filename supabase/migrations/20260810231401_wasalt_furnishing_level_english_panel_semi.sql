-- wasalt furnishing_level: read the English panel, and give «Semi-Furnished» a home.
--
-- MEASURED FIRST, cohort-scoped (Rule 0). Within the SEARCHABLE Annual Rent -> Apartment cohort:
--     8,577 listings · 5 have furnishing data · all 5 are "Un-Furnished" · Semi-Furnished = ZERO
--     and all 5 already reach search.
-- So the handoff item "map the 62 Semi-Furnished values" is worth exactly 0 rows to the Advanced
-- Filter cohort — that 62 was a fleet-wide count and the Semi rows are Buy/other types. Recorded
-- plainly rather than quietly booked as a win.
--
-- It IS still worth doing, for the architecture goal ("capture every trustworthy structured fact,
-- even where we do not expose it"): ACTIVE wasalt rows carry 1,901 Un-Furnished, 55 Furnished and
-- 46 Semi-Furnished that currently land nowhere, because this branch reads ar_data only and ar_data
-- has none of it for these rows.
--
-- «Semi-Furnished» goes to furnishing_level ONLY. The boolean `furnished` deliberately stays NULL for
-- it — "partially furnished" cannot truthfully collapse to yes or no, and forcing it either way is
-- the concept-merge the rules forbid. That is already the live behaviour in listing_extra_attrs
-- (its CASE lists only Furnished/Un-Furnished, so Semi falls through to NULL); this migration does
-- not disturb it, it just stops discarding the richer value.
--
-- Arabic stays authoritative: COALESCE tries the ar_data CASE first and only falls back to English.
do $$
declare def text; n int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  def := replace(def,
    E'        CASE (w.ar_data -> ''attributes''::text) ->> ''furnishingType''::text\n'
    || E'            WHEN ''مفروشة''::text THEN ''مفروش بالكامل''::text\n'
    || E'            WHEN ''مفروش''::text THEN ''مفروش بالكامل''::text\n'
    || E'            WHEN ''غير مفروشة''::text THEN ''غير مفروش''::text\n'
    || E'            WHEN ''غير مفروش''::text THEN ''غير مفروش''::text\n'
    || E'            WHEN ''مفروشة جزئيا''::text THEN ''مفروش جزئيا''::text\n'
    || E'            ELSE NULL::text\n'
    || E'        END AS furnishing_level,',
    E'    COALESCE(\n'
    || E'        CASE (w.ar_data -> ''attributes''::text) ->> ''furnishingType''::text\n'
    || E'            WHEN ''مفروشة''::text THEN ''مفروش بالكامل''::text\n'
    || E'            WHEN ''مفروش''::text THEN ''مفروش بالكامل''::text\n'
    || E'            WHEN ''غير مفروشة''::text THEN ''غير مفروش''::text\n'
    || E'            WHEN ''غير مفروش''::text THEN ''غير مفروش''::text\n'
    || E'            WHEN ''مفروشة جزئيا''::text THEN ''مفروش جزئيا''::text\n'
    || E'            ELSE NULL::text\n'
    || E'        END,\n'
    || E'        CASE ( SELECT e3.value ->> ''value''::text\n'
    || E'                 FROM jsonb_array_elements(w.additional_info) e3(value)\n'
    || E'                WHERE (e3.value ->> ''key''::text) = ''furnishingType''::text\n'
    || E'               LIMIT 1)\n'
    || E'            WHEN ''Furnished''::text THEN ''مفروش بالكامل''::text\n'
    || E'            WHEN ''Un-Furnished''::text THEN ''غير مفروش''::text\n'
    || E'            WHEN ''Semi-Furnished''::text THEN ''مفروش جزئيا''::text\n'
    || E'            ELSE NULL::text\n'
    || E'        END) AS furnishing_level,');

  n := (select count(*) from regexp_matches(def, 'WHEN ''Semi-Furnished''::text THEN ''مفروش جزئيا''', 'g'));
  if n <> 1 then
    raise exception 'wasalt furnishing_level anchor matched % times (expected 1) - view shape changed, refusing to guess', n;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def;
end $$;
