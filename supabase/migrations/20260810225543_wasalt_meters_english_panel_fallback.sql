-- Wasalt separate water/electricity meters: recover the coverage already sitting in the English panel.
--
--     ar_data.additionalAttributes   52,308
--     additional_info (English)      62,620   <- +10,312 per meter, already stored, no fetch cost
--
-- Implemented by UNION-ing the two attribute arrays inside the existing lookup rather than bolting a
-- second COALESCE around it. ar_data is listed FIRST and the lookup is LIMIT 1, so Arabic remains
-- authoritative and English can only fill a genuine gap — it can never overrule a published Arabic
-- value. The CASE learns the English vocabulary (Yes/No) alongside the Arabic (نعم/لا); anything
-- else still falls through to NULL, so an unrecognised value is never coerced into a false.
--
-- Concepts stay separate: electricityMeter and waterMeter are read independently and never merged,
-- even though they almost always agree.
do $$
declare def text; n_case int; n_from int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  -- 1. teach the CASE the English vocabulary (applies to both meter lookups)
  def := replace(def,
    E'WHEN ''نعم''::text THEN true\n                    WHEN ''لا''::text THEN false',
    E'WHEN ''نعم''::text THEN true\n                    WHEN ''Yes''::text THEN true\n                    WHEN ''لا''::text THEN false\n                    WHEN ''No''::text THEN false');

  -- 2. widen the source array: Arabic first (authoritative), English appended as gap-filler
  def := replace(def,
    E'FROM jsonb_array_elements(w.ar_data -> ''additionalAttributes''::text) e(value)\n          WHERE (e.value ->> ''key''::text) = ''electricityMeter''::text',
    E'FROM ( SELECT value FROM jsonb_array_elements(w.ar_data -> ''additionalAttributes''::text)\n                  UNION ALL\n                  SELECT value FROM jsonb_array_elements(w.additional_info)) e(value)\n          WHERE (e.value ->> ''key''::text) = ''electricityMeter''::text');
  def := replace(def,
    E'FROM jsonb_array_elements(w.ar_data -> ''additionalAttributes''::text) e(value)\n          WHERE (e.value ->> ''key''::text) = ''waterMeter''::text',
    E'FROM ( SELECT value FROM jsonb_array_elements(w.ar_data -> ''additionalAttributes''::text)\n                  UNION ALL\n                  SELECT value FROM jsonb_array_elements(w.additional_info)) e(value)\n          WHERE (e.value ->> ''key''::text) = ''waterMeter''::text');

  n_case := (select count(*) from regexp_matches(def, 'WHEN ''Yes''::text THEN true', 'g'));
  n_from := (select count(*) from regexp_matches(def, 'UNION ALL\s*SELECT value FROM jsonb_array_elements\(w\.additional_info\)', 'g'));
  if n_case < 1 or n_from <> 2 then
    raise exception 'meter fallback: CASE arms=%, unioned lookups=% (expected >=1 and exactly 2) - view shape changed, refusing a partial change', n_case, n_from;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def;
end $$;
