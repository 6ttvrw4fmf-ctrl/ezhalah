-- FULL-SET CERTIFICATION RUNNER: SOURCE-INDEX FIDELITY, NORMAL FILTER, ADVANCED FILTER.
--
-- The daily detectors are counts. A major certification (docs/ops/SEARCH_MATCH_QA_ENGINEER.md §40)
-- must prove SET EQUALITY: for every cell, the exact (source_table, listing_id) set the live RPC
-- returns equals the set plain SQL selects under the documented semantics — missing = extra =
-- duplicates = 0 — and every returned row satisfies the selected predicates on its own columns.
-- That is too heavy for a detector tick and far too heavy for the 60 s an interactive MCP call gets,
-- so it runs inside the database under pg_cron with a long statement_timeout and writes every cell
-- to ops_af_cert_result. The tables and functions are ops objects and stay: the next major
-- certification re-runs them under a new run_tag instead of rebuilding the machinery.
--
-- Three kinds of cell:
--   af        one certified cohort × one Advanced Filter option (af_option_truth_table()), plus a
--             SCOPE cell per cohort: chip (apartment_guided_counts_ar / property_age_option_counts_ar),
--             applied (af_eligible_count), truth (ops_af_option_db_truth — no shared SQL), and the
--             result set (location_search_candidates_ar with p_limit above every count) diffed
--             against the truth set by key, plus viol = returned rows failing the option predicate.
--   nf        one Normal Filter intent (deal, period, city, district, type, platform, region, price,
--             area, bedrooms, and combinations) — same truth-vs-RPC set diff.
--   src_index one index column vs the sync source it is written from (listing_native_location_v2,
--             listing_rich_attrs, the rent_now_pay_later source columns, gathern additional_info):
--             extra = rows where the served value differs from what the next sync would write.

create table if not exists public.ops_af_cert_result (
  id bigserial primary key,
  run_tag text not null,
  kind text not null,
  cohort text, opt text, params jsonb,
  chip bigint, applied bigint, truth bigint,
  rpc_total bigint, rpc_n bigint, rpc_distinct bigint,
  missing bigint, extra bigint, viol bigint,
  elapsed_ms integer, ran_at timestamptz not null default now(), err text
);
create index if not exists ops_af_cert_result_tag_kind on public.ops_af_cert_result (run_tag, kind);

-- ── AF: one cohort, every option, set-exact ────────────────────────────────────────────────────
create or replace function public.ops_af_cert_cohort(p_tag text, p_deal text, p_period text, p_type text)
returns integer language plpgsql as $fn$
declare
  v_cohort text := p_type || '|' || p_deal || '|' || coalesce(p_period, '-');
  v_base text; v_pred text; v_counts jsonb; v_age jsonb;
  o record; t0 timestamptz; v_cells int := 0;
  v_chip bigint; v_applied bigint; v_truth bigint;
  v_rpc_n bigint; v_rpc_d bigint; v_rpc_total bigint; v_missing bigint; v_extra bigint; v_viol bigint;
  v_arg text;
