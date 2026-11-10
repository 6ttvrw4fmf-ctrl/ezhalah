-- A FACT PACK FROM ANOTHER DAY NEVER SAYS «أمس» / «آخر 7 أيام» OR A COUNT (owner 2026-10-27: «yesterday, 1 week should
-- be based on real fact … we can go to jail»; owner 2026-11-09: «those numbers count needs to be exact»).
-- Since 2026-11-06 the phone shows a fact from a pack read in the last 36 h on the first open of a new day (never pop up
-- late). Nothing checked that pack's `day`, so a «نزل أمس …» fact built yesterday was shown today — «yesterday» then meant
-- the day before — and every «آخر 7 أيام» window and count was a day old. Each template now carries `day_bound`: true
-- when its kind has a time window (welcome_kind_stat.time_window) or states a count, which moves through the day. The app
-- uses a pack from another day only for templates with day_bound = false (src/lib/insightWelcome.ts); a pack without
-- the field (an older read) gives no fact at all from another day. Additive: the rest of the pack is unchanged.
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
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'personal', t.personal, 'ar', t.ar, 'en', t.en,
                   'day_bound', coalesce(k.time_window is not null or k.stat = 'count', true)) order by t.id), '[]')
                    from public.welcome_template t left join public.welcome_kind_stat k on k.kind = t.kind where t.active),
    'insights', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'region', region_ar, 'city', city_ar, 'city_id', city_id,
                   'district', district_ar, 'district2', district2_ar, 'type', type_ar, 'a', a, 'b', b)), '[]') from (select distinct on (id) * from pool) pool));
$function$;
do $$
declare p jsonb := public.welcome_insights_pick('الرياض', null);
begin
  if not exists (select 1 from jsonb_array_elements(p->'templates') t where t->>'kind' = 'yesterday' and (t->>'day_bound')::boolean) then
    raise exception 'the yesterday template is not day_bound';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'templates') t where t->>'kind' in ('villa_area','land_ppm_city') and (t->>'day_bound')::boolean) then
    raise exception 'a timeless median was marked day_bound';
  end if;
  if exists (select 1 from jsonb_array_elements(p->'templates') t where not (t ? 'day_bound')) then
    raise exception 'a template carries no day_bound';
  end if;
end $$;
