-- Data Integrity run #29, owner location decision - third correction to this barrier, found by
-- mutation-testing it rather than assuming it worked.
--
-- Limb (a) asserts that an unlocated row never carries match_city_ids, which is THE path by which an
-- unlocated listing could contaminate a city or district count. Trying to inject that defect showed
-- it cannot be injected by writing data: search_listings_ar has a BEFORE INSERT OR UPDATE trigger
-- (set_match_city_ids -> trg_set_match_city_ids) that recomputes the column from
-- composite_match_city_ids(city_ar, region_id, city_id) on every write. A direct
-- `update ... set match_city_ids = array[1]` reports 1 row updated and stores NULL; and setting
-- city_ar to an unambiguously-resolvable city name still yields NULL while city_id is null.
--
-- That is a STRONGER guarantee than a detector - but it means limb (a) was watching a condition that
-- the table itself makes unreachable, while the thing that actually enforces the contract (the
-- trigger) was unwatched. Drop the trigger and limb (a) stays silent right up until the first write
-- that quietly gives an unlocated row a city id. This is the same defect class this run already fixed
-- twice: a barrier measuring a downstream symptom instead of the mechanism it protects (docs/ops/
-- DATA_INTEGRITY_ENGINEER.md §24b).
--
-- Limb (a) is KEPT - it is the cheap belt to the trigger's braces, and it would catch a defect
-- arriving through a path that bypasses the trigger (a future COPY, a disabled trigger, a rewrite of
-- composite_match_city_ids). Limb (e) is added to watch the mechanism, and is mutation-proven by
-- dropping the trigger inside a rolled-back subtransaction.

create or replace function public.mon_detect_unlocated_search_contract()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; leak int; recoverable int; ready int; rpc_src text;
  struct jsonb := '[]'::jsonb; sample jsonb; trg_ok boolean;
begin
  -- (a) an unlocated row must never carry city match ids - the branch that would let it into a
  --     city-filtered result set, i.e. contaminate a city/district count
  select count(*) into leak from public.search_listings_ar
   where city_id is null and match_city_ids is not null and cardinality(match_city_ids) > 0;

  -- (b) production_ready must keep meaning "has BOTH a city and a region", so every located
  --     surface excludes the unlocated by construction
  select count(*) into ready from public.search_listings_ar
   where production_ready and (city_id is null or region_id is null);

  -- (c) an unlocated row whose city text resolves to EXACTLY ONE catalog city is a resolver
  --     failure, not an honest unknown. AMBIGUOUS names (>1 candidate) are deliberately NOT
  --     counted - with no region published, picking one would be the duplicate-place-name bug this
  --     run fixed («البريكه» is 3 cities in 2 regions, «العقيق» 4 in 3, «المجمعة» 4 in 3).
  select count(*) into recoverable from public.search_listings_ar s
   where s.city_id is null and s.city_ar is not null
     and (select count(distinct c.city_id) from public.loc_catalog_city c
           where c.city_norm = public.normalize_ar(s.city_ar)) = 1;

  -- (d) STRUCTURAL: the RPC must still admit unlocated rows ONLY when no city, district or region
  --     filter is set. Losing the arm excludes them from Ezhalah; losing a guard contaminates.
  select pg_get_functiondef(p.oid) into rpc_src
    from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
   where nsp.nspname = 'public' and p.proname = 'location_search_candidates_ar';
  if rpc_src is null then
    struct := struct || to_jsonb('location_search_candidates_ar missing'::text);
  else
    if position('s.region_id is null or s.city_id is null' in rpc_src) = 0 then
      struct := struct || to_jsonb('the unlocated-fallback arm is gone - unlocated listings are now excluded from Ezhalah entirely'::text);
    end if;
    if position('p_cities is null or cardinality(p_cities) = 0' in rpc_src) = 0
       or position('p_districts is null or cardinality(p_districts) = 0' in rpc_src) = 0
       or position('p_region_ids is null' in rpc_src) = 0 then
      struct := struct || to_jsonb('a location guard on the unlocated arm is gone - unlocated rows can now pollute a city/district/region result'::text);
    end if;
  end if;

  -- (e) STRUCTURAL: the trigger that DERIVES match_city_ids must still be attached and enabled.
  --     It, not limb (a), is what makes contamination unreachable - limb (a) can only report the
  --     damage after a write has already landed.
  select exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.search_listings_ar'::regclass
       and t.tgname = 'set_match_city_ids'
       and not t.tgisinternal
       and t.tgenabled <> 'D'
  ) into trg_ok;
  if not trg_ok then
    struct := struct || to_jsonb('the set_match_city_ids trigger is missing or disabled - match_city_ids is no longer derived, so an unlocated row can now be handed city ids by any write'::text);
  end if;

  if leak > 0 or ready > 0 or recoverable > 0 or jsonb_array_length(struct) > 0 then
    if recoverable > 0 then
      select jsonb_agg(x) into sample from (
        select s.source_table, s.listing_id, s.platform, s.city_ar
          from public.search_listings_ar s
         where s.city_id is null and s.city_ar is not null
           and (select count(distinct c.city_id) from public.loc_catalog_city c
                 where c.city_norm = public.normalize_ar(s.city_ar)) = 1
         limit 20) x;
    end if;

    n := public.mon_raise('P1', 'unlocated_search_contract', 'all', 'unlocated_search_contract',
      jsonb_build_object(
        'unlocated_with_match_city_ids', leak,
        'production_ready_without_location', ready,
        'unlocated_but_city_resolves_unambiguously', recoverable,
        'recoverable_sample', sample,
        'structural', struct,
        'contract', 'A listing whose source does not give enough to resolve a city/district stays '
                    'SEARCHABLE: it appears whenever no incompatible location constraint is selected, '
                    'matches its real deal/type/period/price, never appears under a city or district '
                    'we cannot prove, and is never assigned a fake location. UNKNOWN means unknown - '
                    'not excluded from Ezhalah.',
        'why', 'Owner location decision 2026-08-18. Verified live the same day: an unlocated Buy '
               'listing (wasalt 441665) was returned with no location filter and absent from city, '
               'city+district and region searches.',
        'do_not', 'Do NOT make this green by giving a listing a city. Never invent a location. In '
                  'particular do NOT resolve an AMBIGUOUS city name by picking a candidate - limb (c) '
                  'deliberately ignores those, because 5 unlocated rows today carry names that match '
                  '3-4 real Saudi cities each with no source region to choose between them.'));
  else
    perform public.mon_resolve_key('unlocated_search_contract', 'unlocated_search_contract');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_unlocated_search_contract() is
  'P1. The owner location decision of 2026-08-18: unknown location means UNKNOWN, not excluded. '
  'Unlocated rows stay searchable with no location filter, must never carry match_city_ids or be '
  'production_ready (the two paths that would contaminate a city/district count), must never be '
  'handed a location we cannot prove, the RPC must keep the unlocated arm AND all three guards on '
  'it, and the set_match_city_ids trigger that derives match_city_ids must stay attached - that '
  'trigger, not limb (a), is what makes contamination unreachable rather than merely detectable.';