begin
  v_base := format('p_deal:=%L, p_types:=array[%L]::text[]', p_deal, p_type)
            || coalesce(format(', p_rent_period:=%L', p_period), '');
  v_pred := public.ops_af_cohort_predicate_sql(p_deal, p_period, p_type);
  execute format('select to_jsonb(g) from public.apartment_guided_counts_ar(%s) g', v_base) into v_counts;
  execute format('select to_jsonb(a) from public.property_age_option_counts_ar(%s) a', v_base) into v_age;

  for o in
    select * from public.af_option_truth_table()
    union all select 'SCOPE', 'cnt_total_base', '', 'true', 'scope'
  loop
    t0 := clock_timestamp();
    begin
      v_chip := (case o.family when 'age' then v_age ->> o.cnt_col else v_counts ->> o.cnt_col end)::bigint;
      v_arg := case when o.af_param = '' then '' else ', ' || o.af_param end;
      execute format('select public.af_eligible_count(%s%s)', v_base, v_arg) into v_applied;
      v_truth := public.ops_af_option_db_truth(p_deal, p_period, p_type, o.row_pred);
      execute format($q$
        with rpc as (
          select r.source_table, r.listing_id, r.total_count
            from public.location_search_candidates_ar(%s%s, p_limit := %s, p_per_platform := null) r),
        rpcd as (select distinct source_table, listing_id from rpc),
        truth as (
          select s.source_table, s.listing_id from public.search_listings_ar s where %s and (%s))
        select (select count(*) from rpc),
               (select count(*) from rpcd),
               (select max(total_count) from rpc),
               (select count(*) from truth t where not exists
                  (select 1 from rpcd r where r.source_table = t.source_table and r.listing_id = t.listing_id)),
               (select count(*) from rpcd r where not exists
                  (select 1 from truth t where t.source_table = r.source_table and t.listing_id = r.listing_id)),
               (select count(*) from rpcd r
                  join public.search_listings_ar s on s.source_table = r.source_table and s.listing_id = r.listing_id
                 where not (%s))
      $q$, v_base, v_arg,
           greatest(coalesce(v_chip, 0), coalesce(v_truth, 0), coalesce(v_applied, 0)) + 1000,
           v_pred, o.row_pred, o.row_pred)
      into v_rpc_n, v_rpc_d, v_rpc_total, v_missing, v_extra, v_viol;

      insert into public.ops_af_cert_result
        (run_tag, kind, cohort, opt, params, chip, applied, truth, rpc_total, rpc_n, rpc_distinct, missing, extra, viol, elapsed_ms)
      values (p_tag, 'af', v_cohort, o.label,
              jsonb_build_object('deal', p_deal, 'period', p_period, 'type', p_type, 'af_param', o.af_param),
              v_chip, v_applied, v_truth, v_rpc_total, v_rpc_n, v_rpc_d, v_missing, v_extra, v_viol,
              (extract(epoch from clock_timestamp() - t0) * 1000)::int);
      v_cells := v_cells + 1;
    exception when others then
      insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, params, err, elapsed_ms)
      values (p_tag, 'af', v_cohort, o.label,
              jsonb_build_object('deal', p_deal, 'period', p_period, 'type', p_type, 'af_param', o.af_param),
              sqlstate || ': ' || sqlerrm, (extract(epoch from clock_timestamp() - t0) * 1000)::int);
    end;
  end loop;
  return v_cells;
end $fn$;

create or replace function public.ops_af_cert_run(p_tag text, p_slice int, p_slices int)
returns integer language plpgsql as $fn$
declare c record; n int := 0;
begin
  if not pg_try_advisory_lock(hashtext('ops_af_cert_run:' || p_tag || ':' || p_slice)) then
    return -1;                                    -- another instance of this slice is running
  end if;
  for c in
    select * from (
      select r.deal_ar, r.rent_period_ar, r.type_ar,
             (row_number() over (order by r.deal_ar, r.rent_period_ar nulls first, r.type_ar) - 1) as rn
        from public.af_cohort_registry r where r.enabled) z
    where mod(z.rn, greatest(p_slices, 1)) = p_slice
    order by z.rn
  loop
    n := n + public.ops_af_cert_cohort(p_tag, c.deal_ar, c.rent_period_ar, c.type_ar);
  end loop;
  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth)
  values (p_tag, 'marker', 'af_slice_' || p_slice || '_of_' || p_slices, 'done', n);
  perform pg_advisory_unlock(hashtext('ops_af_cert_run:' || p_tag || ':' || p_slice));
  return n;
end $fn$;

