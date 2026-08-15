-- VILLA COHORT BACKEND (owner 2026-08-16: «start building the Advanced Filter for فيلا … let the
-- data design the questions»). Fresh-band profiling (7d first-seen) selected TWO new amenity
-- tokens — the villa market's own differentiators, both strongly two-sided and healthy on fresh
-- rows: car_entrance مدخل سيارة (buy fresh 52.0% known, yes 5,594/no 5,943 all-time; rent fresh
-- 75.1%) and sanitation صرف صحي (buy fresh 63.1%, yes 7,377/no 2,829; rent fresh 84.6%).
-- AC is deliberately NOT touched for Buy (aqar removed it from بيع forms — fresh 0.0%); chips are
-- positive-only IS TRUE so unknown can never satisfy them and there is no "no" direction.
-- Same surgery as 20260815013213: canonical clause needle-edit + guided-counts TEMPLATE needle-edit
-- + rebuild through the only sanctioned path. Output columns + whitelist tokens only — no existing
-- predicate changes, so every certified cohort count is invariant (asserted).
do $do$
declare
  clause text := af_eligibility_clause();
  tpl text; occ int;
  wl_old text := $x$'private_entrance','furnished','rnpl','rent_now_pay_later'$x$;
  wl_new text := $x$'private_entrance','car_entrance','sanitation','furnished','rnpl','rent_now_pay_later'$x$;
  pred_old text := $x$and (not ('private_entrance' = any(p_amenities)) or s.private_entrance)$x$;
  pred_new text := $x$and (not ('private_entrance' = any(p_amenities)) or s.private_entrance)
           and (not ('car_entrance'     = any(p_amenities)) or s.car_entrance)
           and (not ('sanitation'       = any(p_amenities)) or s.sanitation)$x$;
  scoped_old text := $x$s.maid_room, s.driver_room, public.norm_direction_ar(s.direction_ar) as dirn, s.street_width_m
    from public.search_listings_ar s$x$;
  scoped_new text := $x$s.maid_room, s.driver_room, public.norm_direction_ar(s.direction_ar) as dirn, s.street_width_m, s.car_entrance, s.sanitation
    from public.search_listings_ar s$x$;
  ret_old text := $x$cnt_stw30 bigint, cnt_selected bigint)$x$;
  ret_new text := $x$cnt_stw30 bigint, cnt_car_entrance bigint, cnt_sanitation bigint, cnt_selected bigint)$x$;
  sel_old text := $x$    count(*) filter (where street_width_m >= 30)            as cnt_stw30,$x$;
  sel_new text := $x$    count(*) filter (where street_width_m >= 30)            as cnt_stw30,
    count(*) filter (where car_entrance)                    as cnt_car_entrance,
    count(*) filter (where sanitation)                      as cnt_sanitation,$x$;
  before_n bigint; after_n bigint; parity int;
  v_chip bigint; v_direct bigint; v_ref bigint;
begin
  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');

  -- 1. canonical clause: whitelist + two positive-only predicates
  occ := (length(clause) - length(replace(clause, wl_old, ''))) / length(wl_old);
  if occ <> 1 then raise exception 'ABORT: whitelist needle occurs %', occ; end if;
  clause := replace(clause, wl_old, wl_new);
  occ := (length(clause) - length(replace(clause, pred_old, ''))) / length(pred_old);
  if occ <> 1 then raise exception 'ABORT: predicate needle occurs %', occ; end if;
  clause := replace(clause, pred_old, pred_new);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);

  -- 2. guided-counts template: scoped CTE columns + RETURNS + select list
  select template into tpl from af_rpc_templates where fn_name='apartment_guided_counts_ar';
  occ := (length(tpl) - length(replace(tpl, scoped_old, ''))) / length(scoped_old);
  if occ <> 1 then raise exception 'ABORT: scoped needle occurs %', occ; end if;
  tpl := replace(tpl, scoped_old, scoped_new);
  occ := (length(tpl) - length(replace(tpl, ret_old, ''))) / length(ret_old);
  if occ <> 1 then raise exception 'ABORT: returns needle occurs %', occ; end if;
  tpl := replace(tpl, ret_old, ret_new);
  occ := (length(tpl) - length(replace(tpl, sel_old, ''))) / length(sel_old);
  if occ <> 1 then raise exception 'ABORT: select needle occurs %', occ; end if;
  tpl := replace(tpl, sel_old, sel_new);
  update af_rpc_templates set template = tpl where fn_name='apartment_guided_counts_ar';

  perform * from rebuild_af_filter_rpcs();

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed %->%', before_n, after_n;
  end if;

  -- 3. new chips == direct SQL == referee, on the villa cohorts they were built for
  select cnt_car_entrance into v_chip from apartment_guided_counts_ar(
    p_deal:='بيع',p_types:=array['فيلا'],p_category:='Residential');
  select count(*) into v_direct from search_listings_ar s
   where s.production_ready and s.city_id is not null and s.region_id is not null
     and s.deal_ar='بيع' and s.type_ar='فيلا' and s.car_entrance
     and exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro='Residential' or (k.macro='both' and s.source_table like '%\_residential\_listings')));
  if v_chip <> v_direct then raise exception 'ABORT: cnt_car_entrance % <> direct %', v_chip, v_direct; end if;
  select af_eligible_count(p_deal:='بيع',p_types:=array['فيلا'],p_category:='Residential',
                           p_amenities:=array['car_entrance']) into v_ref;
  if v_ref <> v_direct then raise exception 'ABORT: car_entrance referee % <> direct %', v_ref, v_direct; end if;

  select cnt_sanitation into v_chip from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['فيلا'],p_category:='Residential');
  select count(*) into v_direct from search_listings_ar s
   where s.production_ready and s.city_id is not null and s.region_id is not null
     and s.deal_ar='إيجار' and s.type_ar='فيلا' and s.sanitation
     and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
     and exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro='Residential' or (k.macro='both' and s.source_table like '%\_residential\_listings')));
  if v_chip <> v_direct then raise exception 'ABORT: cnt_sanitation % <> direct %', v_chip, v_direct; end if;
  select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['فيلا'],p_category:='Residential',
                           p_amenities:=array['sanitation']) into v_ref;
  if v_ref <> v_direct then raise exception 'ABORT: sanitation referee % <> direct %', v_ref, v_direct; end if;

  -- 4. vocabulary still fails closed
  select af_eligible_count(p_deal:='بيع',p_types:=array['فيلا'],p_category:='Residential',
                           p_amenities:=array['garbage_token_zz']) into v_ref;
  if v_ref <> 0 then raise exception 'ABORT: garbage token returned %', v_ref; end if;

  raise notice 'SUCCESS: car_entrance + sanitation tokens live on all 4 surfaces; chips==direct==referee; certified cohorts invariant; parity 0';
end $do$;