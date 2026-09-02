-- ops_nf_cert_cell built every optional clause with coalesce(format('... %s', v), ''). format()
-- renders a NULL argument as an EMPTY STRING, so the format() call never returns NULL and the
-- coalesce never dropped the clause: every cell without a region produced ` and s.region_id = `
-- and all 200 part-0 cells failed with `syntax error at or near "and"`. Optional pieces are now
-- emitted only when their value is present. The AF runner passes non-null literals and was not
-- affected.
create or replace function public.ops_nf_cert_cell(p_tag text, p_kind text, p jsonb)
returns void language plpgsql as $fn$
declare
  v_deal text := p ->> 'deal'; v_period text := p ->> 'period';
  v_city text := p ->> 'city'; v_district text := p ->> 'district'; v_type text := p ->> 'type';
  v_platform text := p ->> 'platform'; v_region int := (p ->> 'region_id')::int;
  v_pmin numeric := (p ->> 'price_min')::numeric; v_pmax numeric := (p ->> 'price_max')::numeric;
  v_amin int := (p ->> 'area_min')::int; v_amax int := (p ->> 'area_max')::int;
  v_beds int[] := case when p ? 'beds_exact' then array(select (x)::int from jsonb_array_elements_text(p -> 'beds_exact') x) end;
  v_beds_min int := (p ->> 'beds_min')::int;
  v_args text; v_pred text; t0 timestamptz := clock_timestamp();
  v_located boolean := v_city is not null or v_district is not null or v_region is not null;
  v_k int := case when v_period = 'شهري' then 12 else 1 end;
  v_truth bigint; v_rpc_n bigint; v_rpc_d bigint; v_rpc_total bigint; v_missing bigint; v_extra bigint;