-- ── NF: one Normal Filter intent, set-exact ────────────────────────────────────────────────────
-- Truth follows the documented Normal Filter semantics (docs/ARCHITECTURE.md §4, §17):
--   deal exact; rent period شهري / سنوي as in ops_af_cohort_predicate_sql, كلاهما = the OR of the two;
--   a location filter (city/district/region) makes reachability exactly production_ready, otherwise the
--   unlocated fallback applies; city = the canonical city (label, catalog id, or multi-city membership);
--   district = the normalised district token WITHIN the chosen city; type/platform/region exact;
--   Buy price on price_total > 0, Rent price on price_annual > 0 (×12 when the period is شهري);
--   area and bedrooms only on rows that publish them.
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
         || coalesce(format(', p_rent_period:=%L', v_period), '')
         || coalesce(format(', p_cities:=array[%L]::text[]', v_city), '')
         || coalesce(format(', p_districts:=array[%L]::text[]', v_district), '')
         || coalesce(format(', p_types:=array[%L]::text[]', v_type), '')
         || coalesce(format(', p_platforms:=array[%L]::text[]', v_platform), '')
         || coalesce(format(', p_region_ids:=array[%s]::int[]', v_region), '')
         || coalesce(format(', p_price_min:=%s', v_pmin), '')
         || coalesce(format(', p_price_max:=%s', v_pmax), '')
         || coalesce(format(', p_area_min:=%s', v_amin), '')
         || coalesce(format(', p_area_max:=%s', v_amax), '')
         || coalesce(format(', p_beds_exact:=array[%s]::int[]', array_to_string(v_beds, ',')), '')
         || coalesce(format(', p_beds_min:=%s', v_beds_min), '');

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
         || coalesce(format($c$ and (normalize_ar(s.city_ar) = normalize_ar(%1$L)
                                     or s.city_id in (select city_id from public.loc_catalog_city where city_norm = normalize_ar(%1$L))
                                     or s.match_city_ids && (select array_agg(city_id) from public.loc_catalog_city where city_norm = normalize_ar(%1$L)))$c$, v_city), '')
         || coalesce(format(' and norm_district_tok(s.district_ar) = norm_district_tok(%L)', v_district), '')
         || coalesce(format(' and s.type_ar = %L', v_type), '')
         || coalesce(format(' and s.platform = %L', v_platform), '')
         || coalesce(format(' and s.region_id = %s', v_region), '')
         || case when v_pmin is null and v_pmax is null then ''
                 when v_deal = 'بيع' then format(' and s.price_total is not null and s.price_total > 0 and s.price_total >= %s and s.price_total <= %s',
                                                 coalesce(v_pmin, 0), coalesce(v_pmax, 1e15))
                 else format(' and s.price_annual is not null and s.price_annual > 0 and s.price_annual >= %s and s.price_annual <= %s',
                             coalesce(v_pmin, 0) * v_k, coalesce(v_pmax, 1e15) * v_k) end
         || case when v_amin is null and v_amax is null then ''
                 else format(' and s.area_m2 is not null and s.area_m2 >= %s and s.area_m2 <= %s', coalesce(v_amin, 0), coalesce(v_amax, 2147483647)) end
         || coalesce(format(' and s.bedrooms = any(array[%s]::int[])', array_to_string(v_beds, ',')), '')
         || coalesce(format(' and s.bedrooms >= %s', v_beds_min), '');

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

