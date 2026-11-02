-- A daily fact is served ONLY on the Saudi day it was built for (owner 2026-10-27: «yesterday, 1 week should be based on
-- real fact … it goes a day, I am talking in days … we can go to jail»). The build runs every 3 hours at :45 UTC, so the
-- first one of a Saudi day lands at 00:45 Riyadh; between 00:00 and 00:45 the table still held the previous day's facts,
-- and «نُشر أمس …» / «خلال آخر 7 أيام …» would have been served a day late. Now the pick returns no facts until today's
-- build exists (the app then keeps its greeting without a fact). The phone applies the same rule to lines it keeps
-- (src/lib/filterWelcome.ts sameRiyadhDay).
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
                   'district', district_ar, 'district2', district2_ar, 'type', type_ar, 'a', a, 'b', b)), '[]') from pool));
$function$;

-- Apply-time proof: today's build is served; a day that is not today never is.
do $chk$
declare got jsonb; today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  got := public.welcome_insights_pick(null, null);
  if exists (select 1 from public.welcome_insight where day = today) then
    if (got->>'day')::date is distinct from today or jsonb_array_length(got->'insights') = 0 then
      raise exception 'facts today-only: today''s facts are not served (%)', got->>'day';
    end if;
  else
    if jsonb_array_length(got->'insights') <> 0 then
      raise exception 'facts today-only: a previous day''s facts are still served';
    end if;
  end if;
  if position('(now() at time zone ''Asia/Riyadh'')::date' in pg_get_functiondef('public.welcome_insights_pick'::regproc)) = 0 then
    raise exception 'facts today-only: the day guard is missing';
  end if;
end $chk$;
