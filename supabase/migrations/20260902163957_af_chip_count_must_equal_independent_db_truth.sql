-- THE ADVANCED FILTER NUMBER MUST EQUAL THE DATABASE, NOT MERELY EQUAL ITSELF.
--
-- WHAT WAS MISSING. ops_af_option_truth_sweep() compares three RPC surfaces — the chip count
-- (apartment_guided_counts_ar), the applied count (af_eligible_count) and the result set
-- (location_search_candidates_ar). All three are generated from ONE shared clause
-- (af_eligibility_clause) into one another. That catches drift BETWEEN the surfaces, and it caught a
-- real one (the direction scope defect, 2026-09-01). It is structurally blind to a clause that is
-- uniformly wrong: if the shared clause said `bathrooms >= p` where the product means `>`, or if
-- payment_monthly went stale, every surface would agree with every other, the sweep would report
-- zero defects, and the button would still be lying to the user.
--
-- THIS MIGRATION adds the fourth, independent leg: a plain-SQL count over search_listings_ar that
-- uses the DOCUMENTED semantics (docs/ARCHITECTURE.md §17, docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md
-- §2) written out directly — the row's own column, the row's own rent_period_ar + rent_now_pay_later
-- (never the derived payment_monthly flag, so a stale flag surfaces as a disagreement), the unlocated
-- fallback exactly as documented — and a daily detector that compares the chip the user is shown
-- against that number for every certified cohort × every option. It shares no SQL with the RPCs.
--
-- ONE VOCABULARY. The sweep hard-codes its option table; a chip the sweep does not know about is a
-- chip it silently proves nothing about (scripts/verify-af-option-count-equals-listings.ts pins the
-- UI side of that). af_option_truth_table() is now the queryable form of that vocabulary, and
-- af_option_vocab_drift() proves on every sweep that it still matches the sweep's own body — so the
-- two cannot drift apart without a P1.
--
-- FAILS LOUD, NEVER DARK. The detector re-proves its comparator against canonical cases on every
-- run (a broken comparator reads as a clean bill of health), refuses to run on a near-empty cohort
-- registry, and is registered in the roster in this SAME migration (a detector nothing reaches is
-- decoration — mon_detect_orphaned_detectors). Mutation proof at the bottom: the migration itself
-- fails if the vocabulary has drifted, if the truth count is insensitive to its predicate, if the
-- period semantics do not discriminate, or if the comparator misclassifies a canonical case.