create or replace function public.ops_nf_cert_run(p_tag text, p_part int)
returns integer language plpgsql as $fn$
declare r record; n int := 0; d text; per text;
begin
  if not pg_try_advisory_lock(hashtext('ops_nf_cert_run:' || p_tag || ':' || p_part)) then return -1; end if;

  if p_part = 0 then
    foreach d in array array['بيع','إيجار'] loop
      perform public.ops_nf_cert_cell(p_tag, 'deal', jsonb_build_object('deal', d)); n := n + 1;
    end loop;
    foreach per in array array['شهري','سنوي','كلاهما'] loop
      perform public.ops_nf_cert_cell(p_tag, 'deal_period', jsonb_build_object('deal', 'إيجار', 'period', per)); n := n + 1;
    end loop;
    for r in select distinct s.type_ar, s.deal_ar from public.search_listings_ar s where s.type_ar is not null loop
      perform public.ops_nf_cert_cell(p_tag, 'type', jsonb_build_object('deal', r.deal_ar, 'type', r.type_ar)); n := n + 1;
    end loop;
    for r in select distinct s.platform, s.deal_ar from public.search_listings_ar s loop
      perform public.ops_nf_cert_cell(p_tag, 'platform', jsonb_build_object('deal', r.deal_ar, 'platform', r.platform)); n := n + 1;
    end loop;
    for r in select distinct s.region_id, s.deal_ar from public.search_listings_ar s where s.region_id is not null loop
      perform public.ops_nf_cert_cell(p_tag, 'region', jsonb_build_object('deal', r.deal_ar, 'region_id', r.region_id)); n := n + 1;
    end loop;
    -- price rungs: Buy on price_total; Rent annual and monthly (×12) on price_annual
    for r in select * from (values (null::numeric, 500000::numeric), (500000, 1000000), (1000000, 2000000), (2000000, 5000000), (5000000, null)) v(lo, hi) loop
      perform public.ops_nf_cert_cell(p_tag, 'price_buy', jsonb_strip_nulls(jsonb_build_object('deal', 'بيع', 'price_min', r.lo, 'price_max', r.hi))); n := n + 1;
    end loop;
    for r in select * from (values (null::numeric, 20000::numeric), (20000, 50000), (50000, 100000), (100000, null)) v(lo, hi) loop
      perform public.ops_nf_cert_cell(p_tag, 'price_rent_annual', jsonb_strip_nulls(jsonb_build_object('deal', 'إيجار', 'period', 'سنوي', 'price_min', r.lo, 'price_max', r.hi))); n := n + 1;
    end loop;
    for r in select * from (values (null::numeric, 2000::numeric), (2000, 5000), (5000, null)) v(lo, hi) loop
      perform public.ops_nf_cert_cell(p_tag, 'price_rent_monthly', jsonb_strip_nulls(jsonb_build_object('deal', 'إيجار', 'period', 'شهري', 'price_min', r.lo, 'price_max', r.hi))); n := n + 1;
    end loop;
    for r in select * from (values (null::int, 100::int), (100, 300), (300, 600), (600, null)) v(lo, hi) loop
      foreach d in array array['بيع','إيجار'] loop
        perform public.ops_nf_cert_cell(p_tag, 'area', jsonb_strip_nulls(jsonb_build_object('deal', d, 'area_min', r.lo, 'area_max', r.hi))); n := n + 1;
      end loop;
    end loop;
    for r in select generate_series(1, 5) b loop
      foreach d in array array['بيع','إيجار'] loop
        perform public.ops_nf_cert_cell(p_tag, 'beds_exact', jsonb_build_object('deal', d, 'beds_exact', jsonb_build_array(r.b))); n := n + 1;
      end loop;
    end loop;
    foreach d in array array['بيع','إيجار'] loop
      perform public.ops_nf_cert_cell(p_tag, 'beds_min', jsonb_build_object('deal', d, 'beds_min', 5)); n := n + 1;
      perform public.ops_nf_cert_cell(p_tag, 'beds_multi', jsonb_build_object('deal', d, 'beds_exact', jsonb_build_array(2, 3))); n := n + 1;
    end loop;
    -- combinations a real user builds
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"إيجار","period":"سنوي","city":"الرياض","type":"شقة","price_min":20000,"price_max":60000,"beds_exact":[2,3]}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"إيجار","period":"شهري","city":"الرياض","type":"شقة","price_max":5000,"area_min":80,"area_max":150}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"إيجار","period":"كلاهما","city":"جدة","type":"شقة","beds_exact":[1]}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"بيع","city":"الرياض","type":"فيلا","price_min":1000000,"price_max":3000000,"area_min":300}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"بيع","city":"الدمام","type":"أرض سكنية","area_min":400,"area_max":1000}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"بيع","city":"مكة المكرمة","type":"شقة","beds_min":3}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"إيجار","period":"سنوي","city":"الرياض","district":"الملقا","type":"شقة"}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"إيجار","period":"سنوي","region_id":1,"type":"فيلا","price_max":150000}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"بيع","platform":"aqar","type":"دور","price_max":1500000}'); n := n + 1;
    perform public.ops_nf_cert_cell(p_tag, 'combo', '{"deal":"إيجار","period":"شهري","city":"الطائف","type":"شقة","area_min":90,"area_max":100,"beds_min":2}'); n := n + 1;
  elsif p_part = 1 then
    for r in select distinct s.city_ar, s.deal_ar from public.search_listings_ar s where s.city_ar is not null loop
      perform public.ops_nf_cert_cell(p_tag, 'city', jsonb_build_object('deal', r.deal_ar, 'city', r.city_ar)); n := n + 1;
    end loop;
  else
    for r in select distinct s.city_ar, s.district_ar, s.deal_ar from public.search_listings_ar s
              where s.city_ar is not null and s.district_ar is not null
                and mod(abs(hashtext(s.city_ar || '|' || s.district_ar)), 2) = p_part - 2 loop
      perform public.ops_nf_cert_cell(p_tag, 'district', jsonb_build_object('deal', r.deal_ar, 'city', r.city_ar, 'district', r.district_ar)); n := n + 1;
    end loop;
  end if;

  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth)
  values (p_tag, 'marker', 'nf_part_' || p_part, 'done', n);
  perform pg_advisory_unlock(hashtext('ops_nf_cert_run:' || p_tag || ':' || p_part));
  return n;
