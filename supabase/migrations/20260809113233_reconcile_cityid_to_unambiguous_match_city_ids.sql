-- Filter QA (2026-08-05). Self-healing fix for city_id that contradicts its own authoritative
-- match_city_ids (the Taif→Makkah class; prior one-off row repair 20260724134922 reverted on sync).
-- composite_match_city_ids() computes the city set from city_ar; when the stored city_id is NOT in
-- that set and the match is unambiguous (exactly one city), the match wins (city_id can come from a
-- less-reliable arm — e.g. an English "Mecca" region overlay). Scoped to single-match contradictions
-- only (region_id unchanged: Taif 5 and Makkah 6 share region 2). Re-applies on every INSERT/UPDATE
-- (every sync) so it cannot revert. Applied to prod as 20260809113233.
create or replace function public.trg_set_match_city_ids()
 returns trigger
 language plpgsql
as $function$
begin
  new.match_city_ids := public.composite_match_city_ids(new.city_ar, new.region_id, new.city_id);
  if new.city_id is not null
     and coalesce(cardinality(new.match_city_ids), 0) = 1
     and not (new.city_id = any(new.match_city_ids)) then
    new.city_id := new.match_city_ids[1];
  end if;
  return new;
end
$function$;
