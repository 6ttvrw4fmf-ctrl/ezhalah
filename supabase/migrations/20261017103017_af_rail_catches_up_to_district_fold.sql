-- 🔬 AF engineer 2026-10-17: the AF rail catches up to the 10-16 district fold (P1 af_parity_empirical).
--
-- 20261016203502 (district_list_folds_space_and_hamza_spellings) edited district_options_ar AND its
-- af_rpc_templates row with the same needle, but did not run rebuild_af_filter_rpcs(), so
-- af_rpc_build_state still holds the 10-09 hash (e4f0df97…) and mon_af_predicate_parity raises
-- af_parity_hand_edit every hour since 10-16 20:43. That row shares the af_parity_empirical dedup key
-- with the EMPIRICAL count = results probe, so while it stands a real count/results break raises nothing
-- new (the rulebook's Falcon 10-09 trap). Measured before writing this: every templated RPC already equals
-- what the generator renders (whitespace-normalised) and af_rebuild_would_revert() is empty, so the
-- rebuild is output-preserving by construction. This proves it anyway, the 20260927111536 way: the same
-- 13-surface probe BEFORE and AFTER the rebuild in ONE transaction, refusing if any value moves.
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
  v_before jsonb; v_after jsonb;
begin
  execute 'create temp table _af_before on commit drop as ' || v_probe;
  execute 'select to_jsonb(b) from _af_before b' into v_before;

  perform 1 from public.rebuild_af_filter_rpcs();

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
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='district_options_ar'
         and pg_get_functiondef(p.oid) like '%اااايه%') <> 1 then
    raise exception 'rebuild dropped the 10-16 spelling fold from district_options_ar';
  end if;
  if (select def_md5 from public.af_rpc_build_state where fn_name = 'district_options_ar')
     is distinct from (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and p.proname='district_options_ar') then
    raise exception 'af_rpc_build_state does not hold the live district_options_ar hash after the rebuild';
  end if;

  execute 'create temp table _af_after on commit drop as ' || v_probe;
  execute 'select to_jsonb(a) from _af_after a' into v_after;
  if v_before is distinct from v_after then
    raise exception 'OUTPUT CHANGED across the rebuild — refusing. before=% after=%', v_before, v_after;
  end if;
  raise notice 'AF rail caught up to the 10-16 fold; 13-surface probe identical across the rebuild: %', v_before;
end
$outer$;