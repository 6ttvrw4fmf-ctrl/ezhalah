-- Add cohort SLICING to ops_af_option_truth_sweep.
--
-- WHY: the first detector run hit the statement timeout sweeping all 59 certified cohorts in one
-- call. A detector that times out never fires, and a detector that cannot fire reads as a clean bill
-- of health — the precise failure mode this repo has been burned by before. Slicing bounds each run
-- so it always COMPLETES, and the detector rotates the slice by day so every cohort is still covered.
--
-- DROP FIRST, deliberately: adding parameters to a CREATE OR REPLACE would mint a SECOND overload
-- rather than replace this one, and two overloads of a public function is the exact PGRST203 shape
-- that took search down fleet-wide on 2026-07-16.
drop function if exists public.ops_af_option_truth_sweep(text, text, text, int, boolean);

create or replace function ops_af_option_truth_sweep(
  p_deal        text    default null,
  p_period      text    default null,
  p_type        text    default null,
  p_row_limit   int     default 2000,
  p_check_rows  boolean default true,
  p_slice       int     default null,   -- 0-based slice index; null = every cohort
  p_slices      int     default 1
) returns table(cohort text, opt text, chip bigint, applied bigint, returned bigint, viol bigint)
language plpgsql stable as $fn$
declare
  c record; o record;
  v_base text; v_chip bigint; v_applied bigint; v_ret bigint; v_viol bigint; v_counts jsonb;
begin
  for c in
    select * from (
      select r.deal_ar, r.rent_period_ar, r.type_ar,
             (row_number() over (order by r.deal_ar, r.rent_period_ar nulls first, r.type_ar) - 1) as rn
      from af_cohort_registry r
      where r.enabled
        and (p_deal   is null or r.deal_ar        = p_deal)
        and (p_period is null or r.rent_period_ar is not distinct from p_period)
        and (p_type   is null or r.type_ar        = p_type)
    ) z
    where p_slice is null or mod(z.rn, greatest(p_slices, 1)) = p_slice
    order by z.rn
  loop
    v_base := format('p_deal:=%L, p_types:=array[%L]::text[]', c.deal_ar, c.type_ar)
              || coalesce(format(', p_rent_period:=%L', c.rent_period_ar), '');

    execute format('select to_jsonb(g) from apartment_guided_counts_ar(%s) g', v_base) into v_counts;
    continue when v_counts is null;

    for o in
      select * from (values
        ('amenity:kitchen','cnt_kitchen','p_amenities:=array[''kitchen'']','s.kitchen is true'),
        ('amenity:parking','cnt_parking','p_amenities:=array[''parking'']','s.parking is true'),
        ('amenity:elevator','cnt_elevator','p_amenities:=array[''elevator'']','s.elevator is true'),
        ('amenity:ac','cnt_ac','p_amenities:=array[''ac'']','s.air_conditioner is true'),
        ('amenity:private_entrance','cnt_private_entrance','p_amenities:=array[''private_entrance'']','s.private_entrance is true'),
        ('amenity:maid_room','cnt_maid_room','p_amenities:=array[''maid_room'']','s.maid_room is true'),
        ('amenity:driver_room','cnt_driver_room','p_amenities:=array[''driver_room'']','s.driver_room is true'),
        ('amenity:car_entrance','cnt_car_entrance','p_amenities:=array[''car_entrance'']','s.car_entrance is true'),
        ('amenity:sanitation','cnt_sanitation','p_amenities:=array[''sanitation'']','s.sanitation is true'),
        ('amenity:electricity','cnt_electricity','p_amenities:=array[''electricity'']','s.electricity is true'),
        ('amenity:water_supply','cnt_water_supply','p_amenities:=array[''water_supply'']','s.water_supply is true'),
        ('rnpl','cnt_rnpl','p_amenities:=array[''rnpl'']','s.rent_now_pay_later is true'),
        ('furnished:yes','cnt_furnished','p_furnished:=true','s.furnished is true'),
        ('furnished:no','cnt_unfurnished','p_furnished:=false','s.furnished is false'),
        ('bathrooms:1+','cnt_bath1','p_bath_min:=1','s.bathrooms >= 1'),
        ('bathrooms:2+','cnt_bath2','p_bath_min:=2','s.bathrooms >= 2'),
        ('bathrooms:3+','cnt_bath3','p_bath_min:=3','s.bathrooms >= 3'),
        ('bathrooms:4+','cnt_bath4','p_bath_min:=4','s.bathrooms >= 4'),
        ('street_width:15+','cnt_stw15','p_street_width_min:=15::smallint','s.street_width_m >= 15'),
        ('street_width:20+','cnt_stw20','p_street_width_min:=20::smallint','s.street_width_m >= 20'),
        ('street_width:25+','cnt_stw25','p_street_width_min:=25::smallint','s.street_width_m >= 25'),
        ('street_width:30+','cnt_stw30','p_street_width_min:=30::smallint','s.street_width_m >= 30'),
        ('direction:شمال','cnt_dir_n','p_directions:=array[''شمال'']','norm_direction_ar(s.direction_ar) = ''شمال'''),
        ('direction:جنوب','cnt_dir_s','p_directions:=array[''جنوب'']','norm_direction_ar(s.direction_ar) = ''جنوب'''),
        ('direction:شرق','cnt_dir_e','p_directions:=array[''شرق'']','norm_direction_ar(s.direction_ar) = ''شرق'''),
        ('direction:غرب','cnt_dir_w','p_directions:=array[''غرب'']','norm_direction_ar(s.direction_ar) = ''غرب'''),
        ('direction:شمال شرق','cnt_dir_ne','p_directions:=array[''شمال شرق'']','norm_direction_ar(s.direction_ar) = ''شمال شرق'''),
        ('direction:شمال غرب','cnt_dir_nw','p_directions:=array[''شمال غرب'']','norm_direction_ar(s.direction_ar) = ''شمال غرب'''),
        ('direction:جنوب شرق','cnt_dir_se','p_directions:=array[''جنوب شرق'']','norm_direction_ar(s.direction_ar) = ''جنوب شرق'''),
        ('direction:جنوب غرب','cnt_dir_sw','p_directions:=array[''جنوب غرب'']','norm_direction_ar(s.direction_ar) = ''جنوب غرب'''),
        ('rating:9.5','cnt_rating95','p_rating_min:=9.5','s.rating >= 9.5'),
        ('rating:9.0','cnt_rating90','p_rating_min:=9.0','s.rating >= 9.0'),
        ('rating:9.0_rc10','cnt_rating90_rc10','p_rating_min:=9.0, p_reviews_min:=10','s.rating >= 9.0 and s.reviews_count >= 10'),
        ('unit_subtype:استديو','cnt_sub_studio','p_unit_subtypes:=array[''استديو'']','s.unit_subtype_ar = ''استديو'''),
        ('unit_subtype:شقق مخدومة','cnt_sub_serviced','p_unit_subtypes:=array[''شقق مخدومة'']','s.unit_subtype_ar = ''شقق مخدومة'''),
        ('unit_subtype:شقة','cnt_sub_regular','p_unit_subtypes:=array[''شقة'']','s.unit_subtype_ar = ''شقة''')
      ) as t(label, col, af_param, row_pred)
    loop
      v_chip := (v_counts ->> o.col)::bigint;
      continue when v_chip is null;

      execute format('select af_eligible_count(%s, %s)', v_base, o.af_param) into v_applied;

      v_ret := null; v_viol := null;
      if p_check_rows then
        execute format(
          'select count(distinct r.listing_id), count(*) filter (where not (%s)) '
          'from location_search_candidates_ar(%s, %s, p_limit:=%s, p_per_platform:=%s) r '
          'join search_listings_ar s on s.listing_id = r.listing_id',
          o.row_pred, v_base, o.af_param, p_row_limit, p_row_limit)
          into v_ret, v_viol;
      end if;

      if v_chip is distinct from v_applied
         or coalesce(v_viol, 0) <> 0
         or (p_check_rows and v_ret < least(v_chip, p_row_limit)) then
        cohort := c.type_ar || '|' || c.deal_ar || '|' || coalesce(c.rent_period_ar, '-');
        opt := o.label; chip := v_chip; applied := v_applied; returned := v_ret; viol := v_viol;
        return next;
      end if;
    end loop;
  end loop;
