-- Owner rule 2026-09-13: the district PICKER must never show a number. The number may appear on the
-- property CARD (neighborhood = the source's own text, untouched) — never in our own list.
--
-- Implemented where it fixes every platform at once instead of 23 scrapers: refresh_loc_display_
-- district_canon() already maps a normalized district token -> the label we display/match on, and
-- sync_search_listings_ar() feeds search_listings_ar (and therefore the picker) through it.
--
-- Owner's explicit scope decision: fold a numbered label ONLY onto a parent that DEMONSTRABLY
-- EXISTS — either an official loc_catalog_district entry for that city, or another live district in
-- the same city. Districts whose number IS their identity therefore keep it automatically, because
-- de-numbering them yields no parent: الليث's "حي رقم 1".."حي رقم 10" ("District No. N") would
-- collapse to the meaningless "حي رقم", and أبها/السودة's "حي ج 34/35" to "حي ج" — neither exists,
-- so neither folds, and those districts stay selectable. Nothing is ever invented: the parent label
-- is always a name that already exists in the catalog or in live data.
--
-- Folding MERGES the numbered listings into their parent, so picking the clean name returns them —
-- no listing becomes unreachable, and no card text changes.
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
    select nb.city_id, nb.tok,
           coalesce(
             (select d.district_ar from public.loc_catalog_district d
               where d.city_id = nb.city_id and d.district_norm = nb.bare_tok limit 1),
             (select b2.label from best b2
               where b2.city_id = nb.city_id and b2.tok = nb.bare_tok limit 1)
           ) as parent_display
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