-- The plpgsql variable `n` collided with the oracle CTE's `n` column ("column reference n is
-- ambiguous"), so the detector could not run at all. Renamed to v_raised — a detector that
-- errors is a dark detector, which is exactly what mon_detect_orphaned/stalled exist to prevent.
create or replace function public.mon_detect_ranking_diversity_contract()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_raised int := 0; v_probe record; v_bad jsonb := '[]'::jsonb;
  v_ineligible bigint; v_count_delta bigint; v_dupes bigint;
  v_checked int := 0;
begin
  if not public.mon_claim_daily_slot('mon_detect_ranking_diversity_contract') then
    return 0;
  end if;

  for v_probe in
    select * from (values
      ('شقة',    'إيجار', 'سنوي', array['الرياض'], array['حي النرجس'],  array[1]),
      ('فيلا',   'بيع',   null,   array['جدة'],    array['حي السلامة'], array[2]),
      ('مكتب',   'بيع',   null,   null::text[],    null::text[],        null::int[]),
      ('معرض',   'إيجار', 'سنوي', null::text[],    null::text[],        null::int[]),
      ('مستودع', 'بيع',   null,   null::text[],    null::text[],        null::int[])
    ) as t(ui_type, deal, period, cities, districts, region_ids)
  loop
    v_checked := v_checked + 1;
    with scope as (
      select public.ops_qa_scope_tables(
               case when v_probe.deal='إيجار' and v_probe.period in ('شهري','كلاهما')
                    then c.scope||'m' else c.scope end) tb,
             case when c.scope2 is null then null
                  else public.ops_qa_scope_tables(
                    case when v_probe.deal='إيجار' and v_probe.period in ('شهري','كلاهما')
                         then c.scope2||'m' else c.scope2 end) end tb2,
             c.types_ar, c.scope2, c.macro
        from public.ops_qa_cohort c where c.ui_type = v_probe.ui_type),
    rpc as (
      select r.source_table||':'||r.listing_id k, r.total_count
        from scope, lateral public.location_search_candidates_ar(
          p_deal := v_probe.deal, p_cities := v_probe.cities, p_districts := v_probe.districts,
          p_tables := scope.tb, p_platforms := null, p_per_platform := null, p_limit := 1500,
          p_region_ids := v_probe.region_ids, p_types := scope.types_ar,
          p_price_min := null, p_price_max := null, p_rent_period := v_probe.period,
          p_area_min := null, p_area_max := null, p_beds_exact := null, p_beds_min := null,
          p_bath_min := null, p_furnished := null, p_age_max := null, p_tenant := null,
          p_directions := null, p_has_license := null, p_amenities := null, p_offset := 0,
          p_tables2 := scope.tb2,
          p_types2 := case when scope.scope2 is null then null else scope.types_ar end,
          p_category := scope.macro) r),
    oracle as (
      select d.n as onum, d.h as ohash
        from public.ops_qa_diff(v_probe.ui_type, v_probe.deal, v_probe.period,
               v_probe.cities, v_probe.districts, v_probe.region_ids,
               null, null, null, null, null, null) d)
    select
      case when (select onum from oracle) <= 1500
             and md5((select string_agg(k, ',' order by k) from rpc))
                 is distinct from (select ohash from oracle)
           then 1 else 0 end,
      coalesce((select max(total_count) from rpc), 0) - (select onum from oracle),
      (select count(*) - count(distinct k) from rpc)
      into v_ineligible, v_count_delta, v_dupes;

    if coalesce(v_ineligible,0) <> 0 or coalesce(v_count_delta,0) <> 0 or coalesce(v_dupes,0) <> 0 then
      v_bad := v_bad || jsonb_build_object(
        'ui_type', v_probe.ui_type, 'deal', v_probe.deal, 'period', v_probe.period,
        'cities', v_probe.cities, 'districts', v_probe.districts,
        'returned_set_differs_from_eligible_set', v_ineligible,
        'rpc_count_minus_eligible_count', v_count_delta,
        'duplicate_rows_from_diversification', v_dupes);
    end if;
  end loop;

  if jsonb_array_length(v_bad) = 0 then
    perform public.mon_resolve_key('ranking_diversity_contract','ranking_diversity_contract');
    return 0;
  end if;

  v_raised := public.mon_raise('P1','ranking_diversity_contract','all','ranking_diversity_contract',
    jsonb_build_object(
      'why','Ranking/diversification must operate strictly INSIDE the eligible set: it may reorder, never introduce a listing that fails the user filters, never duplicate a listing, and never change the count the user is shown. (Owner rule 2026-08-22.)',
      'probes_checked', v_checked,
      'violations', v_bad));
  return v_raised;
end $function$;
