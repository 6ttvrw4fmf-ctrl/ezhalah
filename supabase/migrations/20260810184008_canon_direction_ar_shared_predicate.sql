-- ONE canonical direction resolver, shared by every layer.
--
-- norm_direction_ar() already folds gender ('شرقية' -> 'شرق') but emits
-- 'شمال شرق' and 'جنوب - شرق', neither of which matches the 8 values the sync
-- whitelist and af_field_registry accept. Two spellings of the same concept in
-- two layers is exactly how a filter silently drops rows, so the mapping lives
-- in one function that both sides call.
--
-- Anything that is not a compass bearing returns NULL - never a guess.
-- In particular «ثلاثة/اربعة شوارع» is a FRONTAGE COUNT, a different fact, and
-- must never leak into direction (it belongs in frontage_count).
create or replace function public.canon_direction_ar(t text)
returns text language sql immutable as $$
  select case public.norm_direction_ar(nullif(btrim(coalesce(t,'')),''))
    when 'شمال' then 'شمال'
    when 'جنوب' then 'جنوب'
    when 'شرق'  then 'شرق'
    when 'غرب'  then 'غرب'
    when 'شمال شرق'   then 'شمال شرقي'
    when 'شمال - شرق' then 'شمال شرقي'
    when 'شمال غرب'   then 'شمال غربي'
    when 'شمال - غرب' then 'شمال غربي'
    when 'جنوب شرق'   then 'جنوب شرقي'
    when 'جنوب - شرق' then 'جنوب شرقي'
    when 'جنوب غرب'   then 'جنوب غربي'
    when 'جنوب - غرب' then 'جنوب غربي'
    -- already-canonical inputs pass straight through
    when 'شمال شرقي' then 'شمال شرقي'
    when 'شمال غربي' then 'شمال غربي'
    when 'جنوب شرقي' then 'جنوب شرقي'
    when 'جنوب غربي' then 'جنوب غربي'
    -- English, as published by wasalt's panel
    when 'North' then 'شمال'      when 'South' then 'جنوب'
    when 'East'  then 'شرق'       when 'West'  then 'غرب'
    when 'North East' then 'شمال شرقي' when 'North West' then 'شمال غربي'
    when 'South East' then 'جنوب شرقي' when 'South West' then 'جنوب غربي'
    else null
  end;
$$;

comment on function public.canon_direction_ar(text) is
  'The single direction contract: any source spelling -> one of the 8 canonical bearings, or NULL. Never guesses. «ثلاثة شوارع» is a frontage count, not a direction, and correctly returns NULL here.';
