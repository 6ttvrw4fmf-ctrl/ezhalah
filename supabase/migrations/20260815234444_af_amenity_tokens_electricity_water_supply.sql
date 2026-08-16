-- COMMERCIAL COHORT BACKEND (owner 2026-08-16 overnight mandate: complete AF for every commercial +
-- remaining residential type; data designs the questions). Fresh-band profiling across 20 type×deal
-- cohorts found the commercial market's real signal is UTILITIES: electricity (e.g. Shop rent
-- 943y/25n, fresh-alive 64/wk), water_supply (840y/128n — genuinely two-sided), joining the existing
-- sanitation token (731y/237n on Shop rent). AC is fresh-DEAD on commercial rent (aqar form change)
-- and is deliberately NOT enabled anywhere new despite passing all-time gates — historical coverage
-- lies. Same sanctioned surgery as villa (20260815223500): clause whitelist + positive-only
-- predicates + guided-count columns via template needle-edit + rebuild. Certified cohorts invariant.
do $do$
declare
  clause text := af_eligibility_clause();
  tpl text; occ int;
  wl_old text := $x$'private_entrance','car_entrance','sanitation','furnished','rnpl','rent_now_pay_later'$x$;
  wl_new text := $x$'private_entrance','car_entrance','sanitation','electricity','water_supply','furnished','rnpl','rent_now_pay_later'$x$;
  pred_old text := $x$and (not ('sanitation'       = any(p_amenities)) or s.sanitation)$x$;
  pred_new text := $x$and (not ('sanitation'       = any(p_amenities)) or s.sanitation)
           and (not ('electricity'      = any(p_amenities)) or s.electricity)
           and (not ('water_supply'     = any(p_amenities)) or s.water_supply)$x$;
  scoped_old text := $x$s.street_width_m, s.car_entrance, s.sanitation
    from public.search_listings_ar s$x$;
  scoped_new text := $x$s.street_width_m, s.car_entrance, s.sanitation, s.electricity, s.water_supply
    from public.search_listings_ar s$x$;
  ret_old text := $x$cnt_car_entrance bigint, cnt_sanitation bigint, cnt_selected bigint)$x$;
  ret_new text := $x$cnt_car_entrance bigint, cnt_sanitation bigint, cnt_electricity bigint, cnt_water_supply bigint, cnt_selected bigint)$x$;
  sel_old text := $x$    count(*) filter (where sanitation)                      as cnt_sanitation,$x$;
  sel_new text := $x$    count(*) filter (where sanitation)                      as cnt_sanitation,
    count(*) filter (where electricity)                     as cnt_electricity,
    count(*) filter (where water_supply)                    as cnt_water_supply,$x$;
  before_n bigint; after_n bigint; parity int;
  v_chip bigint; v_direct bigint; v_ref bigint;
begin
  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');

  occ := (length(clause) - length(replace(clause, wl_old, ''))) / length(wl_old);
  if occ <> 1 then raise exception 'ABORT: whitelist needle occurs %', occ; end if;
  clause := replace(clause, wl_old, wl_new);
  occ := (length(clause) - length(replace(clause, pred_old, ''))) / length(pred_old);
  if occ <> 1 then raise exception 'ABORT: predicate needle occurs %', occ; end if;
  clause := replace(clause, pred_old, pred_new);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);

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

  -- new chips == direct SQL == referee on the cohorts they were built for (Shop rent = strongest)
  select cnt_electricity into v_chip from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['محل','كشك','درايف ثرو'],p_category:='Commercial');
  select count(*) into v_direct from search_listings_ar s
   where s.production_ready and s.city_id is not null and s.region_id is not null
     and s.deal_ar='إيجار' and s.type_ar=any(array['محل','كشك','درايف ثرو']) and s.electricity
     and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
     and exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro='Commercial' or (k.macro='both' and s.source_table like '%\_commercial\_listings')));
  if v_chip <> v_direct then raise exception 'ABORT: cnt_electricity % <> direct %', v_chip, v_direct; end if;
  select af_eligible_count(p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['محل','كشك','درايف ثرو'],p_category:='Commercial',
                           p_amenities:=array['electricity']) into v_ref;
  if v_ref <> v_direct then raise exception 'ABORT: electricity referee % <> direct %', v_ref, v_direct; end if;

  select cnt_water_supply into v_chip from apartment_guided_counts_ar(
    p_deal:='بيع',p_types:=array['أرض زراعية'],p_category:='Residential');
  select count(*) into v_direct from search_listings_ar s
   where s.production_ready and s.city_id is not null and s.region_id is not null
     and s.deal_ar='بيع' and s.type_ar='أرض زراعية' and s.water_supply
     and exists (select 1 from known_type_ar k where k.type_ar = s.type_ar
                  and (k.macro='Residential' or (k.macro='both' and s.source_table like '%\_residential\_listings')));
  if v_chip <> v_direct then raise exception 'ABORT: cnt_water_supply % <> direct %', v_chip, v_direct; end if;
  select af_eligible_count(p_deal:='بيع',p_types:=array['أرض زراعية'],p_category:='Residential',
                           p_amenities:=array['water_supply']) into v_ref;
  if v_ref <> v_direct then raise exception 'ABORT: water_supply referee % <> direct %', v_ref, v_direct; end if;

  select af_eligible_count(p_deal:='بيع',p_types:=array['محل'],p_category:='Commercial',
                           p_amenities:=array['garbage_zz']) into v_ref;
  if v_ref <> 0 then raise exception 'ABORT: garbage token returned %', v_ref; end if;

  raise notice 'SUCCESS: electricity + water_supply tokens live on all 4 surfaces; chips==direct==referee; certified cohorts invariant; parity 0';
end $do$;