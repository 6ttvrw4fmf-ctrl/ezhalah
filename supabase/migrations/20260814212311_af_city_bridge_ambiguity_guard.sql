-- EXACT-LOCATION-ONLY repair (owner PERMANENT rule) — proven live 2026-08-15.
--
-- DEFECT: the city_tokens CTE expands an input city through city_name_bridge with no uniqueness
-- requirement. The bridge is built from observed (city_en, city_ar) pairs in listing rows, and those
-- pairs are noisy at the source: norm_en_place('Riyadh') alone maps to NINETEEN distinct Arabic
-- cities (الخبر, جازان, خميس مشيط, عنيزة, …), and 85 English keys are ambiguous this way. So
-- p_cities=['Riyadh'] returned rows from 11 different cities where p_cities=['الرياض'] returns 1 —
-- a silent cross-city fan-out, i.e. exactly the "never invent a location" rule this project treats
-- as permanent. It sits inside all FOUR shared surfaces, so results AND every chip count inherit it.
--
-- FIX: the bridge arm now contributes ONLY when the English key is UNAMBIGUOUS (resolves to exactly
-- one canonical Arabic city). An ambiguous English key contributes nothing, so the raw input simply
-- fails to match any Arabic city_ar → an HONEST ZERO instead of a fabricated multi-city result set.
-- Unambiguous English (the legitimate bridge use) is untouched.
--
-- Applied to all 4 templates through the sanctioned path (edit templates → rebuild_af_filter_rpcs),
-- never by hand-editing a function. Every step is asserted; any mismatch aborts the whole migration.
do $do$
declare
  needle text := $n$  ), city_tokens as (
    select normalize_ar(c) as tok from unnest(coalesce(p_cities, '{}')) c
    union
    select normalize_ar(b.city_ar)
    from unnest(coalesce(p_cities, '{}')) c
    join city_name_bridge b on norm_en_place(b.city_en) = norm_en_place(c)$n$;
  repl text := $r$  ), city_tokens as (
    select normalize_ar(c) as tok from unnest(coalesce(p_cities, '{}')) c
    union
    -- AMBIGUITY GUARD (2026-08-15): only bridge an English name that resolves to exactly ONE
    -- canonical Arabic city. The bridge is source-observed and noisy ('Riyadh' → 19 distinct
    -- Arabic cities), so an unguarded join fans a single city request out across the country.
    select normalize_ar(b.city_ar)
    from unnest(coalesce(p_cities, '{}')) c
    join city_name_bridge b on norm_en_place(b.city_en) = norm_en_place(c)
    where (select count(distinct normalize_ar(b2.city_ar))
             from city_name_bridge b2
            where norm_en_place(b2.city_en) = norm_en_place(c)) = 1$r$;
  n_alt int := 0; occ int; t record; newt text;
begin
  -- The block must appear EXACTLY once per template, in all four, or the shape assumed here is stale.
  for t in select fn_name, template from af_rpc_templates loop
    occ := (length(t.template) - length(replace(t.template, needle, ''))) / nullif(length(needle),0);
    if occ <> 1 then
      raise exception 'ABORT: % has % occurrences of the city_tokens block, expected exactly 1', t.fn_name, occ;
    end if;
    newt := replace(t.template, needle, repl);
    update af_rpc_templates set template = newt where fn_name = t.fn_name;
    n_alt := n_alt + 1;
  end loop;
  if n_alt <> 4 then raise exception 'ABORT: patched % templates, expected 4', n_alt; end if;

  perform * from rebuild_af_filter_rpcs();

  -- BEHAVIOURAL ASSERTIONS ------------------------------------------------------------------
  -- 1. the Arabic path (every real user request) must be byte-for-byte unchanged
  if (select af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'],
        p_cities:=array['الرياض'], p_category:='Residential')) <> 8458 then
    raise exception 'ABORT: Arabic الرياض count changed — expected 8458, got %',
      (select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential'));
  end if;
  -- 2. the ambiguous English key must no longer fan out (it resolves to nothing → honest zero)
  if (select count(distinct city_ar) from location_search_candidates_ar(p_deal:='إيجار',
        p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['Riyadh'],
        p_category:='Residential', p_limit:=20000)) > 1 then
    raise exception 'ABORT: English Riyadh still fans out across multiple cities';
  end if;
  raise notice 'SUCCESS: bridge ambiguity guard live on 4 surfaces; Arabic path unchanged (8458).';
end $do$;