-- 1. The option vocabulary, queryable. Byte-for-byte the rows ops_af_option_truth_sweep applies.
create or replace function public.af_option_truth_table()
returns table(label text, cnt_col text, af_param text, row_pred text, family text)
language sql immutable as $$
  select * from (values
    ('amenity:kitchen','cnt_kitchen','p_amenities:=array[''kitchen'']','s.kitchen is true','guided'),
    ('amenity:parking','cnt_parking','p_amenities:=array[''parking'']','s.parking is true','guided'),
    ('amenity:elevator','cnt_elevator','p_amenities:=array[''elevator'']','s.elevator is true','guided'),
    ('amenity:ac','cnt_ac','p_amenities:=array[''ac'']','s.air_conditioner is true','guided'),
    ('amenity:private_entrance','cnt_private_entrance','p_amenities:=array[''private_entrance'']','s.private_entrance is true','guided'),
    ('amenity:maid_room','cnt_maid_room','p_amenities:=array[''maid_room'']','s.maid_room is true','guided'),
    ('amenity:driver_room','cnt_driver_room','p_amenities:=array[''driver_room'']','s.driver_room is true','guided'),
    ('amenity:car_entrance','cnt_car_entrance','p_amenities:=array[''car_entrance'']','s.car_entrance is true','guided'),
    ('amenity:sanitation','cnt_sanitation','p_amenities:=array[''sanitation'']','s.sanitation is true','guided'),
    ('amenity:electricity','cnt_electricity','p_amenities:=array[''electricity'']','s.electricity is true','guided'),
    ('amenity:water_supply','cnt_water_supply','p_amenities:=array[''water_supply'']','s.water_supply is true','guided'),
    ('rnpl','cnt_rnpl','p_amenities:=array[''rnpl'']','s.rent_now_pay_later is true','guided'),
    ('furnished:yes','cnt_furnished','p_furnished:=true','s.furnished is true','guided'),
    ('furnished:no','cnt_unfurnished','p_furnished:=false','s.furnished is false','guided'),
    ('bathrooms:1+','cnt_bath1','p_bath_min:=1','s.bathrooms >= 1','guided'),
    ('bathrooms:2+','cnt_bath2','p_bath_min:=2','s.bathrooms >= 2','guided'),
    ('bathrooms:3+','cnt_bath3','p_bath_min:=3','s.bathrooms >= 3','guided'),
    ('bathrooms:4+','cnt_bath4','p_bath_min:=4','s.bathrooms >= 4','guided'),
    ('street_width:15+','cnt_stw15','p_street_width_min:=15::smallint','s.street_width_m >= 15','guided'),
    ('street_width:20+','cnt_stw20','p_street_width_min:=20::smallint','s.street_width_m >= 20','guided'),
    ('street_width:25+','cnt_stw25','p_street_width_min:=25::smallint','s.street_width_m >= 25','guided'),
    ('street_width:30+','cnt_stw30','p_street_width_min:=30::smallint','s.street_width_m >= 30','guided'),
    ('direction:شمال','cnt_dir_n','p_directions:=array[''شمال'']','norm_direction_ar(s.direction_ar) = ''شمال''','guided'),
    ('direction:جنوب','cnt_dir_s','p_directions:=array[''جنوب'']','norm_direction_ar(s.direction_ar) = ''جنوب''','guided'),
    ('direction:شرق','cnt_dir_e','p_directions:=array[''شرق'']','norm_direction_ar(s.direction_ar) = ''شرق''','guided'),
    ('direction:غرب','cnt_dir_w','p_directions:=array[''غرب'']','norm_direction_ar(s.direction_ar) = ''غرب''','guided'),
    ('direction:شمال شرق','cnt_dir_ne','p_directions:=array[''شمال شرق'']','norm_direction_ar(s.direction_ar) = ''شمال شرق''','guided'),
    ('direction:شمال غرب','cnt_dir_nw','p_directions:=array[''شمال غرب'']','norm_direction_ar(s.direction_ar) = ''شمال غرب''','guided'),
    ('direction:جنوب شرق','cnt_dir_se','p_directions:=array[''جنوب شرق'']','norm_direction_ar(s.direction_ar) = ''جنوب شرق''','guided'),
    ('direction:جنوب غرب','cnt_dir_sw','p_directions:=array[''جنوب غرب'']','norm_direction_ar(s.direction_ar) = ''جنوب غرب''','guided'),
    ('rating:9.5','cnt_rating95','p_rating_min:=9.5','s.rating >= 9.5','guided'),
    ('rating:9.0','cnt_rating90','p_rating_min:=9.0','s.rating >= 9.0','guided'),
    ('rating:9.0_rc10','cnt_rating90_rc10','p_rating_min:=9.0, p_reviews_min:=10','s.rating >= 9.0 and s.reviews_count >= 10','guided'),
    ('unit_subtype:استديو','cnt_sub_studio','p_unit_subtypes:=array[''استديو'']','s.unit_subtype_ar = ''استديو''','guided'),
    ('unit_subtype:شقق مخدومة','cnt_sub_serviced','p_unit_subtypes:=array[''شقق مخدومة'']','s.unit_subtype_ar = ''شقق مخدومة''','guided'),
    ('unit_subtype:شقة','cnt_sub_regular','p_unit_subtypes:=array[''شقة'']','s.unit_subtype_ar = ''شقة''','guided'),
    ('property_age:new','cnt_new','p_is_new_construction:=true','s.property_age = 0','age'),
    ('property_age:1_2','cnt_1_2','p_age_min:=1, p_age_max:=2','s.property_age between 1 and 2','age'),
    ('property_age:3_5','cnt_3_5','p_age_min:=3, p_age_max:=5','s.property_age between 3 and 5','age'),
    ('property_age:6_9','cnt_6_9','p_age_min:=6, p_age_max:=9','s.property_age between 6 and 9','age'),
    ('property_age:10p','cnt_10p','p_age_min:=10','s.property_age >= 10','age')
  ) as t(label, cnt_col, af_param, row_pred, family);
