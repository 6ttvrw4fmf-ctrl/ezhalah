-- APPLIED 2026-10-18 06:50:50 UTC (owner session).
-- First live run of mon_detect_unknown_named_district (2026-10-18 06:50 UTC) listed «الطائف» (sokok, 72 ads) as an
-- unknown district: loc_catalog_city.city_norm is norm_ar («الطائف») while the candidate was compared with
-- norm_district_tok («طايف»). A city's own name is never a district: compare both sides with norm_district_tok.
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
         and not exists (select 1 from public.loc_catalog_city cc
                          where cc.city_norm = public.norm_district_tok(x.d)
                             or public.norm_district_tok(cc.city_ar) = public.norm_district_tok(x.d))
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

