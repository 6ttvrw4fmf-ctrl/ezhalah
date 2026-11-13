-- The map box where the pill names a city but counts only the districts on screen (owner 2026-11-13, «from city level to
-- district level»): the prepared facts of EXACTLY those districts, added up, so the box describes the same ads as the
-- count. Counts only (ads, new, gone, price cuts — each district's copies are already counted once, and a copy never spans
-- two districts); a median cannot be added up, so no price — unless the districts on screen are the whole city (within
-- 3% or 3 ads), when the city's own facts, price included, are served. Every named district must have a row, or nothing
-- is served (a missing one would leave its ads in the count and out of the facts). Same switch, freshness and guest rule
-- as map_place_facts_ar.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('map_place_facts_sum_ar', '{anon,authenticated}', 'map box when the pill names a city but counts only the districts on screen (owner 2026-11-13): the prepared facts of exactly those districts, added up. Read-only STABLE; a guest gets only yes/no flags.')
on conflict do nothing;

create or replace function public.map_place_facts_sum_ar(p_city text, p_districts text[], p_deals text[] default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare b record; s record; c record; v_want int;
begin
  if not coalesce((select ff.enabled from public.ops_feature_flags ff where ff.name = 'map_view_facts'), false) then return null; end if;
  if p_city is null or p_districts is null or p_deals is null or cardinality(p_deals) <> 1 then return null; end if;
  select count(distinct d) into v_want from unnest(p_districts) d where d is not null and d <> '';
  if v_want = 0 or v_want > 600 or v_want <> cardinality(p_districts) then return null; end if;
  select * into b from public.map_place_facts_build order by built_at desc limit 1;
  if b.built_at is null or b.built_at < now() - interval '3 hours' or b.failed > 0 then return null; end if;
  select count(*) as k, sum(pf.n_ads) as n, sum(pf.new30) as new30,
         case when bool_and(pf.gone30 is not null) then sum(pf.gone30) end as gone30,
         case when bool_and(pf.cuts30 is not null) then sum(pf.cuts30) end as cuts30
    into s
    from public.map_place_facts pf
   where pf.level = 'district' and pf.city_ar = p_city and pf.district_ar = any (p_districts) and pf.deal = p_deals[1];
  if s.k is distinct from v_want then return null; end if;
  -- the districts on screen are the whole city: the city's own facts (its price and its most common type)
  select * into c from public.map_place_facts pf
   where pf.level = 'city' and pf.city_ar = p_city and pf.district_ar = '' and pf.deal = p_deals[1];
  if found and abs(c.n_ads - s.n) <= greatest(3, round(c.n_ads * 0.03)) then
    if auth.uid() is null then
      return jsonb_build_object('locked', true, 'any', s.n, 'place', true,
        'has_new', c.new30 > 0, 'has_gone', coalesce(c.gone30, 0) > 0, 'has_ppm', c.top_ppm is not null,
        'has_cmp', false, 'has_cuts', coalesce(c.cuts30, 0) > 0);
    end if;
    return jsonb_build_object('any', s.n, 'place', true, 'new30', c.new30, 'gone30', c.gone30, 'cuts30', c.cuts30,
      'top_type', c.top_type, 'top_ppm', c.top_ppm, 'city_ar', c.city_ar, 'updated_at', c.built_at);
  end if;
  if auth.uid() is null then
    return jsonb_build_object('locked', true, 'any', s.n, 'place', true,
      'has_new', s.new30 > 0, 'has_gone', coalesce(s.gone30, 0) > 0, 'has_ppm', false, 'has_cmp', false,
      'has_cuts', coalesce(s.cuts30, 0) > 0);
  end if;
  return jsonb_build_object('any', s.n, 'place', true, 'new30', s.new30, 'gone30', s.gone30, 'cuts30', s.cuts30,
    'city_ar', p_city, 'updated_at', b.built_at);
end;
$function$;
revoke all on function public.map_place_facts_sum_ar(text, text[], text[]) from public;
grant execute on function public.map_place_facts_sum_ar(text, text[], text[]) to anon, authenticated;
