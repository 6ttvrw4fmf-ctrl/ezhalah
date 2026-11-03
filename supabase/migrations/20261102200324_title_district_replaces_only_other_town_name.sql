-- NARROWED: A TITLE DISTRICT REPLACES A SOURCE DISTRICT ONLY WHEN THAT ONE IS ANOTHER TOWN'S NAME (backlog 1165/1166).
-- title_official_district_beats_offlist_source (the previous migration) let any off-list source district give way to the title's official one (6,617 decisions). Checked on
-- aqar's own pages before anything was served: aqar 6946662 shows BOTH its own neighbourhood «حي القريقر» and the address
-- «حي الروابي, مدينة أبها» — two source names, neither proven wrong, and the integrity rule is that data is corrected only
-- when the error is PROVEN (DATA_INTEGRITY_ENGINEER: weird does not mean wrong). What IS proven wrong is the town-name
-- trap: a «district» that is the name of ANOTHER TOWN of the same region, on none of the served city's official
-- districts (aqar 6739822: «حي الحناكية» on an ad served in المدينة المنورة whose title says «حي الصويدرة, مدينة المدينة
-- المنورة»). Only that case is replaced now (158 decisions); every real neighbourhood name the source gives is kept.
create or replace function public.district_is_other_town(p_city_id integer, p_district text)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_district is not null and p_city_id is not null
     and not exists (select 1 from public.loc_catalog_district d
                      where d.city_id = p_city_id and d.retired_at is null and d.district_norm = norm_district_tok(p_district))
     and exists (select 1 from public.loc_catalog_city c
                  where c.retired_at is null and c.city_id <> p_city_id
                    and c.region_id = (select c0.region_id from public.loc_catalog_city c0 where c0.city_id = p_city_id)
                    and norm_district_tok('حي ' || c.city_ar) = norm_district_tok(p_district))
$$;
comment on function public.district_is_other_town(integer, text) is
  'True when a district value is the name of ANOTHER town of the same region and on none of this city''s official districts — the town-name trap (backlog 1165/1166). Never true for a real neighbourhood on the list.';

do $mig$
declare
  d text := pg_get_functiondef('public.refresh_title_district()'::regprocedure);
  old_txt constant text := $o$          or not exists (select 1 from public.loc_catalog_district d0
                          where d0.city_id = s.city_id and d0.retired_at is null
                            and d0.district_norm = norm_district_tok(s.district_ar)));$o$;
  new_txt constant text := $n$          or public.district_is_other_town(s.city_id, s.district_ar));$n$;
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'refresh_title_district: off-list clause not found exactly once';
  end if;
  execute replace(d, old_txt, new_txt);
end
$mig$;

do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  a_old constant text := $o$          or not exists (select 1 from public.loc_catalog_district d0
                          where d0.city_id = coalesce(s.city_id, v1.city_id) and d0.retired_at is null
                            and d0.district_norm = norm_district_tok(v1.district_ar)))$o$;
  a_new constant text := $n$          or public.district_is_other_town(coalesce(s.city_id, v1.city_id), v1.district_ar))$n$;
  b_old constant text := $o$       or not exists (select 1 from public.loc_catalog_district d0
                       where d0.city_id = (select lt.city_id from public.listing_title_district lt
                                            where lt.source_table = excluded.source_table and lt.listing_id = excluded.listing_id)
                         and d0.retired_at is null and d0.district_norm = norm_district_tok(_drt.district_ar));$o$;
  b_new constant text := $n$       or public.district_is_other_town((select lt.city_id from public.listing_title_district lt
                                         where lt.source_table = excluded.source_table and lt.listing_id = excluded.listing_id),
                                        _drt.district_ar);$n$;
begin
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
     or (length(d) - length(replace(d, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'refresh_district_recovery_table: off-list anchors not found exactly once';
  end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end
$mig$;
