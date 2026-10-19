-- APPLIED 2026-10-18 06:16:09 UTC (owner session, DB quiet). Al-Qarawi unknown districts after it: 0; fleet backlog routed to 🆕 (backlog 657-659).
-- Owner 2026-10-17 follow-up («there is more — I'm confident they should have a title like this»): the
-- 20261018035154 batch read only «بحي X» titles. ialqarawi's own «الحي» field names more, and the same field
-- across the fleet holds ~3,300 district-less ads whose district our catalog does not know (muhaysini 904,
-- rightcompound 385, sakan 325, aqalemhajer 322, sadiqeltajer 318 …).
--
-- 1) Correct my own batch: «المربع» was the first word of «المربع الذهبي» (12 of 12 mentions are the two-word
--    name). find_district_in_text tries 3-, 2-, then 1-word windows, so the two-word entry wins.
delete from public.loc_catalog_district where city_id = 80 and district_norm = public.norm_district_tok('حي المربع');

-- 2) Admitted from ialqarawi's own «الحي» field, same rule (≥ 3 ads, not a town/plan/direction/number):
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (80, 'حي المربع الذهبي'),  -- 12 (title + field)
    (80, 'حي البربك'),         -- 7 (field)
    (80, 'حي الخندق'),         -- 4 title + 4 field + alkhaas 1
    (80, 'حي طيبة'),           -- 4 (field)
    (80, 'حي الجوز'),          -- 4 (field)
    (80, 'حي الملوحية')        -- 4 (field)
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (80, 'الفهد', 'rejected', 'probably the catalogued «حي الملك فهد» — ambiguous'),
    (80, 'درة القصيم', 'rejected', 'a subdivision plan («مخطط درة القصيم»), not a district'),
    (80, 'العوشزية', 'rejected', 'a separate village beside عنيزة («بحي الدرة بالعوشزيه»)'),
    (80, 'بن تركي', 'rejected', 'reads as a street / family name, not a district'),
    (80, 'ابن عيد', 'rejected', 'reads as a street / family name, not a district'),
    (902, 'مركز الجله وتبراك', 'rejected', 'the town centre itself, not a district')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

-- 3) The alarm reads the source's own district FIELD too (`neighborhood`, the card district), not only «بحي X»
--    titles. Plans, directions and numbered values are skipped; a «حي » prefix is stripped.
create or replace function public.unknown_named_districts(p_min int default 3)
returns table (platform text, city_id int, name text, ads bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare t text; has_title bool; has_nb bool;
begin
  for t, has_title, has_nb in
    select tt.tablename,
           exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tt.tablename and c.column_name='title'),
           exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tt.tablename and c.column_name='neighborhood')
      from pg_tables tt
     where tt.schemaname = 'public' and tt.tablename ~ '_(residential|commercial)_listings$'
       and (select count(*) from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = tt.tablename
               and c.column_name in ('city_id', 'district_ar', 'active')) = 3
  loop
    continue when not (has_title or has_nb);
    return query execute format($q$
      select %L::text, x.city_id, x.d, count(distinct x.id)::bigint
        from (%s %s %s) x
       where x.d is not null and x.d <> ''
         and x.d !~ '(مخطط|[0-9]|^(شرق|غرب|شمال|جنوب|وسط)(ي|يه|ية)?$|^ابن$)'
         and not exists (select 1 from public.loc_catalog_district c
                          where c.city_id = x.city_id and c.district_norm = public.norm_district_tok(x.d))
         and not exists (select 1 from public.loc_catalog_city cc where cc.city_norm = public.norm_district_tok(x.d))
         and not exists (select 1 from public.ops_district_name_decision o
                          where o.city_id = x.city_id and o.name_norm = public.norm_district_tok(x.d))
       group by 2, 3 having count(distinct x.id) >= %s$q$,
      regexp_replace(t, '_(residential|commercial)_listings$', ''),
      case when has_title then format($s$select id, city_id, (regexp_match(title, 'بحي\s+([ء-ي]+)'))[1] as d
              from public.%I where active and district_ar is null and city_id is not null and title ~ 'بحي\s'$s$, t) else '' end,
      case when has_title and has_nb then 'union all' else '' end,
      case when has_nb then format($s$select id, city_id, btrim(regexp_replace(neighborhood, '^\s*حي\s+', '')) as d
              from public.%I where active and district_ar is null and city_id is not null and neighborhood is not null
               and neighborhood !~ '(شمال|جنوب|شرق|غرب|وسط)'$s$, t) else '' end,
      p_min);
  end loop;
end $function$;