end $fn$;

-- ── SRC→INDEX: the served value vs what the next sync would write ─────────────────────────────
create or replace function public.ops_src_index_cert_run(p_tag text)
returns integer language plpgsql as $fn$
declare n int := 0; t0 timestamptz; r record; v_union text;
begin
  if not pg_try_advisory_lock(hashtext('ops_src_index_cert_run:' || p_tag)) then return -1; end if;
  t0 := clock_timestamp();

  -- A. every main-sync column, index vs listing_native_location_v2 (the sync's own source)
  create temp table _v2 on commit drop as
    select v.source_table, v.listing_id, v.platform, v.transaction_type, v.rent_period, v.property_type,
           v.region_id, v.city_id, v.production_ready,
           v.price_total, v.price_annual, v.area_m2, v.bedrooms, v.bathrooms,
           v.furnished, v.property_age, v.direction, v.street_width_m, v.floor_number,
           v.elevator, v.parking, v.kitchen, v.air_conditioner, v.maid_room, v.driver_room, v.private_entrance
      from public.listing_native_location_v2 v
     where lower(v.transaction_type) in ('buy','rent');
  create index on _v2 (source_table, listing_id);

  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, missing, extra, elapsed_ms)
  select p_tag, 'src_index', 'membership', 'index_vs_v2',
         (select count(*) from public.search_listings_ar),
         (select count(*) from _v2 v where not exists (select 1 from public.search_listings_ar s where s.source_table = v.source_table and s.listing_id = v.listing_id)),
         (select count(*) from public.search_listings_ar s where not exists (select 1 from _v2 v where v.source_table = s.source_table and v.listing_id = s.listing_id)),
         (extract(epoch from clock_timestamp() - t0) * 1000)::int;
  n := n + 1;

  for r in
    select col from unnest(array[
      'region_id','city_id','production_ready','price_total','price_annual','area_m2','bedrooms','bathrooms',
      'furnished','property_age','street_width_m','floor_number',
      'elevator','parking','kitchen','air_conditioner','maid_room','driver_room','private_entrance']) col
  loop
    t0 := clock_timestamp();
    execute format($q$
      insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra, elapsed_ms)
      select %L, 'src_index', 'v2', %L, count(*), count(*) filter (where s.%I is distinct from v.%I),
             (extract(epoch from clock_timestamp() - %L::timestamptz) * 1000)::int
        from public.search_listings_ar s join _v2 v on v.source_table = s.source_table and v.listing_id = s.listing_id
    $q$, p_tag, r.col, r.col, r.col, t0);
    n := n + 1;
  end loop;

  -- the three mapped columns, with the sync's own mapping
  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra)
  select p_tag, 'src_index', 'v2', 'deal_ar', count(*),
         count(*) filter (where s.deal_ar is distinct from (case when lower(v.transaction_type)='buy' then 'بيع' when lower(v.transaction_type)='rent' then 'إيجار' end))
    from public.search_listings_ar s join _v2 v using (source_table, listing_id);
  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra)
  select p_tag, 'src_index', 'v2', 'rent_period_ar', count(*),
         count(*) filter (where s.rent_period_ar is distinct from (case when lower(v.transaction_type)='rent' then case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي' else case when v.platform in ('gathern','aqarmonthly') then 'شهري' else 'سنوي' end end end))
    from public.search_listings_ar s join _v2 v using (source_table, listing_id);
  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra)
  select p_tag, 'src_index', 'v2', 'direction_ar', count(*),
         count(*) filter (where s.direction_ar is distinct from (case when v.direction in ('شمال','جنوب','شرق','غرب','شمال شرقي','شمال غربي','جنوب شرقي','جنوب غربي','شمالية','جنوبية','شرقية','غربية') then v.direction end))
    from public.search_listings_ar s join _v2 v using (source_table, listing_id);
  n := n + 3;

  -- B. rich columns vs listing_rich_attrs
  for r in select unnest(public._rich_attr_columns()) col loop
    t0 := clock_timestamp();
    execute format($q$
      insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra, elapsed_ms)
      select %L, 'src_index', 'rich', %L, count(*), count(*) filter (where s.%I is distinct from r.%I),
             (extract(epoch from clock_timestamp() - %L::timestamptz) * 1000)::int
        from public.search_listings_ar s join public.listing_rich_attrs r on r.source_table = s.source_table and r.listing_id = s.listing_id
    $q$, p_tag, r.col, r.col, r.col, t0);
    n := n + 1;
  end loop;

  -- C. rent_now_pay_later vs the source column (same union refresh_rnpl_flags builds)
  select string_agg(format('select %L::text as tbl, id, rent_now_pay_later as rnpl from public.%I', t.source_table, t.source_table), ' union all ')
    into v_union
    from (select distinct s.source_table from public.search_listings_ar s
           where exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name = s.source_table and c.column_name='rent_now_pay_later')) t;
  if v_union is not null then
    execute format($q$
      insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra)
      select %L, 'src_index', 'source_column', 'rent_now_pay_later', count(*), count(*) filter (where s.rent_now_pay_later is distinct from src.rnpl)
        from public.search_listings_ar s join (%s) src on src.tbl = s.source_table and src.id = s.listing_id
    $q$, p_tag, v_union);
    n := n + 1;
  end if;

  -- D. gathern rating / reviews / unit subtype vs additional_info (sync_gathern_native_attrs's own rule)
  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth, extra)
  select p_tag, 'src_index', 'gathern_additional_info', 'rating|reviews_count|unit_subtype_ar', count(*),
         count(*) filter (where
           s.rating is distinct from (case when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
                                          when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$' and (g.additional_info->>'rating')::numeric between 1 and 10 then round((g.additional_info->>'rating')::numeric, 1) end)
        or s.reviews_count is distinct from (case when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
                                                  when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$' and (g.additional_info->>'rating')::numeric between 1 and 10 and g.additional_info->>'reviews_count' ~ '^[0-9]+$' then (g.additional_info->>'reviews_count')::int end)
        or s.unit_subtype_ar is distinct from nullif(btrim(coalesce(g.additional_info->>'unit_type_ar','')), ''))
    from public.search_listings_ar s join public.gathern_residential_listings g on s.source_table = 'gathern_residential_listings' and s.listing_id = g.id;
  n := n + 1;

  insert into public.ops_af_cert_result (run_tag, kind, cohort, opt, truth) values (p_tag, 'marker', 'src_index', 'done', n);
  perform pg_advisory_unlock(hashtext('ops_src_index_cert_run:' || p_tag));
  return n;
end $fn$;
