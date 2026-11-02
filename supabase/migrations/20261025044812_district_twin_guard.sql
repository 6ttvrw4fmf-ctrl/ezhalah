-- DISTRICT TWIN GUARD (owner 2026-10-24: «I am scared of duplicates, same district twice»).
-- loc_catalog_district already refuses an EXACT repeat (unique city_id + district_norm; 0 repeats in 3,894 rows). What it cannot
-- see is the same place spelled two ways («الضاحية الأول» vs «الضاحية الحي الأول»). district_twin_check() compares a new name with
-- THAT CITY's existing districts BEFORE it is added and answers one word:
--   exists  the exact normalised name is already catalogued
--   twin    the same name once the noise words (حي / الحي / ضاحية / الضاحية) are dropped, or a near spelling (trigram >= 0.88)
--           with the same ordinal / letter / number tail  -> record it as a 'variant', never insert it
--   sequel  same base, different ordinal / letter / number («شرق المطار أ» and «ب») -> a real sibling, allowed
--   new     nothing close -> may be admitted by the normal rule (>= 3 ads, not a city, street, plan or direction)
-- Read-only; nothing here writes a listing or the catalogue.
create or replace function public.district_key_parts(p_norm text)
returns table (k text, base text, tail text)
language sql immutable
as $f$
  with s as (
    select btrim(regexp_replace(regexp_replace(coalesce(p_norm, ''), '(^| )(حي|الحي|ضاحيه|الضاحيه)(?= |$)', ' ', 'g'), '\s+', ' ', 'g')) as k
  )
  select s.k,
         btrim(regexp_replace(s.k, ' (الاول|الاولي|الثاني|الثانيه|الثالث|الثالثه|الرابع|الرابعه|الخامس|الخامسه|السادس|السادسه|السابع|السابعه|الثامن|الثامنه|التاسع|التاسعه|العاشر|العاشره|[0-9]+|[ابجده])$', '')),
         coalesce((regexp_match(s.k, ' (الاول|الاولي|الثاني|الثانيه|الثالث|الثالثه|الرابع|الرابعه|الخامس|الخامسه|السادس|السادسه|السابع|السابعه|الثامن|الثامنه|التاسع|التاسعه|العاشر|العاشره|[0-9]+|[ابجده])$'))[1], '')
    from s
$f$;

create or replace function public.district_twin_check(p_city_id int, p_name text)
returns table (verdict text, twin_ar text, similarity real)
language sql stable
as $f$
  with q as (select public.norm_district_tok(p_name) as n),
  qp as (select q.n, p.k, p.base, p.tail from q cross join lateral public.district_key_parts(q.n) p),
  c as (select d.district_ar, d.district_norm as n, p.k, p.base, p.tail
          from public.loc_catalog_district d cross join lateral public.district_key_parts(d.district_norm) p
         where d.city_id = p_city_id),
  hit as (
    select case when c.n = qp.n then 'exists'
                when c.k = qp.k and qp.k <> '' then 'twin'
                when similarity(c.k, qp.k) >= 0.88 and c.tail = qp.tail then 'twin'
                when c.base = qp.base and c.base <> '' and c.tail <> qp.tail then 'sequel'
           end as v,
           c.district_ar as ar, similarity(c.k, qp.k)::real as s
      from c cross join qp)
  select v, ar, s from hit where v is not null
   order by case v when 'exists' then 0 when 'twin' then 1 else 2 end, s desc
   limit 1
$f$;

-- The alarm's candidates, each already judged: the engineer reads this instead of unknown_named_districts().
create or replace function public.unknown_named_districts_checked(p_min int default 3)
returns table (platform text, city_id int, name text, ads bigint, verdict text, twin_ar text, sim real)
language sql stable
as $f$
  select u.platform, u.city_id, u.name, u.ads, coalesce(t.verdict, 'new'), t.twin_ar, t.similarity
    from public.unknown_named_districts(p_min) u
    left join lateral public.district_twin_check(u.city_id, u.name) t on true
$f$;

revoke all on function public.district_key_parts(text) from public, anon, authenticated;
revoke all on function public.district_twin_check(int, text) from public, anon, authenticated;
revoke all on function public.unknown_named_districts_checked(int) from public, anon, authenticated;
grant execute on function public.district_key_parts(text) to service_role;
grant execute on function public.district_twin_check(int, text) to service_role;
grant execute on function public.unknown_named_districts_checked(int) to service_role;
