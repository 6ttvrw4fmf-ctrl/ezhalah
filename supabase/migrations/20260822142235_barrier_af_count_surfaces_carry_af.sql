-- A COUNT SURFACE THAT DROPS AN ADVANCED-FILTER PARAM LIES TO THE USER.
--
-- Owner rule (2026-08-22): the number shown must equal the actual result count under the full
-- current AF state -- for district chips AND city chips. Two ways that breaks, and this barrier
-- watches both:
--   1. a count RPC stops applying the canonical AF predicate (backend drift), or
--   2. a count RPC never had the AF parameters at all (the city defect fixed by 20260822141945).
--
-- STRUCTURAL LIMBS (cheap, always evaluated):
--   (a) af_eligibility_clause() must be inlined BYTE-IDENTICALLY in all three AF-aware surfaces:
--       location_search_candidates_ar (results), af_eligible_count, top_cities_by_deal_ar (chips).
--       Byte-identity is what makes "the chip and the result agree" a property of construction
--       rather than of somebody remembering to update three places (run #29's lesson: a rule fixed
--       in one stage and left wrong in others is, to the user, the same as never fixing it).
--   (b) top_cities_by_deal_ar must still DECLARE the AF parameters. Inlining the clause is not
--       enough -- without the parameters the clause cannot be driven by an answered question.
--   (c) exactly ONE overload of top_cities_by_deal_ar. Two overloads is the PGRST203 shape that
--       took search down on 2026-07-16, and with defaulted params it is easy to create by accident.
--   (d) anon must retain EXECUTE, or the chips 404 for every real user while every other limb is
--       green.
--
-- BEHAVIOURAL LIMB (2 RPC calls, deliberately tiny so it can run every sweep rather than behind a
-- daily gate): take the top city under a fixed stacked AF state and assert the chip count equals
-- what clicking that city actually returns. Structure can be right while semantics drift; this is
-- the limb that would have caught the original city defect on day one.
--
-- Raise and resolve share ONE predicate (section 25a): the same `bad` array drives both branches,
-- so there is no separately-worded self-heal clause that could disagree with the raise.

create or replace function public.mon_detect_af_count_surfaces_carry_af()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clause text := public.af_eligibility_clause();
  bad jsonb := '[]'::jsonb; n int := 0; v_def text; v_acl text; v_n int;
  fn text; v_chip int; v_click int; v_city text;
