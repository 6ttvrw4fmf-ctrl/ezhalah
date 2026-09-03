-- district_options_ar counts the set SEARCH can return — one eligibility implementation, not two.
--
-- THE DEFECT (2026-09-03). district_options_ar carried its OWN hand-written eligibility: deal,
-- rent period, types and category, and nothing else. It had no p_tables at all, so while the
-- results RPC was scoped to RES_TABLES/COM_TABLES the district panel counted EVERY platform table
-- in search_listings_ar. Five platforms went live on 2026-09-03 without joining the client lists
-- (abralosol, arkaan, therc, rawasidark, aouj — 4,314 production_ready rows) and the district
-- numbers immediately began promising listings no search can return. Trending was fixed in the
-- client (PR #1647) because top_cities_by_deal_ar already took p_tables; this one could not be,
-- because the argument did not exist — PostgREST answered PGRST202.
--
-- THE FIX IS THE SAME ONE TRENDING GOT: stop having a second opinion about eligibility. The cohort
-- CTE is now af_eligibility_clause() — the exact predicate text location_search_candidates_ar and
-- top_cities_by_deal_ar already share — so a district count and a search result can no longer
-- disagree about what is eligible, for tables or for anything else. As a side effect the panel
-- becomes advanced-filter aware, which is the same identity stated for every other count surface.
--
-- BUILT EXACTLY LIKE ITS SIBLING. The clause references the district_tokens / city_tokens / city_ids
-- CTEs, so those are extracted from af_eligible_count verbatim — the same source, the same needle,
-- and the same landmark assertions that 20260822141945 uses for top_cities_by_deal_ar. They carry
-- the 2026-08-15 / 2026-08-18 ambiguity guards (an English place name is bridged only when it
-- resolves to exactly ONE canonical Arabic place); retyping them is how a guard gets lost.
--
-- WHAT IS PRESERVED, AND HOW. Everything after the cohort — the norm_district_tok folding, the
-- loc_canonical_district LEFT JOIN that keeps zero-count districts in the list, and the ء-folding
-- GROUP BY — is EXTRACTED FROM THE LIVE FUNCTION rather than retyped, and the extraction asserts
-- its own landmarks. Retyping a live body is how a guard gets silently dropped (see
-- 20260721100654_reapply_district_options_invalid_category_guard_after_period_scope_clobber.sql,
-- which exists because exactly that happened to THIS function).
--
-- The old `valid_category` CTE is deliberately gone: af_eligibility_clause() carries the identical
-- 'Residential'/'Commercial'/'both' rule against known_type_ar, including the source_table
-- disambiguation for macro='both'. Keeping ours would have been the second implementation again.
--
-- OVERLOAD SAFETY. The argument list changes, so `create or replace` would leave a SECOND function
-- and PostgREST would resolve by argument names — a coin flip between the fixed and broken bodies.
-- The old 5-arg overload is therefore DROPPED explicitly, without CASCADE, so an unnoticed
-- dependency fails loudly instead of being silently removed. The self-assertion at the end fails
-- the migration if more than one overload survives.
do $mig$
declare
  v_src   text;
  v_cte   text;
  v_def   text;
  v_tail  text;
  v_where text := public.af_eligibility_clause();
  v_params text;
  v_ddl   text;
begin
  -- ── the CTE scaffolding the clause depends on, from the same source 20260822141945 uses ────────
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'af_eligible_count';
  if v_src is null then raise exception 'af_eligible_count not found - cannot source the CTE block'; end if;
  v_cte := substring(v_src from position('  with district_tokens as (' in v_src)
                     for position('  select count(*)' in v_src) - position('  with district_tokens as (' in v_src));
  if v_cte is null or length(v_cte) < 800 then
    raise exception 'CTE extraction failed (len %) - refusing a blind rebuild', coalesce(length(v_cte), 0);
  end if;
  if position('city_ids as (' in v_cte) = 0 or position('city_name_bridge' in v_cte) = 0
     or position('district_name_bridge' in v_cte) = 0 then
    raise exception 'extracted CTE block is missing an expected guard - refusing';
  end if;

  -- ── the district-specific half, taken verbatim from what is RUNNING right now ───────────────
  v_def := pg_get_functiondef('public.district_options_ar(integer,text,text,text,text[])'::regprocedure);
  v_tail := substring(v_def from position('  total AS (SELECT count(*)::int AS t FROM cohort),' in v_def));
  if v_tail is null or length(v_tail) < 600 then
    raise exception 'district tail extraction failed (len %) - refusing a blind rebuild', coalesce(length(v_tail), 0);
  end if;
  if position('norm_district_tok' in v_tail) = 0
     or position('loc_canonical_district' in v_tail) = 0
     or position('GROUP BY fold' in v_tail) = 0
     or position('total_in_city' in v_tail) = 0 then
    raise exception 'extracted district tail is missing an expected landmark - refusing';
  end if;
  v_tail := regexp_replace(v_tail, '\$function\$\s*$', '');

  if length(v_where) < 3000 then
    raise exception 'af_eligibility_clause() returned % chars - refusing', length(v_where);
  end if;
  if position('p_tables' in v_where) = 0 or position('p_tables2' in v_where) = 0 then
    raise exception 'af_eligibility_clause() carries no table predicate - refusing, that is the whole fix';
  end if;

  -- p_city_id first, then the ORIGINAL four in their original order (so any positional caller that
  -- still exists keeps working), then the rest of the clause's parameters.
  v_params :=
    'p_city_id integer, p_deal text default null, p_category text default null, '
    'p_rent_period text default null, p_types text[] default null, '
    'p_cities text[] default null, p_districts text[] default null, '
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
    'create function public.district_options_ar(' || v_params || ')' || E'\n' ||
    ' returns table(district_ar text, listing_count integer, match_values text[], total_in_city integer)' || E'\n' ||
    ' language sql stable as $fn$' || E'\n' ||
    v_cte ||
    ', cohort as (' || E'\n' ||
    '    select s.district_ar' || E'\n' ||
    '    from public.search_listings_ar s' || E'\n' ||
    v_where ||
    '      -- THIS panel is always one city, and a COUNT SURFACE STAYS production_ready-SCOPED:' || E'\n' ||
    '      -- both override the clause''s unlocated carve-out, exactly as top_cities_by_deal_ar does.' || E'\n' ||
    '      and s.city_id = p_city_id' || E'\n' ||
    '      and s.production_ready = true' || E'\n' ||
    '  ),' || E'\n' ||
    v_tail ||
    '$fn$';

  execute 'drop function if exists public.district_options_ar(integer, text, text, text, text[])';
  execute v_ddl;
end
$mig$;

-- The pre-existing grants, restored explicitly: a dropped function takes its ACL with it, and this
-- RPC is called through the anon key, so forgetting them would break the district panel for every user.
grant execute on function public.district_options_ar(integer, text, text, text, text[], text[], text[],
  text[], text[], integer[], text[], text[], integer[], integer, numeric, numeric, integer, integer,
  integer, integer, boolean, boolean, text[], integer, integer[], boolean, text, text[], boolean,
  smallint, smallint, integer, integer, numeric, integer, text[], numeric, numeric)
  to anon, authenticated, service_role;

-- SELF-ASSERTION — the migration proves its own outcome instead of trusting that it ran.
do $check$
declare
  v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'district_options_ar';
  if v_n <> 1 then
    raise exception 'expected exactly ONE district_options_ar overload, found % - the old one survived', v_n;
  end if;
  if (select pg_get_functiondef(p.oid) not like '%p_tables%'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'district_options_ar') then
    raise exception 'the rebuilt district_options_ar has no p_tables predicate - the splice did not take';
  end if;
end
$check$;
