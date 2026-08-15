-- Add DIRECTION + STREET-WIDTH count columns to the guided counts surface (cohort expansion,
-- owner 2026-08-15: «study the real listings … a residential building may need different questions»).
--
-- DATA: ResBldg street_width_m known 96-97%, direction_ar 83-84% (vs bathrooms 1%) — its two
-- strongest attributes; Apartment/Buy direction 50%. 8 normalized direction values; street width is
-- a natural cumulative ladder (>=15/>=20/>=25/>=30 m).
--
-- Template-edit + rebuild_af_filter_rpcs() (surfaces never hand-edited). Output columns only.
-- Certified-cohort assertion is BEFORE==AFTER in-transaction. The independent oracle mirrors the
-- FULL documented clause: read-side defense (production_ready needs city+region) AND category
-- purity (عمارة macro='both' resolves by table kind — a commercial-table عمارة is correctly outside
-- a Residential search; dealapp_commercial 1283327 proved this, 2 earlier aborts).
do $do$
declare
  tpl text; occ int;
  scoped_old text := $x$    select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance, s.maid_room, s.driver_room
    from public.search_listings_ar s$x$;
  scoped_new text := $x$    select s.rent_now_pay_later, s.kitchen, s.parking, s.elevator, s.furnished, s.bathrooms, s.air_conditioner, s.private_entrance, s.maid_room, s.driver_room, public.norm_direction_ar(s.direction_ar) as dirn, s.street_width_m
    from public.search_listings_ar s$x$;
  ret_old text := $x$cnt_bath4 bigint, cnt_selected bigint)$x$;
  ret_new text := $x$cnt_bath4 bigint, cnt_dir_n bigint, cnt_dir_s bigint, cnt_dir_e bigint, cnt_dir_w bigint, cnt_dir_ne bigint, cnt_dir_nw bigint, cnt_dir_se bigint, cnt_dir_sw bigint, cnt_stw15 bigint, cnt_stw20 bigint, cnt_stw25 bigint, cnt_stw30 bigint, cnt_selected bigint)$x$;
  sel_old text := $x$    count(*) filter (where bathrooms >= 4)                  as cnt_bath4,$x$;
  sel_new text := $x$    count(*) filter (where bathrooms >= 4)                  as cnt_bath4,
    count(*) filter (where dirn = 'شمال')                   as cnt_dir_n,
    count(*) filter (where dirn = 'جنوب')                   as cnt_dir_s,
    count(*) filter (where dirn = 'شرق')                    as cnt_dir_e,
    count(*) filter (where dirn = 'غرب')                    as cnt_dir_w,
    count(*) filter (where dirn = 'شمال شرق')               as cnt_dir_ne,
    count(*) filter (where dirn = 'شمال غرب')               as cnt_dir_nw,
    count(*) filter (where dirn = 'جنوب شرق')               as cnt_dir_se,
    count(*) filter (where dirn = 'جنوب غرب')               as cnt_dir_sw,
    count(*) filter (where street_width_m >= 15)            as cnt_stw15,
    count(*) filter (where street_width_m >= 20)            as cnt_stw20,
    count(*) filter (where street_width_m >= 25)            as cnt_stw25,
    count(*) filter (where street_width_m >= 30)            as cnt_stw30,$x$;
  before_n bigint; after_n bigint; v_chip bigint; v_chip_e bigint; v_direct bigint; v_res bigint; v_ref bigint; parity int;
begin
  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');

  select template into tpl from af_rpc_templates where fn_name='apartment_guided_counts_ar';
  occ := (length(tpl) - length(replace(tpl, scoped_old, ''))) / length(scoped_old);
  if occ <> 1 then raise exception 'ABORT: scoped needle occurs %, expected 1', occ; end if;
  tpl := replace(tpl, scoped_old, scoped_new);
  occ := (length(tpl) - length(replace(tpl, ret_old, ''))) / length(ret_old);
  if occ <> 1 then raise exception 'ABORT: returns needle occurs %, expected 1', occ; end if;
  tpl := replace(tpl, ret_old, ret_new);
  occ := (length(tpl) - length(replace(tpl, sel_old, ''))) / length(sel_old);
  if occ <> 1 then raise exception 'ABORT: select needle occurs %, expected 1', occ; end if;
  tpl := replace(tpl, sel_old, sel_new);

  update af_rpc_templates set template = tpl where fn_name='apartment_guided_counts_ar';
  perform * from rebuild_af_filter_rpcs();

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed across rebuild %->%', before_n, after_n;
  end if;

  select cnt_stw20, cnt_dir_e into v_chip, v_chip_e from apartment_guided_counts_ar(
    p_deal:='بيع',p_types:=array['عمارة','مجمع سكني','مجمع','برج'],p_category:='Residential');

  select count(*) into v_direct from search_listings_ar s
   where s.production_ready and s.city_id is not null and s.region_id is not null
     and s.deal_ar='بيع' and s.type_ar=any(array['عمارة','مجمع سكني','مجمع','برج'])
     and s.street_width_m >= 20
     and exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro='Residential' or (k.macro='both' and s.source_table like '%\_residential\_listings')));
  if v_chip <> v_direct then raise exception 'ABORT: cnt_stw20 % <> direct %', v_chip, v_direct; end if;

  select count(*) into v_direct from search_listings_ar s
   where s.production_ready and s.city_id is not null and s.region_id is not null
     and s.deal_ar='بيع' and s.type_ar=any(array['عمارة','مجمع سكني','مجمع','برج'])
     and norm_direction_ar(s.direction_ar) = 'شرق'
     and exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro='Residential' or (k.macro='both' and s.source_table like '%\_residential\_listings')));
  if v_chip_e <> v_direct then raise exception 'ABORT: cnt_dir_e % <> direct %', v_chip_e, v_direct; end if;

  select count(*) into v_res from location_search_candidates_ar(
    p_deal:='بيع',p_types:=array['عمارة','مجمع سكني','مجمع','برج'],p_category:='Residential',
    p_street_width_min:=20::smallint,p_per_platform:=50000,p_limit:=50000);
  select af_eligible_count(p_deal:='بيع',p_types:=array['عمارة','مجمع سكني','مجمع','برج'],
    p_category:='Residential',p_street_width_min:=20::smallint) into v_ref;
  if v_chip <> v_res or v_chip <> v_ref then
    raise exception 'ABORT: stw20 chip=% results=% referee=%', v_chip, v_res, v_ref;
  end if;

  raise notice 'SUCCESS: 12 new count columns; parity 0; cohort invariant (%); stw20 %=%=%; dir_e exact.', after_n, v_chip, v_res, v_ref;
end $do$;