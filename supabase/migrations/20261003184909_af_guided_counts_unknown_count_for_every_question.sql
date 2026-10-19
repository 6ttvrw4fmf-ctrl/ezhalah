-- 😔 «N إعلان لم يذكر هذه المعلومة» ON EVERY ADVANCED FILTER QUESTION (owner 2026-10-03: «We add a
-- sad emoji … on every advanced filter question», approved the DB change the same day: «yes»).
--
-- Until now only age (cnt_unknown), furnished (total − true − false) and direction (total − Σ8) could
-- say how many listings never stated the fact, because only they had a truthful number. The other
-- six could not be derived client-side without lying (R7.1.3, owner rule 2026-08-28):
--   • bathrooms / street width / rating are threshold ladders — total − (≥1) folds the 393 genuine
--     zero-bathroom rows into "did not mention";
--   • RNPL — false and NULL are inseparable from cnt_rnpl (125,124 false vs 159,989 NULL fleet-wide);
--   • unit subtype — total − Σ3 holds only while the domain has exactly three values;
--   • amenities — each chip is its own column, so no subtraction yields one honest number.
--
-- So the database counts NULL directly, inside the SAME `scoped` CTE every other cnt_* uses (a count
-- computed outside its scope was the 2026-09-01 direction defect):
--   cnt_rnpl_unknown    rent_now_pay_later IS NULL
--   cnt_amen_unknown    EVERY amenity column the amenities card can offer IS NULL — the listing
--                       stated no amenity at all. One number that is true for the whole card.
--   cnt_bath_unknown    bathrooms IS NULL          (a stated 0 is a statement, not silence)
--   cnt_stw_unknown     street_width_m IS NULL
--   cnt_rating_unknown  rating IS NULL
--   cnt_sub_unknown     unit_subtype_ar IS NULL
-- Every column is tri-state at the source (silent → NULL, never NO), so IS NULL is exactly "the source
-- did not say".
--
-- ONE TEMPLATED PATH, as 20260902220000: the apartment_guided_counts_ar row of af_rpc_templates is
-- needle-edited on its LIVE text (each anchor must occur exactly once, else ABORT), then
-- rebuild_af_filter_rpcs() regenerates the RPC and stamps af_rpc_build_state. No hand edit of an AF
-- RPC (scripts/verify-af-rpcs-not-hand-edited.ts). Columns are only APPENDED, so every existing
-- caller (to_jsonb consumers, the client's GuidedCounts) keeps working unchanged.
--
-- SELF-CHECK at apply time: parity 0 after rebuild; the certified Riyadh rent cohort's base count
-- unchanged; and on the fleet-wide base every new column equals a direct IS NULL count over the same
-- base predicate (the predicate is first proven current: direct total == cnt_total_base).

do $do$
declare
  tpl text; occ int;
  ret_old text := $x$cnt_sub_regular bigint)$x$;
  ret_new text := $x$cnt_sub_regular bigint, cnt_rnpl_unknown bigint, cnt_amen_unknown bigint, cnt_bath_unknown bigint, cnt_stw_unknown bigint, cnt_rating_unknown bigint, cnt_sub_unknown bigint)$x$;
  sel_old text := $x$as cnt_sub_regular$x$;
  sel_new text := $x$as cnt_sub_regular,
    count(*) filter (where rent_now_pay_later is null)      as cnt_rnpl_unknown,
    count(*) filter (where kitchen is null and parking is null and elevator is null and air_conditioner is null
                       and private_entrance is null and maid_room is null and driver_room is null
                       and car_entrance is null and sanitation is null and electricity is null and water_supply is null
                       and gym is null and pool is null and garden is null and balcony is null and laundry_room is null
                       and optical_fibers is null and separate_electricity_meter is null and separate_water_meter is null
                       and furnished is null)              as cnt_amen_unknown,
    count(*) filter (where bathrooms is null)               as cnt_bath_unknown,
    count(*) filter (where street_width_m is null)          as cnt_stw_unknown,
    count(*) filter (where rating is null)                  as cnt_rating_unknown,
    count(*) filter (where unit_subtype_ar is null)         as cnt_sub_unknown$x$;
  before_n bigint; after_n bigint; parity int; g jsonb; d record;
