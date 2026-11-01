-- THE AF RAIL CATCHES UP TO WHAT PRODUCTION ALREADY RUNS (routine-5-af-trending, 2026-09-27).
--
-- THE STATE FOUND. Four output-preserving PERFORMANCE edits landed on the two Trending count
-- surfaces on 2026-09-26 evening, each applied with a server-side replace() on the live function's
-- own definition:
--   20260926184944  district_options_ar   reads the stored district_norm_tok column (577ms -> 72ms)
--   20260926185002  top_cities_by_deal_ar cohort as MATERIALIZED (406ms -> 299ms)
--   20260926222522  top_cities_by_deal_ar coalesce(col,0) >= 0  ->  col IS NULL OR col >= 0
--   20260926222530  district_options_ar   the same stats-friendly rewrite
-- All four are correct and all four STAY. What none of them did was teach the GENERATOR --
-- af_eligibility_clause() and af_rpc_templates -- what they had done. The single definition of AF
-- eligibility therefore fell behind the functions it is supposed to generate, and three P1s have
-- been standing open ever since:
--   af_parity_empirical      (2 x af_parity_hand_edit: live md5 <> af_rpc_build_state, every 30 min)
--   af_rebuild_would_revert  (the sanctioned rebuild would DROP district_norm_tok)
--   af_count_surfaces_carry_af (both surfaces carry a stale COPY of the clause; top_cities no
--                               longer embeds it verbatim)
-- The dangerous one is the middle: rebuild_af_filter_rpcs() is the ONLY sanctioned way to change
-- these functions, and running it today would have silently reverted an 88% latency win on the
-- district picker and then stamped the reverted definition into af_rpc_build_state as correct --
-- turning the parity barrier green ON the regression. That is why the rebuild refuses today.
--
-- THE REPAIR, in the exact order the alert prescribes: port the shipped semantics INTO the
-- generator, then rebuild, then prove the six RPCs still answer what they answer today.
--
-- (1) THE CLAUSE. coalesce(s.col, 0) >= 0 hides the column from Postgres's per-column statistics,
--     so the planner falls back to a generic ~33% selectivity guess. The rewrite is provably
--     identical: for EVERY value of x, `coalesce(x,0) >= 0` and `x is null or x >= 0` agree --
--     null -> true both ways, 0 and positives -> true both ways, negatives -> false both ways.
--     That is an algebraic identity, not a property of today's rows, so it cannot drift as data
--     changes. Re-measured independently this run anyway: 0 mismatches across all 269,789 rows of
--     search_listings_ar on all three columns (area_m2, price_total, price_annual), and 0 negative
--     values in any of them. The comment this predicate sits under is unchanged and still true --
--     it blocks Ezhalah-side impossible states only, never hides a source price, 0 stays legal.
--     The clause is shared, so this reaches all six templated RPCs; for the four that were NOT
--     hand-edited it is a planner improvement with no output change, proven below.
--
-- (2) THE TWO TEMPLATES. district_norm_tok (a STORED GENERATED column added by 20260926184239) and
--     the MATERIALIZED hint are the two semantics a rebuild would otherwise drop.
--
-- (3) THE PROOF. A rebuild is output-preserving or it is a regression, and "the migration said it
--     was" is not evidence. This runs the same 13-surface probe BEFORE and AFTER the rebuild
--     inside ONE transaction -- so both halves see one data snapshot and the only variable is the
--     function definitions -- and RAISES if any hash moves. Probes are dynamic SQL because the
--     rebuild drops and recreates the functions, which would invalidate a cached plpgsql plan.
do $outer$
declare
  v_probe constant text := $q$
    select
      md5((select string_agg(t::text,'|' order by t::text) from public.top_cities_by_deal_ar(p_deal:='بيع') t))              as cities_buy,
      (select count(*) from public.top_cities_by_deal_ar(p_deal:='بيع') t)                                                    as cities_buy_rows,
      md5((select string_agg(t::text,'|' order by t::text) from public.top_cities_by_deal_ar(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة']) t)) as cities_rent_apt,
      md5((select string_agg(d::text,'|' order by d::text) from public.district_options_ar(p_city_id:=1, p_deal:='بيع') d))   as dist_riyadh_buy,
      (select count(*) from public.district_options_ar(p_city_id:=1, p_deal:='بيع') d)                                        as dist_riyadh_rows,
      md5((select string_agg(d::text,'|' order by d::text) from public.district_options_ar(p_city_id:=1, p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة']) d)) as dist_riyadh_rent_apt,
      public.af_eligible_count(p_deal:='بيع')                                                                                 as elig_buy,
      public.af_eligible_count(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'])                                 as elig_rent_apt,
      public.af_eligible_count(p_deal:='بيع', p_types:=array['فيلا'], p_furnished:=true)                                      as elig_villa_furn,
      (select r.total_count from public.location_search_candidates_ar(p_deal:='بيع', p_limit:=1) r limit 1)                   as res_buy,
      (select r.total_count from public.location_search_candidates_ar(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_limit:=1) r limit 1) as res_rent_apt,
      md5((select c::text from public.apartment_guided_counts_ar(p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة']) c)) as guided_rent_apt,
      md5((select string_agg(a::text,'|' order by a::text) from public.property_age_option_counts_ar(p_deal:='بيع') a))       as age_buy
  $q$;
  v_old text; v_new text; v_before jsonb; v_after jsonb; v_n int;
begin
  ---------------------------------------------------------------- BEFORE
  execute 'create temp table _af_before on commit drop as ' || v_probe;
  execute 'select to_jsonb(b) from _af_before b' into v_before;

  ------------------------------------------------- (1) the shared clause
  v_old := pg_get_functiondef('public.af_eligibility_clause()'::regprocedure);
  v_new := replace(v_old,
    'and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0',
    'and (s.area_m2 is null or s.area_m2 >= 0) and (s.price_total is null or s.price_total >= 0) and (s.price_annual is null or s.price_annual >= 0)');
  if v_new = v_old then
    raise exception 'af_eligibility_clause(): the coalesce predicate needle did not match — refusing a no-op';
  end if;
  execute v_new;

  ----------------------------------------------------- (2) the templates
  update public.af_rpc_templates set template = replace(template,
      'select s.district_ar' || chr(10) || '    from public.search_listings_ar s',
      'select s.district_ar, s.district_norm_tok' || chr(10) || '    from public.search_listings_ar s')
   where fn_name = 'district_options_ar';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'district_options_ar cohort-select port touched % rows (want 1)', v_n; end if;

  update public.af_rpc_templates set template = replace(template,
      'SELECT norm_district_tok(district_ar) AS tok, count(*)::int AS n' || chr(10) || '    FROM cohort WHERE district_ar IS NOT NULL GROUP BY 1',
      'SELECT district_norm_tok AS tok, count(*)::int AS n' || chr(10) || '    FROM cohort WHERE district_ar IS NOT NULL GROUP BY 1')
   where fn_name = 'district_options_ar';

  update public.af_rpc_templates set template = replace(template,
      chr(10) || ', cohort as (' || chr(10) || '    select s.city_id',
      chr(10) || ', cohort as materialized (' || chr(10) || '    select s.city_id')
   where fn_name = 'top_cities_by_deal_ar';

  -- Each port must actually be IN the template now; a silently-unmatched needle is the failure
  -- mode this whole migration exists to repair, so it fails here rather than at the next rebuild.
  if (select count(*) from public.af_rpc_templates
       where fn_name = 'district_options_ar'
         and template like '%s.district_norm_tok%' and template like '%SELECT district_norm_tok AS tok%'
         and template not like '%norm_district_tok(district_ar) AS tok%') <> 1 then
    raise exception 'district_options_ar template did not take the district_norm_tok port';
  end if;
  if (select count(*) from public.af_rpc_templates
       where fn_name = 'top_cities_by_deal_ar' and template like '%cohort as materialized%') <> 1 then
    raise exception 'top_cities_by_deal_ar template did not take the MATERIALIZED port';
  end if;

  ------------------------------------------------------- (3) the rebuild
  -- Its own fail-closed gate (af_rebuild_would_revert) runs first and must now pass, because the
  -- semantics it was protecting are in the generator as of the lines above.
  perform 1 from public.rebuild_af_filter_rpcs();

  -- The generator and production must now agree, for every templated RPC, on the whole definition
  -- and not merely on which columns it names. Whitespace-normalised because pg_get_functiondef
  -- re-serialises a CREATE it was handed (measured: the only delta on the four untouched RPCs was
  -- one trailing newline).
  if exists (
    select 1
      from public.af_rpc_templates t
      join pg_proc p on p.proname = t.fn_name and p.prokind = 'f'
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where btrim(regexp_replace(lower(replace(t.template,'__AF_ELIGIBILITY_WHERE__',public.af_eligibility_clause())),'\s+',' ','g'))
        is distinct from
           btrim(regexp_replace(lower(pg_get_functiondef(p.oid)),'\s+',' ','g'))
  ) then
    raise exception 'after rebuild, a templated RPC still differs from what the generator renders';
  end if;

  if exists (select 1 from public.af_rebuild_would_revert()) then
    raise exception 'after rebuild, af_rebuild_would_revert() is still non-empty';
  end if;

  -- The shipped optimisations survived the rebuild (the whole point of this migration).
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='district_options_ar'
         and pg_get_functiondef(p.oid) like '%district_norm_tok%') <> 1 then
    raise exception 'rebuild dropped district_norm_tok from district_options_ar';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='top_cities_by_deal_ar'
         and lower(pg_get_functiondef(p.oid)) like '%cohort as materialized%') <> 1 then
    raise exception 'rebuild dropped the MATERIALIZED hint from top_cities_by_deal_ar';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname in (select fn_name from public.af_rpc_templates)
                and pg_get_functiondef(p.oid) like '%coalesce(s.area_m2, 0) >= 0%') then
    raise exception 'a templated RPC still carries the stats-hostile coalesce predicate';
  end if;

  ----------------------------------------------------------------- AFTER
  execute 'create temp table _af_after on commit drop as ' || v_probe;
  execute 'select to_jsonb(a) from _af_after a' into v_after;

  if v_before is distinct from v_after then
    raise exception 'OUTPUT CHANGED across the rebuild — refusing. before=% after=%', v_before, v_after;
  end if;

  raise notice 'AF rail caught up; 13-surface output probe identical across the rebuild: %', v_before;
end
$outer$;