begin
  v_args := format('p_deal:=%L', v_deal)
         || case when v_period   is null then '' else format(', p_rent_period:=%L', v_period) end
         || case when v_city     is null then '' else format(', p_cities:=array[%L]::text[]', v_city) end
         || case when v_district is null then '' else format(', p_districts:=array[%L]::text[]', v_district) end
         || case when v_type     is null then '' else format(', p_types:=array[%L]::text[]', v_type) end
         || case when v_platform is null then '' else format(', p_platforms:=array[%L]::text[]', v_platform) end
         || case when v_region   is null then '' else format(', p_region_ids:=array[%s]::int[]', v_region) end
         || case when v_pmin     is null then '' else format(', p_price_min:=%s', v_pmin) end
         || case when v_pmax     is null then '' else format(', p_price_max:=%s', v_pmax) end
         || case when v_amin     is null then '' else format(', p_area_min:=%s', v_amin) end
         || case when v_amax     is null then '' else format(', p_area_max:=%s', v_amax) end
         || case when v_beds     is null then '' else format(', p_beds_exact:=array[%s]::int[]', array_to_string(v_beds, ',')) end
         || case when v_beds_min is null then '' else format(', p_beds_min:=%s', v_beds_min) end;

  v_pred := format('s.deal_ar = %L', v_deal)
         || case when v_located then ' and s.production_ready'
                 else ' and (s.production_ready or s.city_id is null or s.region_id is null)' end
         || ' and (not s.production_ready or (s.city_id is not null and s.region_id is not null))'
         || ' and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0'
         || case
              when v_period is null then ''
              when v_period = 'شهري' then $s$ and (s.deal_ar <> 'إيجار' or (s.rent_period_ar = 'شهري' and not coalesce(s.rent_now_pay_later, false)))$s$
              when v_period = 'سنوي' then $s$ and (s.deal_ar <> 'إيجار' or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false)))$s$
              when v_period = 'كلاهما' then $s$ and (s.deal_ar <> 'إيجار' or (s.rent_period_ar = 'شهري' and not coalesce(s.rent_now_pay_later, false)) or s.rent_period_ar = 'سنوي' or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false)))$s$
              else format(' and s.rent_period_ar = %L', v_period) end
         || case when v_city is null then '' else format($c$ and (normalize_ar(s.city_ar) = normalize_ar(%1$L)
                                     or s.city_id in (select city_id from public.loc_catalog_city where city_norm = normalize_ar(%1$L))
                                     or s.match_city_ids && (select array_agg(city_id) from public.loc_catalog_city where city_norm = normalize_ar(%1$L)))$c$, v_city) end
         || case when v_district is null then '' else format(' and norm_district_tok(s.district_ar) = norm_district_tok(%L)', v_district) end
         || case when v_type     is null then '' else format(' and s.type_ar = %L', v_type) end
         || case when v_platform is null then '' else format(' and s.platform = %L', v_platform) end
         || case when v_region   is null then '' else format(' and s.region_id = %s', v_region) end
         || case when v_pmin is null and v_pmax is null then ''
                 when v_deal = 'بيع' then format(' and s.price_total is not null and s.price_total > 0 and s.price_total >= %s and s.price_total <= %s',
                                                 coalesce(v_pmin, 0), coalesce(v_pmax, 1e15))
                 else format(' and s.price_annual is not null and s.price_annual > 0 and s.price_annual >= %s and s.price_annual <= %s',
                             coalesce(v_pmin, 0) * v_k, coalesce(v_pmax, 1e15) * v_k) end
         || case when v_amin is null and v_amax is null then ''
                 else format(' and s.area_m2 is not null and s.area_m2 >= %s and s.area_m2 <= %s', coalesce(v_amin, 0), coalesce(v_amax, 2147483647)) end
         || case when v_beds     is null then '' else format(' and s.bedrooms = any(array[%s]::int[])', array_to_string(v_beds, ',')) end
         || case when v_beds_min is null then '' else format(' and s.bedrooms >= %s', v_beds_min) end;

  begin
    execute format('select count(*) from public.search_listings_ar s where %s', v_pred) into v_truth;
    execute format($q$
      with rpc as (
        select r.source_table, r.listing_id, r.total_count
          from public.location_search_candidates_ar(%s, p_limit := %s, p_per_platform := null) r),
      rpcd as (select distinct source_table, listing_id from rpc),
      truth as (select s.source_table, s.listing_id from public.search_listings_ar s where %s)
      select (select count(*) from rpc), (select count(*) from rpcd), (select max(total_count) from rpc),
             (select count(*) from truth t where not exists
                (select 1 from rpcd r where r.source_table = t.source_table and r.listing_id = t.listing_id)),
             (select count(*) from rpcd r where not exists
                (select 1 from truth t where t.source_table = r.source_table and t.listing_id = r.listing_id))
    $q$, v_args, coalesce(v_truth, 0) + 1000, v_pred)
    into v_rpc_n, v_rpc_d, v_rpc_total, v_missing, v_extra;

    insert into public.ops_af_cert_result
      (run_tag, kind, cohort, opt, params, truth, rpc_total, rpc_n, rpc_distinct, missing, extra, elapsed_ms)
    values (p_tag, 'nf', p_kind, coalesce(v_city, v_type, v_platform, v_region::text, v_period, v_deal), p,
            v_truth, v_rpc_total, v_rpc_n, v_rpc_d, v_missing, v_extra,
            (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  exception when others then
    insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, params, err, elapsed_ms)
    values (p_tag, 'nf', p_kind, coalesce(v_city, v_type, v_platform, v_region::text, v_period, v_deal), p,
            sqlstate || ': ' || sqlerrm, (extract(epoch from clock_timestamp() - t0) * 1000)::int);
  end;
end $fn$;

-- PROOF: a cell with no optional argument, and one with every optional argument, must both run
-- without an error row. Uses a throwaway tag and removes its rows.
do $proof$
declare v_err text;
begin
  perform public.ops_nf_cert_cell('__proof__', 'deal', '{"deal":"بيع"}');
  perform public.ops_nf_cert_cell('__proof__', 'combo', '{"deal":"إيجار","period":"شهري","city":"الرياض","type":"شقة","price_min":1000,"price_max":9000,"area_min":50,"area_max":400,"beds_exact":[1,2],"region_id":1}');
  select string_agg(err, ' | ') into v_err from public.ops_af_cert_result where run_tag = '__proof__' and err is not null;
  delete from public.ops_af_cert_result where run_tag = '__proof__';
  if v_err is not null then raise exception 'ops_nf_cert_cell still errors: %', v_err; end if;
end
$proof$;
