-- RESIDENTIAL "RICH" AMENITY TOKENS (owner 2026-08-31): the AI chat's closed amenity vocabulary
-- silently dropped "gym" ("أبي شقة فيها نادي" applied nothing) because the token was never in the
-- model's enum, never in afCohorts.ts, and never in this clause's whitelist. Auditing every other
-- token in the same situation (owner's expanded scope, same session) found SEVEN more:
-- search_listings_ar already carries real, populated boolean columns from the 2026-08-10/11
-- rich-canonical-columns + car_entrance/optical_fibers migrations that were never wired past the
-- ALTER TABLE -- gym, pool, garden, balcony, laundry_room, optical_fibers,
-- separate_electricity_meter, separate_water_meter. Live counts checked 2026-08-31 (fleet-wide,
-- true/false of 197,768 total):
--   gym 13/941            pool 44/918              garden 49/923           balcony 1,476/3,922
--   laundry_room 1,959/3,359   optical_fibers 2,911/1,087
--   separate_electricity_meter 52,652/1,305   separate_water_meter 46,474/7,528
-- All real, two-sided, source-published data (no fabrication) -- the same bar gym itself cleared.
-- No schema change needed anywhere in this migration: every column already exists on
-- search_listings_ar. This migration only extends the two independent SQL surfaces that carry the
-- amenity whitelist, exactly as 20260815223500_af_amenity_tokens_car_entrance_sanitation.sql did
-- for car_entrance/sanitation:
--   1. af_eligibility_clause() -- the source template for the 4 RPCs rebuild_af_filter_rpcs()
--      regenerates (af_eligible_count, apartment_guided_counts_ar, location_search_candidates_ar,
--      property_age_option_counts_ar).
--   2. top_cities_by_deal_ar -- NOT in af_rpc_templates (confirmed live), carries its own
--      byte-identical copy of the same block. rpcAllNarrowingParams() (src/data/remote.ts) forwards
--      p_amenities to this RPC automatically for the Trending-cities breakdown; an unrecognized
--      token there does not error, it silently zeroes every row via the whitelist's
--      "not exists (... tok not in (...))" guard -- leaving it unpatched would have fabricated a
--      false "0 cities" the instant any of these amenities reached that surface.
-- location_search_candidates2 also takes p_amenities but has zero callers in src/ (confirmed dead)
-- and is not touched. Deliberately NOT adding cnt_* guided-count columns or Advanced-Filter chip
-- defs (src/data/advancedFilters.ts) for any of these eight tokens -- that is a separate, larger,
-- independently-registered UI surface out of scope for tonight's chat-path fix; they stay
-- chat-reachable only until that follow-up lands.
--
-- Investigated and explicitly NOT added here (reported separately, not silently skipped):
--   villa_on_roof (349/1,368) and apartment_in_project (642/949 aqar-only) are real signals but
--     need FULL schema promotion (ALTER TABLE + per-branch view wiring, like car_entrance/
--     optical_fibers needed) -- bigger, riskier lift than a vocabulary-only wire, deferred.
--   special_position (11,384/0) and special_surface (95/0) carry real volume but every known value
--     is TRUE and none FALSE -- a "positive-only" shape that usually means a marketing/subjective
--     claim ("prime location"), not a structural fact; needs source-page adjudication before it can
--     be certified as neutral, per this repo's own AF adjudication rule. Not added.
--   installment_available has 15,465 true rows but only 3 are on Buy listings -- for rent it is a
--     duplicate of the already-certified rnpl/rent_now_pay_later; for Buy (تقسيط الشراء, real user
--     demand) there is effectively no real data yet. Data-coverage gap, not a code fix.
--   kitchen_status (291 known) and furnishing_level (2,361 known) are 3-value TYPED variants of the
--     already-certified boolean kitchen/furnished, too thin to justify a second, separate filter.
--   extension (7 true of 84,793) is negligible.
do $do$
declare
  wl_old text := $x$'water_supply','furnished'$x$;
  wl_new text := $x$'water_supply','gym','pool','garden','balcony','laundry_room','optical_fibers','separate_electricity_meter','separate_water_meter','furnished'$x$;
  pred_old text := $x$and (not ('water_supply'     = any(p_amenities)) or s.water_supply)$x$;
  pred_new text := $x$and (not ('water_supply'     = any(p_amenities)) or s.water_supply)
           and (not ('gym'                          = any(p_amenities)) or s.gym)
           and (not ('pool'                         = any(p_amenities)) or s.pool)
           and (not ('garden'                       = any(p_amenities)) or s.garden)
           and (not ('balcony'                      = any(p_amenities)) or s.balcony)
           and (not ('laundry_room'                 = any(p_amenities)) or s.laundry_room)
           and (not ('optical_fibers'                = any(p_amenities)) or s.optical_fibers)
           and (not ('separate_electricity_meter'    = any(p_amenities)) or s.separate_electricity_meter)
           and (not ('separate_water_meter'          = any(p_amenities)) or s.separate_water_meter)$x$;
  clause text; tcbd_def text; occ int;
  before_n bigint; after_n bigint; parity int;
  toks text[] := array['gym','pool','garden','balcony','laundry_room','optical_fibers','separate_electricity_meter','separate_water_meter'];
  tok text; v_direct bigint; v_ref bigint; v_garbage bigint; v_tcbd_garbage bigint;
begin
  -- 1. canonical clause (feeds the 4 templated RPCs via rebuild_af_filter_rpcs)
  clause := af_eligibility_clause();
  occ := (length(clause) - length(replace(clause, wl_old, ''))) / length(wl_old);
  if occ <> 1 then raise exception 'ABORT: af_eligibility_clause whitelist needle occurs %', occ; end if;
  clause := replace(clause, wl_old, wl_new);
  occ := (length(clause) - length(replace(clause, pred_old, ''))) / length(pred_old);
  if occ <> 1 then raise exception 'ABORT: af_eligibility_clause predicate needle occurs %', occ; end if;
  clause := replace(clause, pred_old, pred_new);
  execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', clause);

  select cnt_total_base into before_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');

  perform * from rebuild_af_filter_rpcs();

  select public.mon_af_predicate_parity() into parity;
  if parity <> 0 then raise exception 'ABORT: parity=% after rebuild', parity; end if;

  select cnt_total_base into after_n from apartment_guided_counts_ar(
    p_deal:='إيجار',p_rent_period:='سنوي',p_types:=array['شقة'],p_cities:=array['الرياض'],p_category:='Residential');
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed %->%', before_n, after_n;
  end if;

  -- 2. top_cities_by_deal_ar: NOT in af_rpc_templates, needle-edit directly (byte-identical block,
  -- confirmed live before writing this migration).
  select pg_get_functiondef('public.top_cities_by_deal_ar'::regproc) into tcbd_def;
  occ := (length(tcbd_def) - length(replace(tcbd_def, wl_old, ''))) / length(wl_old);
  if occ <> 1 then raise exception 'ABORT: top_cities_by_deal_ar whitelist needle occurs %', occ; end if;
  tcbd_def := replace(tcbd_def, wl_old, wl_new);
  occ := (length(tcbd_def) - length(replace(tcbd_def, pred_old, ''))) / length(pred_old);
  if occ <> 1 then raise exception 'ABORT: top_cities_by_deal_ar predicate needle occurs %', occ; end if;
  tcbd_def := replace(tcbd_def, pred_old, pred_new);
  execute tcbd_def;

  -- 3. chip == direct == referee, per token, on live data. Mirrors af_eligibility_clause()'s own
  -- eligibility OR exactly (production_ready, OR the unscoped-call safety valve that also admits a
  -- not-price-gated row with a null region/city when no location filter is active) plus its price/
  -- area/deal sanity guards -- verified byte-for-byte against a live discrepancy before landing this
  -- (a naive "production_ready and city/region not null" direct query undercounted gym 12 vs 13).
  foreach tok in array toks loop
    execute format(
      $q$select count(*) from search_listings_ar s
         where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
           and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
           and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
           and s.%I$q$,
      tok
    ) into v_direct;
    select af_eligible_count(p_amenities:=array[tok]) into v_ref;
    if v_ref <> v_direct then raise exception 'ABORT: % referee % <> direct %', tok, v_ref, v_direct; end if;
  end loop;

  -- 4. vocabulary still fails closed on both rebuilt surfaces.
  select af_eligible_count(p_amenities:=array['garbage_token_zz']) into v_garbage;
  if v_garbage <> 0 then raise exception 'ABORT: af_eligible_count garbage token returned %', v_garbage; end if;
  select count(*) into v_tcbd_garbage from top_cities_by_deal_ar(p_amenities:=array['garbage_token_zz']);
  if v_tcbd_garbage <> 0 then raise exception 'ABORT: top_cities_by_deal_ar garbage token returned % rows', v_tcbd_garbage; end if;

  raise notice 'SUCCESS: 8 tokens live on af_eligibility_clause (4 templated RPCs) + top_cities_by_deal_ar; chip==direct==referee for every token; certified cohorts invariant; parity 0; both surfaces still fail closed on garbage tokens';
end $do$;
