-- TRENDING CITY COUNTS WERE PRE-ADVANCED-FILTER BY CONSTRUCTION.
--
-- THE DEFECT (owner-approved fix, 2026-08-22). top_cities_by_deal_ar accepted only
-- (p_deal, p_rent_period, p_category, p_types). It had NO advanced-filter parameters at all, so a
-- city chip could never reflect an answered advanced question: the number shown and the number the
-- user gets on click were different quantities by design. This is the city half of the same defect
-- PR #822 fixes for districts, where the measured overstatement was 7.5x.
--
-- THE OWNER'S RULE, applied here verbatim:
--     city count shown = clicking that city = actual search result count
--     under the full current AF state.
--
-- DESIGN: ONE DEFINITION OF AF ELIGIBILITY, NOT A SECOND COPY.
-- af_eligibility_clause() is the canonical AF predicate; it is already inlined byte-identically
-- into location_search_candidates_ar (the results RPC) and af_eligible_count. A hand-written third
-- copy is exactly how these drift apart (see the run #29 lesson: a rule fixed in one stage and left
-- wrong in two others is indistinguishable, from the user's side, from never having fixed it).
-- So this migration does not retype the predicate: it CONCATENATES af_eligibility_clause() and the
-- CTE scaffolding extracted verbatim from af_eligible_count's live body, then executes the result.
-- Byte-identity is therefore a property of construction, and mon_detect_af_count_surfaces_carry_af
-- (added alongside) asserts it stays true.
--
-- WHY `and s.production_ready = true` IS ANDED ON TOP.
-- The canonical clause opens with `where (s.production_ready or (<unlocated fallback>))`. Count
-- surfaces must stay production_ready-scoped -- that is limb (f) of
-- mon_detect_unlocated_search_contract and the owner's 2026-08-18 location decision: an unlocated
-- listing stays searchable with no location filter but must never be counted under a place we
-- cannot prove. ANDing production_ready collapses that first arm to production_ready-only while
-- every other AF predicate still comes from the canonical text. Net semantics for the cohort are
-- unchanged from the previous definition, plus AF.
--
-- ONE AGGREGATE, NOT N CALLS (owner's explicit preference). This stays a single server-side
-- GROUP BY over the index; the frontend keeps making exactly one call for the whole chip row.
--
-- SIGNATURE SAFETY: the old 4-arg function is DROPPED in the same transaction before the new one is
-- created. Adding parameters with defaults under the same name would create a second OVERLOAD, and
-- an ambiguous overload is the exact shape of the 2026-07-16 PGRST203 search outage. The assertion
-- at the end fails the migration if more than one overload survives.
--
-- GRANTS are re-issued explicitly: a dropped function takes its ACL with it, and this RPC is
-- called through the anon key, so forgetting them would break trending cities for every user.

do $mig$
declare
  v_def text; v_cte text; v_where text := public.af_eligibility_clause();
  v_params text; v_ddl text; v_n int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'af_eligible_count';
  if v_def is null then raise exception 'af_eligible_count not found - cannot source the CTE block'; end if;

  -- Extract the district_tokens / city_tokens / city_ids scaffolding verbatim. Those CTEs carry the
  -- 2026-08-15 and 2026-08-18 ambiguity guards (an English place name is only bridged when it
  -- resolves to exactly ONE canonical Arabic place); retyping them by hand is how a guard gets lost.
  v_cte := substring(v_def from position('  with district_tokens as (' in v_def)
                     for position('  select count(*)' in v_def) - position('  with district_tokens as (' in v_def));
  if v_cte is null or length(v_cte) < 800 then
    raise exception 'CTE extraction failed (len %) - refusing a blind rebuild', coalesce(length(v_cte), 0);
  end if;
  if position('city_ids as (' in v_cte) = 0 or position('city_name_bridge' in v_cte) = 0
     or position('district_name_bridge' in v_cte) = 0 then
    raise exception 'extracted CTE block is missing an expected guard - refusing';
  end if;
  if length(v_where) < 3000 then
    raise exception 'af_eligibility_clause() returned % chars - refusing', length(v_where);
  end if;

  v_params :=
    'p_deal text default null, p_rent_period text default null, p_category text default null, '
    'p_types text[] default null, p_cities text[] default null, p_districts text[] default null, '
    'p_tables text[] default null, p_platforms text[] default null, p_region_ids integer[] default null, '
    'p_tables2 text[] default null, p_types2 text[] default null, p_beds_exact integer[] default null, '
    'p_beds_min integer default null, p_price_min numeric default null, p_price_max numeric default null, '
    'p_area_min integer default null, p_area_max integer default null, p_age_min integer default null, '
    'p_age_max integer default null, p_age_unknown boolean default null, '
    'p_is_new_construction boolean default null, p_amenities text[] default null, '
    'p_bath_min integer default null, p_bath_exact integer[] default null, p_furnished boolean default null, '
    'p_tenant text default null, p_directions text[] default null, p_has_license boolean default null, '
    'p_street_width_min smallint default null, p_street_width_max smallint default null, '
    'p_floor_min integer default null, p_floor_max integer default null, p_rating_min numeric default null, '
    'p_reviews_min integer default null, p_unit_subtypes text[] default null, '
    'p_price_min_rent numeric default null, p_price_max_rent numeric default null';

  v_ddl :=
    'create function public.top_cities_by_deal_ar(' || v_params || ')' || E'\n' ||
    ' returns table(city_id integer, city_ar text, region_id integer, region_ar text,' || E'\n' ||
    '               listing_count integer, total_in_cohort integer)' || E'\n' ||
    ' language sql stable as $fn$' || E'\n' ||
    v_cte ||
    ', cohort as (' || E'\n' ||
    '    select s.city_id' || E'\n' ||
    '    from public.search_listings_ar s' || E'\n' ||
    v_where ||
    '      -- COUNT SURFACES STAY production_ready-SCOPED (unlocated-search contract limb f).' || E'\n' ||
    '      and s.production_ready = true' || E'\n' ||
    '  ), total as (select count(*)::int as t from cohort)' || E'\n' ||
    '  select co.city_id, c.city_ar, c.region_id, r.region_ar,' || E'\n' ||
    '         count(*)::int as listing_count, total.t as total_in_cohort' || E'\n' ||
    '  from cohort co' || E'\n' ||
    '    join public.loc_catalog_city c on c.city_id = co.city_id' || E'\n' ||
    '    left join public.loc_catalog_region r on r.region_id = c.region_id' || E'\n' ||
    '    cross join total' || E'\n' ||
    '  group by co.city_id, c.city_ar, c.region_id, r.region_ar, total.t' || E'\n' ||
    '  order by listing_count desc;' || E'\n' ||
    '$fn$';

  execute 'drop function if exists public.top_cities_by_deal_ar(text, text, text, text[])';
  execute v_ddl;

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'top_cities_by_deal_ar';
  if v_n <> 1 then
    raise exception 'top_cities_by_deal_ar has % overloads - PGRST203 shape, refusing', v_n;
  end if;
end
$mig$;

grant execute on function public.top_cities_by_deal_ar(
  text, text, text, text[], text[], text[], text[], text[], integer[], text[], text[], integer[],
  integer, numeric, numeric, integer, integer, integer, integer, boolean, boolean, text[], integer,
  integer[], boolean, text, text[], boolean, smallint, smallint, integer, integer, numeric, integer,
  text[], numeric, numeric) to public, anon, authenticated, service_role;

-- Post-conditions: the canonical clause really is inlined, and the ACL really was restored.
do $check$
declare v_ok boolean; v_acl text;
begin
  select position(public.af_eligibility_clause() in pg_get_functiondef(p.oid)) > 0, p.proacl::text
    into v_ok, v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'top_cities_by_deal_ar';
  if not coalesce(v_ok, false) then
    raise exception 'af_eligibility_clause() is NOT inlined in top_cities_by_deal_ar';
  end if;
  if v_acl is null or position('anon=X' in v_acl) = 0 then
    raise exception 'anon lost EXECUTE on top_cities_by_deal_ar (acl=%) - trending cities would 404 for real users', v_acl;
  end if;
end
$check$;

comment on function public.top_cities_by_deal_ar is
  'Trending city chips. Returns one row per city with listing_count under the CURRENT filter state, '
  'including every Advanced Filter answer (owner rule 2026-08-22: city count shown = clicking that '
  'city = actual search result count under the full current AF state). The AF predicate is NOT '
  'retyped here - the body is generated by concatenating af_eligibility_clause(), the same canonical '
  'text inlined in location_search_candidates_ar and af_eligible_count, so the three agree by '
  'construction; mon_detect_af_count_surfaces_carry_af asserts that. production_ready is ANDed on '
  'top so unlocated rows are never counted under a city we cannot prove (unlocated-search contract '
  'limb f). One server-side aggregate, not N per-city calls.';
