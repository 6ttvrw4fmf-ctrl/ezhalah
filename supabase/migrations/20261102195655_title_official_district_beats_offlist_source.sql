-- AN OFFICIAL DISTRICT IN THE AD'S OWN TITLE BEATS A SOURCE DISTRICT THAT IS ON NO OFFICIAL LIST (backlog 1165/1166).
-- Found by the live customer check (Madinah + «حي الصويدرة», 2026-11-02): aqar 6739822 / 6699093 / 6712299 … are served
-- in المدينة المنورة but show «حي الحناكية» — aqar's breadcrumb district, which is the name of ANOTHER TOWN, on no
-- Madinah list — while their own titles say «حي الصويدرة, مدينة المدينة المنورة», and الصويدرة IS on Madinah's list.
-- So refresh_title_district() now also judges ads whose district is not on the served city's official list, and the
-- title arm may replace such a district (or a recovered value like it) with the title's official one. A district that
-- IS on the official list is never touched. Same proofs as before: on the list, exactly one, not the town's own name.
-- Patched on the live bodies; each fails closed if its anchor is not found exactly once.
do $mig$
declare
  d text := pg_get_functiondef('public.refresh_title_district()'::regprocedure);
  old_txt constant text := $o$   where s.production_ready and s.city_id is not null and (s.district_ar is null or btrim(s.district_ar) = '');$o$;
  new_txt constant text := $n$   where s.production_ready and s.city_id is not null
     and (s.district_ar is null or btrim(s.district_ar) = ''
          or not exists (select 1 from public.loc_catalog_district d0
                          where d0.city_id = s.city_id and d0.retired_at is null
                            and d0.district_norm = norm_district_tok(s.district_ar)));$n$;
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'refresh_title_district: blank-set clause not found exactly once';
  end if;
  execute replace(d, old_txt, new_txt);
end
$mig$;

do $mig$
declare
  d text := pg_get_functiondef('public.refresh_district_recovery_table(text)'::regprocedure);
  a_old constant text := $o$     and public.loc_display_district_ar(coalesce(s.city_id, v1.city_id), v1.district_ar) is null
  on conflict (source_table, listing_id) do update$o$;
  a_new constant text := $n$     and (public.loc_display_district_ar(coalesce(s.city_id, v1.city_id), v1.district_ar) is null
          or not exists (select 1 from public.loc_catalog_district d0
                          where d0.city_id = coalesce(s.city_id, v1.city_id) and d0.retired_at is null
                            and d0.district_norm = norm_district_tok(v1.district_ar)))
  on conflict (source_table, listing_id) do update$n$;
  b_old constant text := $o$            _drt.district_ar) is null;$o$;
  b_new constant text := $n$            _drt.district_ar) is null
       or not exists (select 1 from public.loc_catalog_district d0
                       where d0.city_id = (select lt.city_id from public.listing_title_district lt
                                            where lt.source_table = excluded.source_table and lt.listing_id = excluded.listing_id)
                         and d0.retired_at is null and d0.district_norm = norm_district_tok(_drt.district_ar));$n$;
begin
  if (length(d) - length(replace(d, a_old, ''))) / length(a_old) <> 1
     or (length(d) - length(replace(d, b_old, ''))) / length(b_old) <> 1 then
    raise exception 'refresh_district_recovery_table: title arm anchors not found exactly once';
  end if;
  execute replace(replace(d, a_old, a_new), b_old, b_new);
end
$mig$;
