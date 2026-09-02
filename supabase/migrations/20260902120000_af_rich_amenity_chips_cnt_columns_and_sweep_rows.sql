-- THE 8 RESIDENTIAL "RICH" AMENITIES GET A COUNT PATH (owner ruling 2026-09-02, GAP 1 of the AF
-- matrix certification: "expose them properly, with truthful chip/count support — not hidden
-- backend-only predicates").
--
-- gym, pool, garden, balcony, laundry_room, optical_fibers, separate_electricity_meter and
-- separate_water_meter have been certified for the CHAT path since 20260831205347 (the clause
-- whitelist + predicate arms, RESIDENTIAL_AMENITY_BASE in src/lib/afCohorts.ts) but had NO
-- cnt_* column in apartment_guided_counts_ar, NO chip in AMENITIES_QUESTION.resolveOptions and NO
-- row in ops_af_option_truth_sweep — a token a sentence could commit that no card could show, no
-- count could describe and no runtime sweep could prove.
--
-- This migration is the SQL half. Same-change client half: src/data/advancedFilters.ts (8 chip
-- defs), src/data/remote.ts (GuidedCounts), src/i18n.tsx (labels), scripts/verify-af-matrix-truth.ts
-- (offered == certified on every residential amenities cell).
--
-- ONE TEMPLATED PATH: the apartment_guided_counts_ar row of af_rpc_templates is needle-edited on
-- its LIVE text (every anchor must occur exactly once, else ABORT), then rebuild_af_filter_rpcs()
-- regenerates the RPC and stamps af_rpc_build_state — exactly as 20260815234444 did for
-- electricity/water_supply. The new cnt_* live INSIDE the same `scoped` CTE, so they honour the
-- committed scope like every other cnt_* (the 2026-09-01 direction defect was a count computed
-- outside the scope it claimed).
--
-- The runtime sweep (ops_af_option_truth_sweep) gets the 8 rows through a needle-edit on its live
-- body, after the water_supply row; the detector's day-slice then covers them like any option.
-- NOTE: af_option_truth_table() (PR #1513's in-DB roster, the complementary SQL leg) carries the
-- same option list and needs the same 8 rows — cited, not duplicated here; #1513 owns that function.
--
-- SELF-CHECK at apply time, per this repo's convention: parity 0 after rebuild; the certified
-- cohort's base count unchanged; for EVERY one of the 8 tokens chip == referee == direct count on
-- the fleet-wide base scope (the exact formula 20260831205347 used); garbage token still fails
-- closed on both count surfaces. Drop one cnt column from this file and the chip==referee check
-- raises — that is the mutation this migration is proven against on a fresh branch.
--
-- Mirror rule: sql/mirrors/af_eligibility_clause.sql is untouched by this file (the clause itself
-- does not change here — only a template row and the sweep body).

do $do$
declare
  tpl text; occ int; sweep_def text; sweep_new text;
  scoped_old text := $x$s.electricity, s.water_supply, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  scoped_new text := $x$s.electricity, s.water_supply, s.gym, s.pool, s.garden, s.balcony, s.laundry_room, s.optical_fibers, s.separate_electricity_meter, s.separate_water_meter, s.rating, s.reviews_count, s.unit_subtype_ar$x$;
  ret_old text := $x$cnt_electricity bigint, cnt_water_supply bigint, cnt_selected bigint$x$;
  ret_new text := $x$cnt_electricity bigint, cnt_water_supply bigint, cnt_gym bigint, cnt_pool bigint, cnt_garden bigint, cnt_balcony bigint, cnt_laundry_room bigint, cnt_optical_fibers bigint, cnt_separate_electricity_meter bigint, cnt_separate_water_meter bigint, cnt_selected bigint$x$;
  sel_old text := $x$    count(*) filter (where water_supply)                    as cnt_water_supply,$x$;
  sel_new text := $x$    count(*) filter (where water_supply)                    as cnt_water_supply,
    count(*) filter (where gym)                             as cnt_gym,
    count(*) filter (where pool)                            as cnt_pool,
    count(*) filter (where garden)                          as cnt_garden,
    count(*) filter (where balcony)                         as cnt_balcony,
    count(*) filter (where laundry_room)                    as cnt_laundry_room,
    count(*) filter (where optical_fibers)                  as cnt_optical_fibers,
    count(*) filter (where separate_electricity_meter)      as cnt_separate_electricity_meter,
    count(*) filter (where separate_water_meter)            as cnt_separate_water_meter,$x$;
  sweep_old text := $x$        ('amenity:water_supply','cnt_water_supply','p_amenities:=array[''water_supply'']','s.water_supply is true'),$x$;
  sweep_add text := $x$        ('amenity:water_supply','cnt_water_supply','p_amenities:=array[''water_supply'']','s.water_supply is true'),
        ('amenity:gym','cnt_gym','p_amenities:=array[''gym'']','s.gym is true'),
        ('amenity:pool','cnt_pool','p_amenities:=array[''pool'']','s.pool is true'),
        ('amenity:garden','cnt_garden','p_amenities:=array[''garden'']','s.garden is true'),
        ('amenity:balcony','cnt_balcony','p_amenities:=array[''balcony'']','s.balcony is true'),
        ('amenity:laundry_room','cnt_laundry_room','p_amenities:=array[''laundry_room'']','s.laundry_room is true'),
        ('amenity:optical_fibers','cnt_optical_fibers','p_amenities:=array[''optical_fibers'']','s.optical_fibers is true'),
        ('amenity:separate_electricity_meter','cnt_separate_electricity_meter','p_amenities:=array[''separate_electricity_meter'']','s.separate_electricity_meter is true'),
        ('amenity:separate_water_meter','cnt_separate_water_meter','p_amenities:=array[''separate_water_meter'']','s.separate_water_meter is true'),$x$;
  toks text[] := array['gym','pool','garden','balcony','laundry_room','optical_fibers','separate_electricity_meter','separate_water_meter'];
  tok text; before_n bigint; after_n bigint; parity int; v_counts jsonb; v_chip bigint; v_ref bigint; v_direct bigint; v_garbage bigint;
begin
  -- ── 1. the template row, needle-edited on its LIVE text ────────────────────────────────────
  select template into tpl from af_rpc_templates where fn_name = 'apartment_guided_counts_ar';
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no apartment_guided_counts_ar row'; end if;
  if position('cnt_gym' in tpl) > 0 then
    raise notice 'apartment_guided_counts_ar template already carries cnt_gym — template step skipped';
  else
    occ := (length(tpl) - length(replace(tpl, scoped_old, ''))) / length(scoped_old);
    if occ <> 1 then raise exception 'ABORT: scoped needle occurs %', occ; end if;
    tpl := replace(tpl, scoped_old, scoped_new);
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
  if before_n is distinct from after_n then
    raise exception 'ABORT: certified cohort changed %->%', before_n, after_n;
  end if;

  -- ── 2. chip == referee == direct, for every one of the 8 tokens, on the fleet-wide base ─────
  select to_jsonb(g) into v_counts from apartment_guided_counts_ar() g;
  foreach tok in array toks loop
    v_chip := (v_counts ->> ('cnt_' || tok))::bigint;
    if v_chip is null then raise exception 'ABORT: rebuilt RPC has no cnt_% column', tok; end if;
    select af_eligible_count(p_amenities:=array[tok]) into v_ref;
    execute format(
      $q$select count(*) from search_listings_ar s
         where (s.production_ready or (not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)))
           and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
           and s.deal_ar is not null and s.deal_ar in ('بيع','إيجار')
           and s.%I$q$,
      tok
    ) into v_direct;
    if v_chip <> v_ref or v_ref <> v_direct then
      raise exception 'ABORT: % chip % / referee % / direct % disagree', tok, v_chip, v_ref, v_direct;
    end if;
  end loop;
  select af_eligible_count(p_amenities:=array['garbage_token_zz']) into v_garbage;
  if v_garbage <> 0 then raise exception 'ABORT: af_eligible_count garbage token returned %', v_garbage; end if;

  -- ── 3. the runtime sweep learns the 8 options (needle-edit on the live body) ─────────────────
  select pg_get_functiondef(p.oid) into sweep_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  if sweep_def is null then raise exception 'ABORT: ops_af_option_truth_sweep not found'; end if;
  if position('amenity:gym' in sweep_def) > 0 then
    raise notice 'ops_af_option_truth_sweep already carries amenity:gym — sweep step skipped';
  else
    occ := (length(sweep_def) - length(replace(sweep_def, sweep_old, ''))) / length(sweep_old);
    if occ <> 1 then raise exception 'ABORT: sweep water_supply anchor occurs % — refusing to guess', occ; end if;
    sweep_new := replace(sweep_def, sweep_old, sweep_add);
    if length(sweep_new) <= length(sweep_def) then raise exception 'ABORT: sweep edit did not grow the body'; end if;
    execute sweep_new;
  end if;

  raise notice 'SUCCESS: cnt_gym…cnt_separate_water_meter live inside the scoped CTE of apartment_guided_counts_ar (templated, rebuilt, parity 0, certified cohort % unchanged); chip==referee==direct for all 8; sweep carries the 8 rows', after_n;
end $do$;

-- ── 4. af_field_registry: the 7 registered tokens become ui_exposed (optical_fibers has no row) ──
-- scripts/verify-ui-controls-have-predicates.ts reads this table LIVE and fails a chip whose row
-- says ui_exposed=false, so the registry must move with the chips. The 2026-08-10 reasons are
-- recorded here because they are superseded, not forgotten:
--   gym / pool / garden — "only sanadak publishes it and says NO on 184/184 — a UI chip would
--     return zero results": no longer true. Fleet-wide 2026-08-31 (20260831205347): gym 13/941,
--     pool 44/918, garden 49/923 true/false — two-sided, source-published, and the chip shows the
--     live count for the user's scope (a 0 chip is simply not rendered by meaningful()).
--   balcony / laundry_room — "coverage still thin": balcony 1,476/3,922, laundry_room 1,959/3,359.
--   separate_electricity_meter / separate_water_meter — "≈95% yes among known — filters data
--     coverage, not the property": the chip count is scoped and truthful (the NULL partition is
--     asserted on every cell by the matrix barrier), and the owner ruled 2026-09-02 that all 8 are
--     exposed with truthful chip/count support rather than kept as hidden backend-only predicates.
do $do$
declare n int;
begin
  update af_field_registry
     set ui_exposed = true, filter_tier = 'advanced', ui_group = coalesce(ui_group, 'more_options'),
         not_exposed_reason = null
   where canonical_key in ('gym','pool','garden','balcony','laundry_room','optical_fibers','separate_electricity_meter','separate_water_meter')
     and ui_exposed = false;
  get diagnostics n = row_count;
  if n = 0 and (select count(*) from af_field_registry where canonical_key in ('gym','pool','garden','balcony','laundry_room','separate_electricity_meter','separate_water_meter') and ui_exposed) = 7 then
    raise notice 'af_field_registry already exposes the rich set — skipped';
  elsif n < 7 then
    raise exception 'ABORT: expected to expose 7 registered rich tokens, updated %', n;
  end if;
  raise notice 'SUCCESS: % af_field_registry rows now ui_exposed (advanced tier)', n;
end $do$;
