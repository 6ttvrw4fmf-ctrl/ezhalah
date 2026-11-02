-- ONE FACT, ONCE PER PACK (owner 2026-11-01: «up to date and no duplicates»). The pool is a UNION of three branches; the first
-- carries a row_number() column and the other two carry 0, so a fact picked by two branches came back twice (measured: 171
-- rows, 169 distinct ids for Jeddah / حي الصفا). The phone never shows a seen fact again, but a duplicate doubled that fact's
-- chance of being picked. The pack is now distinct by id. Everything else is unchanged.
create or replace function public.welcome_insights_pick(p_city text default null::text, p_district text default null::text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with day as (select max(day) d from public.welcome_insight where day = (now() at time zone 'Asia/Riyadh')::date),
  pool as (
    select * from (select w.*, row_number() over (partition by w.kind order by random()) rn
                     from public.welcome_insight w, day where w.day = day.d) z where rn <= 6
    union
    select w.*, 0 from public.welcome_insight w, day where w.day = day.d and p_city is not null and w.city_ar = p_city
       and w.id in (select id from public.welcome_insight w2, day where w2.day = day.d and w2.city_ar = p_city order by random() limit 25)
    union
    select w.*, 0 from public.welcome_insight w, day where w.day = day.d and p_district is not null and w.district_ar = p_district
       and (p_city is null or w.city_ar = p_city)
  )
  select jsonb_build_object(
    'day', (select d from day),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'personal', personal, 'ar', ar, 'en', en) order by id), '[]') from public.welcome_template where active),
    'insights', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'region', region_ar, 'city', city_ar, 'city_id', city_id,
                   'district', district_ar, 'district2', district2_ar, 'type', type_ar, 'a', a, 'b', b)), '[]') from (select distinct on (id) * from pool) pool));
$function$;


-- Apply-time proof: no fact id twice in a pack, today's facts still served.
do $chk$
declare got jsonb; today date := (now() at time zone 'Asia/Riyadh')::date; n int; u int;
begin
  got := public.welcome_insights_pick((select city_ar from public.welcome_insight where day = today and district_ar is not null limit 1),
                                      (select district_ar from public.welcome_insight where day = today and district_ar is not null limit 1));
  select count(*), count(distinct e->>'id') into n, u from jsonb_array_elements(got->'insights') e;
  if n <> u then raise exception 'one fact once: % rows, % distinct', n, u; end if;
  if exists (select 1 from public.welcome_insight where day = today) and n = 0 then raise exception 'one fact once: today''s facts are not served'; end if;
end $chk$;
