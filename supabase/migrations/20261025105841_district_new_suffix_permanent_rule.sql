CREATE OR REPLACE FUNCTION public.loc_display_district_ar(p_city_id integer, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when p_raw is null then null else (
    select coalesce(
             (select k.display_ar from public.loc_display_district_canon k
               where k.city_id = p_city_id and k.district_norm = t.key),
             -- a folded name whose district has no ads under its own name yet: show our list's own name
             (select c.district_ar from public.loc_catalog_district c
               where t.key <> t.own and c.city_id = p_city_id and c.district_norm = t.key limit 1),
             p_raw)
      from (select norm_district_tok(p_raw) as own,
                   coalesce(
                     (select a.to_norm from public.loc_district_alias a
                       where a.city_id = p_city_id and a.from_norm = norm_district_tok(p_raw)),
                     -- owner 2026-10-25, permanent rule: «X الجديد / X الجديدة» is our district X. Only when X is in our
                     -- list for this city and «X الجديد(ة)» is not itself a district in our list («منفوحة الجديدة» stays).
                     (select b.district_norm from public.loc_catalog_district b
                       where norm_district_tok(p_raw) ~ '\s+(ال)?جديد[ه]?$'
                         and b.city_id = p_city_id
                         and b.district_norm = regexp_replace(norm_district_tok(p_raw), '\s+(ال)?جديد[ه]?$', '')
                         and not exists (select 1 from public.loc_catalog_district f
                                          where f.city_id = p_city_id and f.district_norm = norm_district_tok(p_raw))
                       limit 1),
                     norm_district_tok(p_raw)) as key) t)
  end
$function$;

do $proof$
begin
  if public.loc_display_district_ar(664, 'حي الطريف الجديدة') is distinct from coalesce(
       (select display_ar from public.loc_display_district_canon where city_id = 664 and district_norm = public.norm_district_tok('حي الطريف')),
       (select district_ar from public.loc_catalog_district where city_id = 664 and district_norm = public.norm_district_tok('حي الطريف'))) then
    raise exception 'الطريف الجديدة did not fold into الطريف';
  end if;
  if public.loc_display_district_ar(6, 'الهجلة الجديد') is distinct from (select display_ar from public.loc_display_district_canon where city_id = 6 and district_norm = public.norm_district_tok('حي الهجلة')) then
    raise exception 'the spelling memory stopped working';
  end if;
  if public.loc_display_district_ar(3, 'حي منفوحة الجديدة') is distinct from coalesce((select display_ar from public.loc_display_district_canon where city_id = 3 and district_norm = public.norm_district_tok('حي منفوحة الجديدة')), 'حي منفوحة الجديدة') then
    raise exception 'منفوحة الجديدة folded although our list has it as its own district';
  end if;
  if public.loc_display_district_ar(6, 'حي الشامية الجديد') is distinct from coalesce((select display_ar from public.loc_display_district_canon where city_id = 6 and district_norm = public.norm_district_tok('حي الشامية الجديد')), 'حي الشامية الجديد') then
    raise exception 'الشامية الجديد changed although it is an official name in our list';
  end if;
  if public.loc_display_district_ar(3, 'حي النرجس') is distinct from coalesce((select display_ar from public.loc_display_district_canon where city_id = 3 and district_norm = public.norm_district_tok('حي النرجس')), 'حي النرجس') then
    raise exception 'an ordinary district changed';
  end if;
end $proof$;