insert into public.loc_district_alias (city_id, from_norm, to_norm, why, decided_by)
select v.city_id, public.norm_district_tok(v.site_spelling), public.norm_district_tok(v.our_district), v.why, 'owner'
from (values
  (664, 'حي الدرعية الجديدة', 'حي الدرعية', 'owner 2026-10-25: «الدرعية الجديدة» is «الدرعية» (asked same or separate, answer: same)')
) as v(city_id, site_spelling, our_district, why)
on conflict (city_id, from_norm) do nothing;

do $chk$
declare bad text;
begin
  select string_agg(a.city_id || ':' || a.to_norm, ', ') into bad
    from public.loc_district_alias a
   where not exists (select 1 from public.loc_catalog_district d where d.city_id = a.city_id and d.district_norm = a.to_norm);
  if bad is not null then raise exception 'alias target not in loc_catalog_district: %', bad; end if;
  if public.loc_display_district_ar(664, 'حي الدرعية الجديدة') is distinct from (select display_ar from public.loc_display_district_canon where city_id = 664 and district_norm = public.norm_district_tok('حي الدرعية')) then
    raise exception 'الدرعية الجديدة did not fold into الدرعية';
  end if;
  if public.loc_display_district_ar(664, 'حي الطريف الجديدة') is distinct from coalesce((select display_ar from public.loc_display_district_canon where city_id = 664 and district_norm = public.norm_district_tok('حي الطريف الجديدة')), 'حي الطريف الجديدة') then
    raise exception 'الطريف الجديدة changed although the owner has not decided it';
  end if;
end $chk$;