end
$fn$;

comment on function ops_af_option_truth_sweep(text,text,text,int,boolean,int,int) is
  'AF button truth: per cohort per option, chip count = applied filter = returned listings, and every returned row satisfies the predicate on its own column. Any returned row is a defect. p_slice/p_slices bound one run so it always completes.';

-- The detector now sweeps ONE rotating slice per day, so it completes inside the statement timeout
-- and still covers every cohort across the rotation.
create or replace function mon_detect_af_option_count_truth()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  SLICES constant int := 6;             -- full coverage every 6 days
  v_slice int := mod(extract(doy from now())::int, SLICES);
  v_bad jsonb := '[]'::jsonb;
  v_n int := 0; v_cohorts int; r record;
begin
  if not public.mon_claim_daily_slot('af_option_count_truth') then return 0; end if;

  select count(*) into v_cohorts from public.af_cohort_registry where enabled;
  if coalesce(v_cohorts, 0) < 10 then
    raise exception 'refusing to run: af_cohort_registry has only % enabled cohorts', v_cohorts;
  end if;

  for r in
    select * from public.ops_af_option_truth_sweep(
      p_deal := null, p_period := null, p_type := null,
      p_row_limit := 1, p_check_rows := false,
      p_slice := v_slice, p_slices := SLICES)
  loop
    v_n := v_n + 1;
    v_bad := v_bad || jsonb_build_object(
      'cohort', r.cohort, 'option', r.opt,
      'count_shown_on_chip', r.chip, 'count_the_filter_returns', r.applied);
  end loop;

  update public.ops_detector_last_full_run
     set last_result = v_n where detector = 'af_option_count_truth';

  if v_n = 0 then
    -- Resolve only THIS slice's key, so a real disagreement in another slice is not cleared by a
    -- clean run over cohorts that were never looked at.
    perform public.mon_resolve_key('af_option_count_truth','af_option_count_truth_slice_' || v_slice);
    return 0;
  end if;

  return public.mon_raise('P1','af_option_count_truth','all',
    'af_option_count_truth_slice_' || v_slice,
    jsonb_build_object(
      'disagreements', v_n,
      'slice', v_slice, 'of_slices', SLICES, 'cohorts_enabled', v_cohorts,
      'offenders', v_bad,
      'why', 'An Advanced Filter option shows the user one number and its filter returns another. '
          || 'The chip count comes from apartment_guided_counts_ar and the filter from '
          || 'af_eligible_count, both generated from af_eligibility_clause() — so a disagreement means '
          || 'the cnt_* expression and the predicate have drifted apart. The user is told N before '
          || 'they click and given something else after.',
      'adjudicate', 'Compare the cnt_* expression for that option against the matching predicate in '
          || 'af_eligibility_clause(). Check the SCOPE first: the direction defect (2026-09-01) was a '
          || 'cnt_* computed inside a scope that already applied the same parameter, while the UI '
          || 'action UNIONS onto it. Then re-run ops_af_option_truth_sweep with p_check_rows := true '
          || 'for that cohort to see whether the returned rows are wrong too, or only the number.'));
end
$fn$;
