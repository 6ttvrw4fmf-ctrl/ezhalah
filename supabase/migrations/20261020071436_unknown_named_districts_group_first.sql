-- unknown_named_districts(): group first, normalise each (city, name) once.
-- pg_cron job 175 (mon-unknown-named-district) was killed by statement_timeout on 2026-10-19 04:41 UTC
-- after 5 min, and took 4 min 09 s on 2026-10-20. The city-name exclusion
-- («norm_district_tok(cc.city_ar) = norm_district_tok(x.d)» against 4,582 catalog cities) ran per
-- candidate ROW in each of 235 listing tables; bossbih alone (1,620 rows) passed 60 s.
-- Every filter depends only on (city_id, name), so the rows are gathered in one statement, grouped,
-- and each group is normalised once; the normalised city names are computed once per call.
-- Same output: on 2026-10-20 the old and new bodies returned the identical list for bossbih
-- (117 names / 187 ads, md5 80a11a33…), and the full run answers in about a second
-- (142 names / 741 ads at p_min 3). Grants are unchanged (CREATE OR REPLACE keeps them).
create or replace function public.unknown_named_districts(p_min int default 3)
returns table (platform text, city_id int, name text, ads bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_arms text;
begin
  -- One statement over every listing table instead of one per table: the per-row city check
  -- («norm_district_tok(cc.city_ar) = …» across 4,582 cities) ran once per candidate ROW in each of
  -- 235 tables, which took job 175 to 4–5 min and over its statement_timeout on 2026-10-19 04:41.
  -- Every filter depends only on (city_id, name), so group first and normalise each group once.
  select string_agg(arm, ' union all ') into v_arms
    from (select concat_ws(' union all ',
                   case when has_title then format($s$select %L::text as tbl, id, city_id, (regexp_match(title, 'بحي\s+([ء-ي]+)'))[1] as d
                     from public.%I where active and district_ar is null and city_id is not null and title ~ 'بحي\s'$s$, t, t) end,
                   case when has_nb then format($s$select %L::text as tbl, id, city_id, btrim(regexp_replace(neighborhood, '^\s*حي\s+', '')) as d
                     from public.%I where active and district_ar is null and city_id is not null and neighborhood is not null
                      and neighborhood !~ '(شمال|جنوب|شرق|غرب|وسط)'$s$, t, t) end) as arm
            from (select tt.tablename as t,
                         exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tt.tablename and c.column_name='title') as has_title,
                         exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tt.tablename and c.column_name='neighborhood') as has_nb
                    from pg_tables tt
                   where tt.schemaname = 'public' and tt.tablename ~ '_(residential|commercial)_listings$'
                     and (select count(*) from information_schema.columns c
                           where c.table_schema = 'public' and c.table_name = tt.tablename
                             and c.column_name in ('city_id', 'district_ar', 'active')) = 3) z
           where has_title or has_nb) a;
  if v_arms is null then return; end if;
  return query execute format($q$
    with g as (
      select x.tbl, x.city_id, x.d, count(distinct x.id)::bigint as n
        from (%s) x
       where x.d is not null and x.d <> ''
         and x.d !~ '(مخطط|[0-9]|^(شرق|غرب|شمال|جنوب|وسط)(ي|يه|ية)?$|^ابن$)'
       group by 1, 2, 3 having count(distinct x.id) >= %s),
    gn as (select g.*, public.norm_district_tok(g.d) as dn from g),
    cn as materialized (select cc.city_norm as v from public.loc_catalog_city cc
                        union select public.norm_district_tok(cc.city_ar) from public.loc_catalog_city cc)
    select regexp_replace(gn.tbl, '_(residential|commercial)_listings$', '')::text, gn.city_id, gn.d, gn.n
      from gn
     where not exists (select 1 from public.loc_catalog_district c where c.city_id = gn.city_id and c.district_norm = gn.dn)
       and not exists (select 1 from cn where cn.v = gn.dn)
       and not exists (select 1 from public.ops_district_name_decision o where o.city_id = gn.city_id and o.name_norm = gn.dn)$q$,
    v_arms, p_min);
end $function$;