$$;

comment on function public.af_option_truth_table() is
  'The Advanced Filter option vocabulary as data: chip label, the cnt_* column the UI reads, the RPC param a tap sends, and the predicate read off the row''s own column. Must equal the rows inside ops_af_option_truth_sweep — af_option_vocab_drift() proves it.';

-- 2. The two vocabularies must stay in lockstep. Parses the sweep''s own body.
create or replace function public.af_option_vocab_drift()
returns table(side text, label text)
language plpgsql stable as $fn$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  if v_def is null then raise exception 'ops_af_option_truth_sweep not found'; end if;
  return query
    with sweep as (
      select distinct m[1] as label
        from regexp_matches(v_def, '\(''([^'']+)'',''(cnt_[a-z0-9_]+)''', 'g') m),
    tab as (select t.label from public.af_option_truth_table() t)
    select 'sweep_only'::text, s.label from sweep s where not exists (select 1 from tab t where t.label = s.label)
    union all
    select 'table_only'::text, t.label from tab t where not exists (select 1 from sweep s where s.label = t.label);
end $fn$;

-- 3. The DOCUMENTED cohort scope, as plain SQL text. No RPC, no shared clause, no derived flag.
--    Period rule (ARCHITECTURE §17 + sync_payment_monthly's contract): RNPL is an ANNUAL contract
--    paid in instalments, never Monthly; a monthly row is rent_period_ar='شهري' AND NOT rnpl.
--    Unlocated fallback: a row not production_ready is reachable only through a location-free
--    search, and only when it has no city or no region (search_row_price_gated is neutralised).
create or replace function public.ops_af_cohort_predicate_sql(p_deal text, p_period text, p_type text)
returns text language sql immutable as $$
  select format(
    $p$ s.deal_ar = %L and s.type_ar = %L
        and (s.production_ready or s.city_id is null or s.region_id is null)
        and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
        and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
        and (%L::text is null or s.deal_ar <> 'إيجار'
             or (%L::text = 'شهري' and s.rent_period_ar = 'شهري' and not coalesce(s.rent_now_pay_later, false))
             or (%L::text = 'سنوي' and (s.rent_period_ar = 'سنوي'
                                        or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))) $p$,
    p_deal, p_type, p_period, p_period, p_period);
$$;

create or replace function public.ops_af_option_db_truth(p_deal text, p_period text, p_type text, p_row_pred text)
returns bigint language plpgsql stable as $fn$
declare n bigint;
begin
  execute format('select count(*) from public.search_listings_ar s where %s and (%s)',
                 public.ops_af_cohort_predicate_sql(p_deal, p_period, p_type), p_row_pred) into n;
  return n;
end $fn$;

comment on function public.ops_af_option_db_truth(text, text, text, text) is
  'Independent DB truth for one AF option in one certified cohort: a plain count over search_listings_ar using the documented scope and the option predicate on the row''s own column. Shares no SQL with the RPCs.';

-- 4. The comparator, factored out so it can be proven. A NULL chip means the RPC exposes no such
--    count for this cohort (the chip does not exist) — nothing to compare, never a disagreement.
create or replace function public.af_chip_truth_disagrees(p_chip bigint, p_truth bigint)
returns boolean language sql immutable as $$
  select p_chip is not null and p_chip is distinct from p_truth
$$;

-- 5. The detector. Daily slot, one rotating slice of the cohort registry per day (full coverage
--    every 6 days), counts only — cheap enough that this is not what ever times the sweep out.
create or replace function public.mon_detect_af_chip_vs_db_truth()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  SLICES constant int := 6;
  v_slice int := mod(extract(doy from now())::int, SLICES);
  v_bad jsonb := '[]'::jsonb;
  v_n int := 0; v_cells int := 0; v_cohorts int;
  v_drift text;
  c record; o record;
  v_base text; v_counts jsonb; v_age jsonb; v_chip bigint; v_truth bigint;
begin
  -- SELF-PROOF, every sweep. A comparator that stopped discriminating reads as clean.
  if    public.af_chip_truth_disagrees(null, 5)          -- no chip => nothing to compare
     or public.af_chip_truth_disagrees(5, 5)
     or not public.af_chip_truth_disagrees(0, 3)         -- the direction-defect shape: chip 0, truth 3
     or not public.af_chip_truth_disagrees(5, 6)
  then
    return public.mon_raise('P1', 'detector_discriminator_broken', 'monitoring',
      'detector_discriminator_broken:af_chip_vs_db_truth',
      jsonb_build_object('detector', 'mon_detect_af_chip_vs_db_truth',
        'why', 'af_chip_truth_disagrees() no longer classifies the canonical cases. Until fixed this '
            || 'detector is unmeasured, not green.'));
  end if;

  -- VOCABULARY LOCKSTEP, every sweep. A chip the sweep cannot apply is a chip nobody proves.
  select string_agg(d.side || ':' || d.label, ', ' order by d.side, d.label) into v_drift
    from public.af_option_vocab_drift() d;
  if v_drift is not null then
    return public.mon_raise('P1', 'af_option_vocab_drift', 'all', 'af_option_vocab_drift',
      jsonb_build_object('drift', v_drift,
        'why', 'af_option_truth_table() and the option rows inside ops_af_option_truth_sweep() no '
            || 'longer list the same chips. Whichever side is missing a chip proves nothing about it.',
        'adjudicate', 'Add the missing row to BOTH in one migration. Never drop a row to make them agree.'));
  else
    perform public.mon_resolve_key('af_option_vocab_drift', 'af_option_vocab_drift');
  end if;

  if not public.mon_claim_daily_slot('af_chip_vs_db_truth') then return 0; end if;

  -- FAIL CLOSED on an empty registry: a detector watching nothing reads as clean.
  select count(*) into v_cohorts from public.af_cohort_registry where enabled;
  if coalesce(v_cohorts, 0) < 10 then
    raise exception 'refusing to run: af_cohort_registry has only % enabled cohorts', v_cohorts;
  end if;

  for c in
    select * from (
      select r.deal_ar, r.rent_period_ar, r.type_ar,
             (row_number() over (order by r.deal_ar, r.rent_period_ar nulls first, r.type_ar) - 1) as rn
        from public.af_cohort_registry r where r.enabled) z
    where mod(z.rn, SLICES) = v_slice
    order by z.rn
  loop
    v_base := format('p_deal:=%L, p_types:=array[%L]::text[]', c.deal_ar, c.type_ar)
              || coalesce(format(', p_rent_period:=%L', c.rent_period_ar), '');
    execute format('select to_jsonb(g) from public.apartment_guided_counts_ar(%s) g', v_base) into v_counts;
    execute format('select to_jsonb(a) from public.property_age_option_counts_ar(%s) a', v_base) into v_age;

    for o in select * from public.af_option_truth_table() loop
      v_chip := (case o.family when 'age' then v_age ->> o.cnt_col else v_counts ->> o.cnt_col end)::bigint;
      continue when v_chip is null;
      v_cells := v_cells + 1;
      v_truth := public.ops_af_option_db_truth(c.deal_ar, c.rent_period_ar, c.type_ar, o.row_pred);
      if public.af_chip_truth_disagrees(v_chip, v_truth) then
        v_n := v_n + 1;
        v_bad := v_bad || jsonb_build_object(
          'cohort', c.type_ar || '|' || c.deal_ar || '|' || coalesce(c.rent_period_ar, '-'),
          'option', o.label, 'chip_shown_to_user', v_chip, 'db_truth', v_truth);
      end if;
    end loop;
  end loop;

  update public.ops_detector_last_full_run
     set last_result = v_n where detector = 'af_chip_vs_db_truth';

  if v_n = 0 then
    perform public.mon_resolve_key('af_chip_vs_db_truth', 'af_chip_vs_db_truth_slice_' || v_slice);
    return 0;
  end if;

  return public.mon_raise('P1', 'af_chip_vs_db_truth', 'all',
    'af_chip_vs_db_truth_slice_' || v_slice,
    jsonb_build_object('disagreements', v_n, 'cells_checked', v_cells,
      'slice', v_slice, 'of_slices', SLICES, 'cohorts_enabled', v_cohorts, 'offenders', v_bad,
      'why', 'The number on an Advanced Filter chip disagrees with a plain count of the search index '
          || 'under the DOCUMENTED semantics. Unlike ops_af_option_truth_sweep, this compares the RPC '
          || 'against something that shares no SQL with it, so a uniformly wrong shared clause, a '
          || 'stale derived flag (payment_monthly) or a wrong unlocated-fallback rule shows up here '
          || 'even while every RPC surface agrees with every other.',
      'adjudicate', 'Recompute ops_af_option_db_truth() for the offender and diff the two row sets '
          || 'by (source_table, listing_id). If the DOCUMENTED rule is what changed, update '
          || 'ops_af_cohort_predicate_sql() in the same migration as the doc. Never edit the chip.'));
end $fn$;

comment on function public.mon_detect_af_chip_vs_db_truth() is
  'P1: an AF chip count that disagrees with an independent plain-SQL count of the search index under the documented semantics. Daily, one rotating slice of the certified cohorts per day.';

-- Roster row (mon_detect_stalled_daily_detector watches it) — same migration as the detector.
insert into public.ops_detector_last_full_run (detector, last_run_at, last_result)
values ('af_chip_vs_db_truth', now() - interval '2 days', null)
on conflict (detector) do nothing;

-- The slice key is re-affirmed every 6 days by construction; declare that clock so
-- mon_detect_stuck_open_alert judges it inside its real horizon (2026-09-01 rule).
insert into public.ops_alert_kind_autoresolve (kind, horizon, note)
values ('af_chip_vs_db_truth', interval '7 days',
        'slice-keyed daily detector: each slice is re-checked and resolved every 6 days by rotation')
on conflict (kind) do nothing;

-- Reach it from the twice-hourly sweep. Same anchor idiom as 20260902025807.
do $mig$
declare v_def text; v_new text;
  v_needle constant text := '''mon_detect_af_option_count_truth'',';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_af_chip_vs_db_truth' in v_def) > 0 then return; end if;   -- already on it
  if position(v_needle in v_def) = 0 then raise exception 'anchor not found — refusing to guess'; end if;
  v_new := replace(v_def, v_needle, v_needle || E'\n    ''mon_detect_af_chip_vs_db_truth'',');
  if length(v_new) <= length(v_def) then raise exception 'edit did not grow the body'; end if;
  execute v_new;
end
$mig$;

-- MUTATION PROOF. The migration refuses to land if any leg of the barrier is inert.
do $proof$
declare v_all bigint; v_kit bigint; v_none bigint; v_mon bigint; v_ann bigint; v_drift int;
begin
  select count(*) into v_drift from public.af_option_vocab_drift();
  if v_drift <> 0 then raise exception 'vocabulary drift at apply time: % rows', v_drift; end if;

  -- the truth count must be sensitive to its predicate
  v_all  := public.ops_af_option_db_truth('بيع', null, 'شقة', 'true');
  v_kit  := public.ops_af_option_db_truth('بيع', null, 'شقة', 's.kitchen is true');
  v_none := public.ops_af_option_db_truth('بيع', null, 'شقة', 'false');
  if not (v_all > v_kit and v_kit > 0 and v_none = 0) then
    raise exception 'truth count is not predicate-sensitive: all=% kitchen=% none=%', v_all, v_kit, v_none;
  end if;

  -- the period rule must discriminate monthly from annual on the apartment cohorts
  v_mon := public.ops_af_option_db_truth('إيجار', 'شهري', 'شقة', 'true');
  v_ann := public.ops_af_option_db_truth('إيجار', 'سنوي', 'شقة', 'true');
  if not (v_mon > 0 and v_ann > 0 and v_mon <> v_ann) then
    raise exception 'period rule does not discriminate: monthly=% annual=%', v_mon, v_ann;
  end if;

  -- the comparator must classify the canonical cases
  if public.af_chip_truth_disagrees(null, 5) or public.af_chip_truth_disagrees(5, 5)
     or not public.af_chip_truth_disagrees(0, 3) or not public.af_chip_truth_disagrees(5, 6) then
    raise exception 'comparator misclassifies a canonical case';
  end if;

  -- and the detector must actually be reachable
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
                    and position('mon_detect_af_chip_vs_db_truth' in pg_get_functiondef(p.oid)) > 0) then
    raise exception 'detector not on the roster';
  end if;
end
$proof$;