begin
  select template into tpl from af_rpc_templates where fn_name = 'apartment_guided_counts_ar';
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no apartment_guided_counts_ar row'; end if;
  if position('cnt_bath_unknown' in tpl) > 0 then
    raise notice 'template already carries cnt_bath_unknown — template step skipped';
  else
    occ := (length(tpl) - length(replace(tpl, ret_old, ''))) / length(ret_old);
    if occ <> 1 then raise exception 'ABORT: returns needle occurs %', occ; end if;
    tpl := replace(tpl, ret_old, ret_new);
    occ := (length(tpl) - length(replace(tpl, sel_old, ''))) / length(sel_old);
    if occ <> 1 then raise exception 'ABORT: select needle occurs %', occ; end if;
    tpl := replace(tpl, sel_old, sel_new);
    update af_rpc_templates set template = tpl where fn_name = 'apartment_guided_counts_ar';
  end if;

  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');

  perform * from rebuild_af_filter_rpcs();

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_cities:=array['الرياض'], p_category:='Residential');
  if before_n is distinct from after_n then raise exception 'ABORT: certified cohort changed %->%', before_n, after_n; end if;

  select to_jsonb(x) into g from apartment_guided_counts_ar() x;
  select count(*) as total,
         count(*) filter (where s.rent_now_pay_later is null) as rnpl,
         count(*) filter (where s.kitchen is null and s.parking is null and s.elevator is null and s.air_conditioner is null
                            and s.private_entrance is null and s.maid_room is null and s.driver_room is null
                            and s.car_entrance is null and s.sanitation is null and s.electricity is null and s.water_supply is null
                            and s.gym is null and s.pool is null and s.garden is null and s.balcony is null and s.laundry_room is null
                            and s.optical_fibers is null and s.separate_electricity_meter is null and s.separate_water_meter is null
                            and s.furnished is null) as amen,
         count(*) filter (where s.bathrooms is null) as bath,
         count(*) filter (where s.street_width_m is null) as stw,
         count(*) filter (where s.rating is null) as rating,
         count(*) filter (where s.unit_subtype_ar is null) as sub
    into d
    from search_listings_ar s
   where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
     and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
     and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار');
  if d.total <> (g->>'cnt_total_base')::bigint then
    raise exception 'ABORT: direct base predicate is stale (direct % vs rpc %) — nothing proven', d.total, g->>'cnt_total_base';
  end if;
  if (g->>'cnt_rnpl_unknown')::bigint   is distinct from d.rnpl   then raise exception 'ABORT: rnpl unknown % vs direct %', g->>'cnt_rnpl_unknown', d.rnpl; end if;
  if (g->>'cnt_amen_unknown')::bigint   is distinct from d.amen   then raise exception 'ABORT: amenities unknown % vs direct %', g->>'cnt_amen_unknown', d.amen; end if;
  if (g->>'cnt_bath_unknown')::bigint   is distinct from d.bath   then raise exception 'ABORT: bathrooms unknown % vs direct %', g->>'cnt_bath_unknown', d.bath; end if;
  if (g->>'cnt_stw_unknown')::bigint    is distinct from d.stw    then raise exception 'ABORT: street width unknown % vs direct %', g->>'cnt_stw_unknown', d.stw; end if;
  if (g->>'cnt_rating_unknown')::bigint is distinct from d.rating then raise exception 'ABORT: rating unknown % vs direct %', g->>'cnt_rating_unknown', d.rating; end if;
  if (g->>'cnt_sub_unknown')::bigint    is distinct from d.sub    then raise exception 'ABORT: unit subtype unknown % vs direct %', g->>'cnt_sub_unknown', d.sub; end if;
  raise notice 'OK: 6 unknown columns live; fleet base % — rnpl %, amenities %, bathrooms %, street %, rating %, subtype %',
    d.total, d.rnpl, d.amen, d.bath, d.stw, d.rating, d.sub;
end
$do$;
