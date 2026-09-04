-- The detector sweep (cron jobid 38, twice hourly) was killed twice in 24h at exactly its
-- 900s statement_timeout, and once tripped its 675s soft deadline and SKIPPED 26 detectors.
-- pg_cron runs the whole sweep in one transaction, so an abort rolls back every alert already
-- raised AND skips mon_dispatch_alerts: half an hour in which nothing is monitored.
--
-- Attribution from ops_detector_timing (24h, 46 sweeps) names the cost driver unambiguously:
--   mon_detect_v2_discards_captured_attrs  avg 50.9s  max 209.8s  total 2341s/day
-- which is 4.5x the next detector and ~39 minutes of sweep budget per day. The single sweep
-- that tripped the soft deadline (08:59Z, 683s, 26 skipped) is exactly the sweep where this
-- detector hit its 210s maximum -- 31% of that whole sweep. Without it that sweep lands at
-- ~473s, comfortably inside the 675s soft deadline, and all 26 detectors would have run.
--
-- It is a FULL-INVENTORY STRUCTURAL scan (listing_native_location_v2 joined to
-- listing_extra_attrs across every row, a 13-way OR plus a UNION arm over listing_age_resolved).
-- It detects a pipeline/schema defect class -- a v2 UNION branch dropping a captured attribute --
-- which changes at most daily, not every 30 minutes. That is precisely the class the repo
-- already gates: 13 detectors take mon_claim_daily_slot() (~20h), including
-- mon_detect_price_size_contamination, mon_detect_af_coverage_cliff and
-- mon_detect_location_predicate_drift.
--
-- This does NOT make the detector dark: mon_detect_stalled_daily_detector() raises P2 for any
-- entry in ops_detector_last_full_run older than 30h, so a gated detector that stops running is
-- loud. The detector stays in the mon_run_all_detectors roster, so mon_detect_orphaned_detectors
-- is unaffected. Nothing about WHAT it detects, its severity, its dedup key or its resolve arm
-- changes -- only how often it is allowed to run.
--
-- Body below is byte-identical to the live definition (md5 19742a56553baec22eb48bc881bdeef8)
-- except for the single added mon_claim_daily_slot guard.

CREATE OR REPLACE FUNCTION public.mon_detect_v2_discards_captured_attrs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int := 0; v_rows bigint; v_sample jsonb; v_open text;
begin
  if not public.mon_claim_daily_slot('v2_discards_captured_attrs') then return 0; end if;

  with discarded as (
    select v.platform, v.source_method, v.source_table, v.listing_id,
           case when ea.elevator         is not null and v.elevator         is null then 'elevator'
                when ea.parking          is not null and v.parking          is null then 'parking'
                when ea.kitchen          is not null and v.kitchen          is null then 'kitchen'
                when ea.air_conditioner  is not null and v.air_conditioner  is null then 'air_conditioner'
                when ea.maid_room        is not null and v.maid_room        is null then 'maid_room'
                when ea.driver_room      is not null and v.driver_room      is null then 'driver_room'
                when ea.private_entrance is not null and v.private_entrance is null then 'private_entrance'
                when ea.furnished        is not null and v.furnished        is null then 'furnished'
                when ea.direction        is not null and v.direction        is null then 'direction'
                when ea.street_width_m   is not null and v.street_width_m   is null then 'street_width_m'
                when ea.floor_number     is not null and v.floor_number     is null then 'floor_number'
                when ea.tenant_category  is not null and v.tenant_category  is null then 'tenant_category'
                when ea.license_number   is not null and v.license_number   is null then 'license_number'
           end as field
      from public.listing_native_location_v2 v
      join public.listing_extra_attrs ea
        on ea.source_table = v.source_table and ea.listing_id = v.listing_id
     where (ea.elevator is not null and v.elevator is null)
        or (ea.parking is not null and v.parking is null)
        or (ea.kitchen is not null and v.kitchen is null)
        or (ea.air_conditioner is not null and v.air_conditioner is null)
        or (ea.maid_room is not null and v.maid_room is null)
        or (ea.driver_room is not null and v.driver_room is null)
        or (ea.private_entrance is not null and v.private_entrance is null)
        or (ea.furnished is not null and v.furnished is null)
        or (ea.direction is not null and v.direction is null)
        or (ea.street_width_m is not null and v.street_width_m is null)
        or (ea.floor_number is not null and v.floor_number is null)
        or (ea.tenant_category is not null and v.tenant_category is null)
        or (ea.license_number is not null and v.license_number is null)
    union all
    select v.platform, v.source_method, v.source_table, v.listing_id, 'property_age'
      from public.listing_native_location_v2 v
      join public.listing_age_resolved car
        on car.source_table = v.source_table and car.listing_id = v.listing_id
     where car.property_age is not null and v.property_age is null
  )
  select count(*),
         (select jsonb_agg(to_jsonb(t)) from (select * from discarded limit 5) t)
    into v_rows, v_sample
    from discarded;

  select severity into v_open from public.alert_event
   where dedup_key = 'v2_discards_captured_attrs' and resolved_at is null
   order by created_at desc limit 1;

  if v_rows = 0 then
    if v_open is not null then
      perform public.mon_resolve_key('v2_discards_captured_attrs', 'v2_discards_captured_attrs');
    end if;
    return 0;
  end if;

  n := public.mon_raise('P1', 'v2_discards_captured_attrs', 'all', 'v2_discards_captured_attrs',
    jsonb_build_object(
      'rows', v_rows,
      'sample', v_sample,
      'why', 'listing_native_location_v2 is serving NULL for an advanced-filter attribute that '
          || 'listing_extra_attrs / listing_age_resolved already holds for the SAME listing. The '
          || 'value was captured from the source and canonicalised correctly; a branch of the v2 '
          || 'UNION is throwing it away, so those listings are unreachable by that Advanced Filter '
          || 'while every other listing on the same platform is reachable.',
      'adjudicate', 'Read source_method in the sample: it names the branch. Fix the BRANCH (attach '
          || 'listing_extra_attrs / listing_age_resolved on its own key, as the v1 branch does) -- '
          || 'never repair the rows, and never silence this by nulling the upstream value. '
          || 'Precedents: 20260717_v2_souq24_branches_attach_age_resolved, and run #32 (2026-08-20) '
          || 'for the catch-all branch and souq24 direction. Verify with a test view first: row '
          || 'counts equal, 0 non-target column diffs, 0 value->NULL losses.'));
  return n;
end
$function$;
