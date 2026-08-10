-- Filter QA (2026-08-05). Durable, self-healing fix for the recurring Taif→Makkah compound-label
-- leak (10 rows; prior one-off row repair 20260724134922 reverted on sync). composite_match_city_ids
-- computes the authoritative city set from city_ar; for these rows it correctly yields {5}=الطائف,
-- but the stored city_id is 6=مكة المكرمة (from a less-reliable arm — an English "Mecca" region
-- overlay for aqarcity/aqaratikom). The search RPC scopes by city_id, so they leaked into Makkah.
-- Fix at the trigger that already sets match_city_ids: when city_id is NOT among its own match set AND
-- the match is unambiguous (exactly one city), the match wins. Scoped to single-match contradictions
-- only (exactly the 10 today), so no normal or genuinely-multi-city row is affected, and it re-applies
-- on every INSERT/UPDATE (every sync) so it cannot revert. No Region→City→District change (Taif 5 is
-- in the same region 2 as Makkah 6, so region_id is unchanged). Regression: check_audit_invariants
-- asserts 0 production_ready rows with city_id NOT IN match_city_ids.
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
