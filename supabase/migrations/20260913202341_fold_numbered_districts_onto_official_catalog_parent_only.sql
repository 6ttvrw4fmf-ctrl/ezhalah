-- Owner decision 2026-09-13 (option A): a numbered district value folds onto its clean name ONLY
-- when that clean name already exists in OUR OWN OFFICIAL catalog (loc_catalog_district) for that
-- city. Anything else keeps its number.
--
-- Why this is the safe rule, and not "strip every digit": scripts/lib/districtCatalog.ts records an
-- evidence-backed invariant from 2026-09-11 — جازان's "المحمدية 1/2/3" and "الرحاب 1/2" are
-- GENUINELY DIFFERENT officially numbered neighbourhoods, and merging them is a documented
-- over-correction. Neither "المحمدية" nor "الرحاب" exists in the official catalog for جازان, so
-- under this rule they cannot fold — the invariant is protected by construction, not by a hand-kept
-- exception list. Same for الليث's "حي رقم 1".."حي رقم 10" and أبها/السودة's "حي ج 34/35", whose
-- de-numbered forms ("حي رقم", "حي ج") are not catalog districts either.
--
-- What it DOES fix is the owner's actual complaint: a source writing "النسيم 2" in الهفوف, where
-- "حي النسيم" IS an official catalog district — the picker stops offering both, and the numbered
-- listings merge into the official name so they stay reachable. The property CARD is untouched:
-- `neighborhood` still shows the source's own text, number and all.
CREATE OR REPLACE FUNCTION public.refresh_loc_display_district_canon()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare v_n bigint;
begin
  with src as (
    select s.city_id, norm_district_tok(s.district_ar) tok, s.district_ar label, count(*) n
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null and s.city_id is not null
     group by 1,2,3),
  best as (
    select distinct on (city_id, tok) city_id, tok, label
      from src
     order by city_id, tok, n desc, (label like 'حي %') desc, length(label) desc, label
  ),
  numbered as (
    select b.city_id, b.tok, b.label,
           norm_district_tok(btrim(regexp_replace(b.label, '[[:space:]]*[0-9٠-٩]+[[:space:]]*$', ''))) as bare_tok
      from best b
     where b.label ~ '[0-9٠-٩][[:space:]]*$'
  ),
  fold as (
    -- OFFICIAL-CATALOG PARENT ONLY. There is deliberately no "another live district" fallback:
    -- that is exactly what merged جازان's real numbered neighbourhoods on the first attempt.
    select nb.city_id, nb.tok,
           (select d.district_ar from public.loc_catalog_district d
             where d.city_id = nb.city_id and d.district_norm = nb.bare_tok limit 1) as parent_display
      from numbered nb
     where nb.bare_tok is not null and length(nb.bare_tok) >= 2 and nb.bare_tok <> nb.tok
  ),
  merged as (
    select b.city_id, b.tok,
           coalesce(f.parent_display, d.district_ar, b.label) as display_ar,
           (f.parent_display is null and d.district_ar is not null) as from_catalog,
           (f.parent_display is not null) as is_fold
      from best b
      left join public.loc_catalog_district d
        on d.city_id = b.city_id and d.district_norm = b.tok
      left join fold f
        on f.city_id = b.city_id and f.tok = b.tok and f.parent_display is not null
  )
  insert into public.loc_display_district_canon (city_id, district_norm, display_ar, from_catalog, refreshed_at)
  select city_id, tok, display_ar, from_catalog, now() from merged
  where is_fold or norm_district_tok(display_ar) = tok
  on conflict (city_id, district_norm) do update
    set display_ar = excluded.display_ar,
        from_catalog = excluded.from_catalog,
        refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- Prove, in the same migration, that the documented genuine-numbered districts are untouched by
-- this rule: none of them may acquire a fold mapping (a row whose display token differs from its
-- own token). Mirrors scripts/lib/districtCatalog.ts EXPECTED_DISTINCT.
do $verify$
declare v_bad int;
begin
  perform public.refresh_loc_display_district_canon();
  select count(*) into v_bad
    from public.loc_display_district_canon k
   where k.city_id = 17
     and k.district_norm in (norm_district_tok('المحمدية 1'), norm_district_tok('المحمدية 2'),
                             norm_district_tok('المحمدية 3'), norm_district_tok('الرحاب 1'),
                             norm_district_tok('الرحاب 2'))
     and norm_district_tok(k.display_ar) <> k.district_norm;
  if v_bad > 0 then
    raise exception 'over-correction guard: % of جازان''s genuine numbered districts (EXPECTED_DISTINCT '
      'in scripts/lib/districtCatalog.ts) were folded onto another name. They are real, distinct '
      'neighbourhoods and must stay selectable.', v_bad;
  end if;
end $verify$;