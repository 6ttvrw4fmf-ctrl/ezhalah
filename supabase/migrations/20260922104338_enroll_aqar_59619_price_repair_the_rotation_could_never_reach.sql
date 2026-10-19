-- Repair 20260922073326 (routine #3, landed 07:33 today) was never enrolled in
-- ops_repair_guarantee_registry. The enrollment limb caught it within the hour:
-- scripts/verify-repair-guarantee-enrollment-live.ts has FAILED on every run since 08:06
-- (runs 35702987237, 35703422871, 35707624492, 35708926549, 35714571024), raising
-- seam_check_failed / workflow_failed:repair-enrollment-guard.yml (alert 4743).
--
-- The registry is the STANDING half of the orphaned-guarantee contract: a one-shot repair is a
-- CLAIM about an invariant, and only a registered row is re-verified by the oldest-first
-- rotation. Neither limb of mon_detect_repair_guarantee_stale() can see this, because both take
-- the registry as their universe. docs/ops/SYSTEMS_SEAM_ENGINEER.md PART 1 assigns the
-- enrollment of ANOTHER routine's unregistered repair to routine #7, on sight, rather than as a
-- request filed back to its author.
--
-- It is a repair by the classifier's test and by the plain-words discriminator: an UPDATE
-- executed at migration time against a row that already existed, changing its meaning. It would
-- be wrong if it drifted back — the pre-repair state SERVED 25,000,000 SAR over 5 m2 to an
-- anonymous user while aqar publishes «طلب تسويق» and no structured price (ops_incident #589).
--
-- INVARIANT VERIFIED AGAINST PRODUCTION AT ENROLLMENT, not re-read from the migration's comments:
--   aqar_residential_listings 59619 : price_total IS NULL, area_m2 = 5 (untouched, as the
--                                     migration's own verify block required), active, and
--                                     last_seen_at still 2026-07-30 — it has not been re-read.
--   search_listings_ar        59619 : price_total, price_total_effective and price_per_meter all
--                                     NULL — the repair reached the SERVED layer, not just raw.
-- Hence last_verdict = 'holds'.
--
-- KNOWN PARTIAL COVERAGE, recorded rather than glossed. mon_detect_served_price_never_rechecked()
-- exists and is on the mon_run_all_detectors() roster, but it is a COHORT detector keyed
-- 'served_price_never_rechecked:<table>', and its population is rows that are served AND priced
-- AND stale. The repair set price_total to NULL, so row 59619 has LEFT that population: measured
-- at enrollment the aqar_residential cohort is 166, and 59619 is not one of them. A drift-back
-- would return the row to the cohort as 167 — but alert 4734 is already OPEN on that exact dedup
-- key, and mon_raise() returns 0 on an already-open key, so the increment would raise NOTHING.
-- The detector genuinely watches the CLASS (the precondition that let this rot unseen) and does
-- NOT give row-level drift detection for this repair while that alert stands open.
--
-- This is deliberately NOT fixed by widening the detector or by writing an empty detector column:
-- narrowing or widening routine #3's price detector is not this row's to decide, and the registry
-- rotation itself re-verifies this invariant against production on its own cadence, which is the
-- standing coverage the registry exists to provide. Stated here so the next reader inherits the
-- measurement rather than the assumption.
--
-- routine #7 (systems-seam), 2026-09-22.

insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by,
   last_verified_at, last_verdict, last_detail)
values
  ('20260922073326',
   'repair_aqar_59619_price_source_publishes_no_price',
   'aqar_residential_listings 59619 (ad 6708117) carries NO price — price_total stays NULL and '
   || 'never returns to 25,000,000 SAR — for as long as aqar publishes «طلب تسويق» with no '
   || 'structured price, and the served row in search_listings_ar carries no effective price '
   || 'either. area_m2 stays 5: the source never stated an absence for area, so it was not '
   || 'repaired and must not be "repaired" later by extrapolation.',
   'mon_detect_served_price_never_rechecked',
   'systems-seam',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'raw_price_total', null,
     'raw_area_m2', 5,
     'raw_last_seen_at', '2026-07-30T01:00:20Z',
     'served_price_total_effective', null,
     'served_price_per_meter', null,
     'propagated_to_served_layer', true,
     'detector_on_roster', true,
     'detector_cohort_now', 166,
     'detector_covers_this_row_today', false,
     'coverage_note', 'COHORT detector, dedup_key served_price_never_rechecked:aqar_residential_listings. '
       || 'The repaired row left its population by being repaired (population = served AND priced AND '
       || 'stale). A drift-back would make the cohort 167 inside dedup key alert 4734, which is already '
       || 'open, so mon_raise() would return 0 and nothing would fire. Class coverage yes; row-level '
       || 'drift coverage no, while 4734 stands. Not widened here — routine #3 owns that detector.',
     'found_by', 'scripts/verify-repair-guarantee-enrollment-live.ts, red on 5 consecutive runs from 08:06Z',
     'note', 'Enrolled by routine #7 per SYSTEMS_SEAM_ENGINEER.md PART 1: another routine''s '
          || 'unregistered repair is enrolled on sight, not filed back as a request.'));

do $$
declare v_verdict text; v_detector text;
begin
  select last_verdict, detector into v_verdict, v_detector
    from public.ops_repair_guarantee_registry where repair_version = '20260922073326';
  if v_verdict is distinct from 'holds' then
    raise exception 'enrollment did not take: verdict=%', v_verdict;
  end if;
  if v_detector is null or v_detector = '' then
    raise exception 'refusing an empty detector column dressed up as coverage';
  end if;
  -- the detector named must actually exist AND be reachable from the roster
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = v_detector) then
    raise exception 'named detector % does not exist', v_detector;
  end if;
  if not exists (select 1 from pg_proc r where r.proname = 'mon_run_all_detectors'
                  and pg_get_functiondef(r.oid) like '%' || v_detector || '%') then
    raise exception 'named detector % is not on the mon_run_all_detectors roster', v_detector;
  end if;
end $$;
