-- Wasalt direction: read the ENGLISH panel as a fallback. Already stored — no detail fetch, no cost.
--
-- I mapped wasalt from ar_data (Arabic) and used the English `additional_info` panel only for
-- furnished. Measuring both properly, the English panel has far better coverage — it was populated by
-- an earlier enrichment pass that reached many more listings:
--       propertyFacade    ar_data 8,202   vs   English panel 58,727
-- which is directions 1,910 -> ~33,991 and (separately) frontage 7,155 -> ~24,736.
--
-- Arabic stays authoritative and is tried FIRST; English only fills a gap. Neither overrules the
-- other, and a listing the source never described stays NULL.
--
-- propertyFacade carries the SAME two concepts in English as in Arabic: "North"/"East"/... are
-- bearings, "3 Streets"/"4 Streets" are a FRONTAGE COUNT. canon_direction_ar() returns NULL for the
-- street forms, so a frontage count still cannot leak into direction.
--
-- NOTE for future edits: pg_get_viewdef() prints these calls WITHOUT the `public.` schema prefix, so
-- a regex anchored on `public\.canon_direction_ar` silently matches nothing. It cost me one refused
-- migration to notice; the guard below is what caught it.
do $$
declare def text; n int;
begin
  select pg_get_viewdef('public.listing_extra_attrs'::regclass, true) into def;

  def := replace(def,
    E'canon_direction_ar(( SELECT e.value ->> ''value''::text\n           FROM jsonb_array_elements(w.ar_data -> ''additionalAttributes''::text) e(value)\n          WHERE (e.value ->> ''key''::text) = ''propertyFacade''::text\n         LIMIT 1)) AS direction,',
    E'COALESCE(canon_direction_ar(( SELECT e.value ->> ''value''::text\n           FROM jsonb_array_elements(w.ar_data -> ''additionalAttributes''::text) e(value)\n          WHERE (e.value ->> ''key''::text) = ''propertyFacade''::text\n         LIMIT 1)), canon_direction_ar(( SELECT e2.value ->> ''value''::text\n           FROM jsonb_array_elements(w.additional_info) e2(value)\n          WHERE (e2.value ->> ''key''::text) = ''propertyFacade''::text\n         LIMIT 1))) AS direction,');

  n := (select count(*) from regexp_matches(def, 'e2\.value ->> ''key''::text\) = ''propertyFacade', 'g'));
  if n <> 2 then
    raise exception 'wasalt direction fallback applied to % branches (expected 2: residential + commercial) - refusing a partial change', n;
  end if;

  execute 'create or replace view public.listing_extra_attrs as ' || def;
end $$;
