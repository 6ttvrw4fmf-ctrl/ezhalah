-- Three data repairs landed 2026-09-13 were never enrolled in ops_repair_guarantee_registry.
--
-- The registry is the STANDING half of the orphaned-guarantee contract: a one-shot repair is a
-- CLAIM about an invariant, and only a registered row gets re-verified by the oldest-first
-- rotation. An unenrolled repair is invisible to that rotation FOREVER — which is the
-- orphaned-guarantee bug wearing a registry as a disguise
-- (docs/ops/SYSTEMS_SEAM_ENGINEER.md PART 1).
--
-- Neither limb of mon_detect_repair_guarantee_stale() can see this: both take the registry as
-- their universe, so a repair that never arrived is outside both. The enrollment limb that CAN
-- see it (scripts/verify-repair-guarantee-enrollment-live.ts) raised alert 2790
-- (repair_guarantee_unenrolled, open since 2026-09-13 18:56) and is what found these three.
--
-- All three are repairs by the classifier's test and by the plain-words discriminator: an UPDATE
-- executed at migration time against rows that already existed, changing their meaning. A NULL
-- city_ar drops an amlakalahsa row out of every city-scoped search, so it would be wrong if these
-- drifted back.
--
-- No new detector is needed and none is written here: mon_detect_amlakalahsa_district_consolidation_regressed()
-- already covers all three and names two of them in its own payload. Verified reachable at
-- enrollment time — on the mon_run_all_detectors() roster, returning 0 — so this is a genuine
-- detector, not an empty column dressed up as coverage.
--
-- Invariants verified against PRODUCTION at enrollment (not re-read from the migration comments):
--   264 amlakalahsa_residential_listings rows, 0 with a NULL city_ar, and 0 drift on each of the
--   four repaired clauses. Hence last_verdict = 'holds'.
--
-- routine #7 (systems-seam), 2026-09-14.

insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20260913182357',
   'amlakalahsa_final_three_districts_get_broad_city',
   'The amlakalahsa districts النور، العقير and الجرن keep a resolved city (الاحساء, city_id 3677) '
   || 'and never revert to a NULL city_ar — a NULL city drops the row out of city-scoped search.',
   'mon_detect_amlakalahsa_district_consolidation_regressed',
   'systems-seam',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_in_table', 264,
     'null_city_rows', 0,
     'drift_on_repaired_clause', 0,
     'detector_on_roster', true,
     'detector_returned', 0,
     'note', 'Enrolled by routine #7 after the enrollment limb (alert 2790) found it unregistered. '
          || 'Detector limb: amlakalahsa_district_consolidation_regressed:no_city, which lists all '
          || 'three districts explicitly.')),

  ('20260913184721',
   'amlakalahsa_riyadh_district_resolves_to_hofuf',
   'amlakalahsa rows in district الرياض (the Hofuf district, not the capital) keep their resolved '
   || 'city الهفوف (city_id 12) and never revert to a NULL city_ar.',
   'mon_detect_amlakalahsa_district_consolidation_regressed',
   'systems-seam',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'null_city_rows', 0,
     'drift_on_repaired_clause', 0,
     'detector_on_roster', true,
     'detector_returned', 0,
     'note', 'Covered by the :no_city limb, which carries الرياض in its district list. KNOWN '
          || 'PARTIAL: that limb matches only city_ar IS NULL, so a re-scrape that wrote a '
          || 'DIFFERENT non-null city onto this district would not trip it. Recorded here rather '
          || 'than silently widened — narrowing coverage is not this row''s to decide, and the '
          || 'observed decay mode for this platform is reversion to NULL.')),

  ('20260913190703',
   'amlakalahsa_jasha_and_marouj_janoubi_resolved',
   'amlakalahsa district الجشة keeps city الجشة (city_id 2746), and listing 11606266 (whose '
   || 'district truncated to bare المروج) keeps الهفوف (city_id 12) as resolved from its own '
   || 'description — neither reverts to a NULL city_ar.',
   'mon_detect_amlakalahsa_district_consolidation_regressed',
   'systems-seam',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'null_city_rows', 0,
     'drift_on_repaired_clause', 0,
     'listing_11606266_city', 'الهفوف',
     'detector_on_roster', true,
     'detector_returned', 0,
     'note', 'Two limbs cover this one migration: :no_city carries الجشة, and :marouj_janoubi '
          || 'watches listing 11606266 by id.'))
on conflict (repair_version) do nothing;
