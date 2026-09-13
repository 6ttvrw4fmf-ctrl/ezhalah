-- Owner rule 2026-09-13: our own district picker must never show a number. Option A (fold onto an
-- official catalog parent) cleared the easy cases, but left duplicates where the clean twin exists
-- only as LIVE data, not in the official catalog — e.g. الاحساء offered the user BOTH "النخيل" and
-- "النخيل1", BOTH "الزهراء" and "الزهراء ١"/"الزهراء 4". Owner saw exactly this in the picker.
--
-- A blanket "fold onto any live twin" rule is NOT safe: that is precisely what merged جازان's
-- genuinely distinct المحمدية 1/2/3 earlier today (reverted in 20260913201221), which
-- scripts/lib/districtCatalog.ts documents as real, separate neighbourhoods. جازان also has a live
-- "المحمدية" twin, so twin-existence alone cannot tell the two situations apart.
--
-- So the override is an EXPLICIT, NAMED list — one verified fact per row, the same method used for
-- every district fix this session — never a pattern. Each entry below was checked individually:
-- the numbered form and the clean form are the same place in الاحساء, and the clean form is already
-- in the picker, so the numbered one is a pure duplicate.
--
-- The property CARD is untouched in every case: `neighborhood` keeps the source's own text,
-- number and all. Only the match/display value changes, so the listings stay reachable under the
-- clean name.
create table if not exists public.loc_district_number_override (
  city_id       integer not null,
  district_norm text    not null,
  display_ar    text    not null,
  why           text    not null,
  added_at      timestamptz not null default now(),
  primary key (city_id, district_norm)
);

comment on table public.loc_district_number_override is
  'Named, one-fact-per-row overrides folding a numbered district value onto its clean twin, for '
  'cases the official-catalog rule in refresh_loc_display_district_canon() cannot reach. NEVER add '
  'a row without checking that the two names are the same real place — a wrong row silently merges '
  'two genuinely different neighbourhoods (see جازان المحمدية 1/2/3 in scripts/lib/districtCatalog.ts).';

insert into public.loc_district_number_override (city_id, district_norm, display_ar, why) values
  (3677, norm_district_tok('النخيل1'),                'النخيل',    'الاحساء already lists "النخيل"; "النخيل1" is the same neighbourhood written with a sub-plot number'),
  (3677, norm_district_tok('النزهة1'),                'حي النزهة', 'الاحساء already lists "حي النزهة"; "النزهة1" is the same neighbourhood'),
  (3677, norm_district_tok('اليرموك1'),               'اليرموك',   'الاحساء already lists "اليرموك"; "اليرموك1" is the same neighbourhood'),
  (3677, norm_district_tok('الروضة2'),                'حي الروضة', 'الاحساء already lists "حي الروضة"; "الروضة2" is the same neighbourhood'),
  (3677, norm_district_tok('الزهراء ١'),              'الزهراء',   'الاحساء already lists "الزهراء"; "الزهراء ١" (Arabic-Indic 1) is the same neighbourhood'),
  (3677, norm_district_tok('الزهراء 4'),              'الزهراء',   'الاحساء already lists "الزهراء"; "الزهراء 4" is the same neighbourhood'),
  (3677, norm_district_tok('الريان - النسيم3'),       'حي النسيم', 'hajer plan-style label for حي النسيم in الاحساء; the clean name is already listed'),
  (3677, norm_district_tok('الحزام الأخضر- النسيم2'), 'حي النسيم', 'hajer plan-style label for حي النسيم in الاحساء; the clean name is already listed')
on conflict (city_id, district_norm) do update
  set display_ar = excluded.display_ar, why = excluded.why;

-- Wire the override in at the HIGHEST priority, ahead of the official-catalog fold.
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
           coalesce(o.display_ar, f.parent_display, d.district_ar, b.label) as display_ar,
           (o.display_ar is null and f.parent_display is null and d.district_ar is not null) as from_catalog,
           (o.display_ar is not null or f.parent_display is not null) as is_fold
      from best b
      left join public.loc_catalog_district d
        on d.city_id = b.city_id and d.district_norm = b.tok
      left join fold f
        on f.city_id = b.city_id and f.tok = b.tok and f.parent_display is not null
      left join public.loc_district_number_override o
        on o.city_id = b.city_id and o.district_norm = b.tok
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

do $verify$
declare v_bad int;
begin
  perform public.refresh_loc_display_district_canon();
  -- the over-correction guard stays: جازان's genuine numbered districts must never fold
  select count(*) into v_bad
    from public.loc_display_district_canon k
   where k.city_id = 17
     and k.district_norm in (norm_district_tok('المحمدية 1'), norm_district_tok('المحمدية 2'),
                             norm_district_tok('المحمدية 3'), norm_district_tok('الرحاب 1'),
                             norm_district_tok('الرحاب 2'))
     and norm_district_tok(k.display_ar) <> k.district_norm;
  if v_bad > 0 then
    raise exception 'over-correction guard: % of جازان''s genuine numbered districts were folded', v_bad;
  end if;
end $verify$;