begin
  -- (a) canonical clause inlined in every AF-aware surface
  foreach fn in array array['location_search_candidates_ar','af_eligible_count','top_cities_by_deal_ar'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = fn
     limit 1;
    if v_def is null then
      bad := bad || jsonb_build_object('kind','af_surface_missing','fn',fn);
    elsif position(v_clause in v_def) = 0 then
      bad := bad || jsonb_build_object('kind','af_clause_not_inlined','fn',fn,
        'why','this surface no longer embeds af_eligibility_clause() verbatim, so its answer can '
           || 'diverge from the results RPC. Regenerate it by concatenating the clause; do not '
           || 'retype the predicate.');
    end if;
  end loop;

  -- (b) the chip RPC must declare the AF parameters
  select pg_get_function_identity_arguments(p.oid) into v_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar' limit 1;
  if v_def is null then
    bad := bad || jsonb_build_object('kind','city_chip_rpc_missing');
  else
    foreach fn in array array['p_amenities','p_bath_min','p_furnished','p_rating_min','p_reviews_min',
                              'p_unit_subtypes','p_directions','p_street_width_min','p_age_min',
                              'p_age_max','p_is_new_construction'] loop
      if position(fn in v_def) = 0 then
        bad := bad || jsonb_build_object('kind','city_chip_rpc_dropped_af_param','param',fn,
          'why','top_cities_by_deal_ar no longer accepts this advanced-filter parameter, so an '
             || 'answered question cannot reach the city chip count and the chip overstates.');
      end if;
    end loop;
  end if;

  -- (c) exactly one overload
  select count(*) into v_n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar';
  if v_n <> 1 then
    bad := bad || jsonb_build_object('kind','city_chip_rpc_overloaded','overloads',v_n,
      'why','more than one top_cities_by_deal_ar signature - PostgREST cannot choose (PGRST203, the '
         || '2026-07-16 search outage shape).');
  end if;

  -- (d) anon can still call it
  select p.proacl::text into v_acl
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'top_cities_by_deal_ar' limit 1;
  if v_acl is not null and position('anon=X' in v_acl) = 0 then
    bad := bad || jsonb_build_object('kind','city_chip_rpc_anon_execute_revoked','acl',v_acl);
  end if;

  -- BEHAVIOURAL: chip count must equal click-through count under a stacked AF state.
  if v_n = 1 then
    begin
      select city_ar, listing_count into v_city, v_chip
        from public.top_cities_by_deal_ar(
               p_deal=>'إيجار', p_rent_period=>'سنوي', p_category=>'Residential',
               p_types=>array['شقة'], p_amenities=>array['elevator'], p_bath_min=>3)
       order by listing_count desc limit 1;
      if v_city is not null then
        select r.total_count into v_click
          from public.location_search_candidates_ar(
                 p_deal=>'إيجار', p_rent_period=>'سنوي', p_category=>'Residential',
                 p_types=>array['شقة'], p_amenities=>array['elevator'], p_bath_min=>3,
                 p_cities=>array[v_city], p_limit=>1, p_offset=>0) r limit 1;
        if coalesce(v_chip,-1) is distinct from coalesce(v_click,-2) then
          bad := bad || jsonb_build_object('kind','city_chip_count_diverges_from_click_through',
            'city', v_city, 'chip', v_chip, 'click_through', v_click,
            'why','the trending city chip advertises a different number than clicking that city '
               || 'returns, under the same advanced-filter state. Owner rule: they must be equal.');
        end if;
      end if;
    exception when others then
      bad := bad || jsonb_build_object('kind','af_parity_probe_failed','error',sqlerrm);
    end;
  end if;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1','af_count_surfaces_carry_af','search_index','af_count_surfaces_carry_af',
      jsonb_build_object('failures', bad,
        'why','A count surface must reflect every answered Advanced Filter question. Owner rule '
           || '2026-08-22: count shown = click-through result count = RPC truth = DB truth, under '
           || 'the exact current category/group/type/deal/period/city/district/price/area/beds and '
           || 'AF answers.',
        'do_not','Do NOT fix this by adjusting a displayed number. Fix the surface so it applies '
           || 'the canonical predicate, or restore the parameter it stopped accepting.'));
  else
    perform public.mon_resolve_key('af_count_surfaces_carry_af','af_count_surfaces_carry_af');
  end if;
  return n;
end
$function$;

comment on function public.mon_detect_af_count_surfaces_carry_af() is
  'Owner rule 2026-08-22: a trending count must equal what clicking it returns under the full '
  'Advanced Filter state. Structural limbs assert af_eligibility_clause() is inlined byte-identically '
  'in the results RPC, af_eligible_count and top_cities_by_deal_ar, that the chip RPC still declares '
  'the AF parameters, that exactly one overload exists (PGRST203 guard) and that anon kept EXECUTE. '
  'A behavioural limb compares one chip against its own click-through under a stacked AF state. '
  'Deliberately only 2 RPC calls so it runs every sweep instead of behind a daily gate. A standing 0 '
  'is the healthy reading.';

-- Roster registration in the SAME migration (a detector outside mon_run_all_detectors is decoration,
-- and mon_detect_orphaned_detectors fires on anything nothing reaches). Needle-edit against the LIVE
-- body -- never a pasted array, which is how the roster lost entries four times.
do $roster$
declare
  src text; needle text := '''mon_detect_af_source_mapping_integrity'',';
  ins text := '''mon_detect_af_source_mapping_integrity'',
    ''mon_detect_af_count_surfaces_carry_af'',';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_af_count_surfaces_carry_af' in src) > 0 then
    raise notice 'already registered'; return;
  end if;
  if (length(src) - length(replace(src, needle, ''))) / length(needle) <> 1 then
    raise exception 'roster needle not found exactly once - refusing a blind edit';
  end if;
  execute replace(src, needle, ins);
end
$roster$;

do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_af_count_surfaces_carry_af' in src) = 0 then
    raise exception 'roster registration failed - detector would be decoration';
  end if;
end
$check$;
