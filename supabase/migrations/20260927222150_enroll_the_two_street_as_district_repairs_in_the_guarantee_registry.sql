-- The standing half of repairs 20260927205755 and 20260927213758.
--
-- verify-repair-migrations-are-guarded.ts is the MERGE-time half: it asks whether a repair shipped
-- with a watcher. ops_repair_guarantee_registry is the STANDING half, and
-- verify-repair-guarantee-enrollment-live.ts asks PRODUCTION the same question on a schedule — a
-- repair that was never entered here is invisible to mon_detect_repair_guarantee_stale(), whose two
-- limbs both take the registry as their universe. Nine strict-era repairs were live and unenrolled
-- when that gap was measured; these two would have been the tenth and eleventh.
--
-- Both repairs serve ONE invariant, so both rows name the same detector. They are entered separately
-- because they repaired different surfaces and the live check keys on the migration version.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by,
   last_verified_at, last_verdict, last_detail)
values
  ('20260927205755',
   'aqarmonthly_street_is_not_a_district',
   'No aqarmonthly listing stores a STREET where its district belongs. Aqar joins its address '
   || 'segments into the URI slug and the first segment is an EMPTY district-type label «حي» '
   || 'whenever the ad names only a street, so «حي ، شارع ابن هلال الفلالي ، حي الرمال ، …» becomes '
   || '«حي-شارع-ابن-هلال-الفلالي-حي-الرمال-…» and a first-match capture reads the street. Neither '
   || 'district_ar (which listing_native_location_v1 and search_listings_ar are built from) nor '
   || 'neighborhood (which ResultCard prints verbatim whenever it is Arabic, owner rule 2026-07-06) '
   || 'may begin with a street marker — «حي شارع …» or the bare «شارع …». A row whose slug names no '
   || 'district carries NULL in both: an honest unknown, never the street it happens to sit on.',
   'mon_detect_aqarmonthly_street_as_district',
   'ad-hoc session 2026-09-27 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'active_rows', 1801,
     'rows_repaired', 36,
     'rows_repaired_active', 34,
     'rows_repaired_inactive', 2,
     'rows_set_to_null', 1,
     'rows_violating_invariant_raw', 0,
     'rows_violating_invariant_served', 0,
     'rows_with_district', 1656,
     'detector_exists', true,
     'detector_on_roster', true,
     'detector_raise_path_executed', true,
     'detector_evidence', 'raised P2 aqarmonthly_street_as_district:index (rows=34, raw_rows=0) '
                       || 'while the served index was still stale, and mon_resolve_stale_keys() '
                       || 'closed that key at 2026-09-27 21:44:57 UTC once it agreed',
     'forward_fix', 'resolve_slug() in scrapers/common/arabic_location.py skips a «حي X» capture '
                 || 'opening with a street marker and reads the next «حي …»; the capture is a '
                 || 'zero-width lookahead so a skipped 3-token window cannot eat the district''s own '
                 || '«حي». Pinned by 8 executed cases in '
                 || 'scrapers/common/tests/test_aqarmonthly_resolve_slug_district_suffix.py, all of '
                 || 'which fail when only the parser is reverted.')),
  ('20260927213758',
   'a_street_was_still_served_from_the_location_bridge',
   'The same invariant, on the surface that can resurrect it without a scrape. '
   || 'listing_native_location_v1 ends COALESCE(<native district_ar>, <listings_arabic_locations'
   || '.district_ar>), so an honest NULL in the platform table UNCOVERS whatever that legacy bridge '
   || 'holds, and sync_search_listings_ar() then passes it through loc_display_district_ar(), which '
   || 're-adds the «حي » prefix — serving «حي شارع ابي الفتوح», a string no table ever held. No '
   || 'aqarmonthly row in listings_arabic_locations may carry a street as its district.',
   'mon_detect_aqarmonthly_street_as_district',
   'ad-hoc session 2026-09-27 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'bridge_rows_cleared', 13,
     'bridge_rows_leaking_at_the_time', 1,
     'bridge_rows_armed_but_masked', 12,
     'served_rows_re_derived', 1,
     'rows_violating_invariant_bridge', 0,
     'why_masked_still_matters', 'a masked bridge row is silent while the native district is '
                              || 'non-NULL and resurfaces the moment that listing loses it, which '
                              || 'is exactly how AQM5728162 kept serving a street after the platform '
                              || 'table was already clean',
     'raw_district_kept', true,
     'raw_district_note', 'only district_ar is cleared; raw_district stays as the audit record of '
                       || 'what the pre-#4995 parse captured',
     'writer_check', 'none of the seven functions that write listings_arabic_locations '
                  || '(resolve_aqar_locations, resolve_dealapp_districts, resolve_raghdan_city, '
                  || 'resolve_amlakalahsa_locations, resolve_english_city_overlay, '
                  || 'resolve_dealapp_city, resolve_small_platform_cities) mentions aqarmonthly, so '
                  || 'the cleared rows cannot be rewritten',
     'detector_limb', 'limb 3 of mon_detect_aqarmonthly_street_as_district watches this table'))
on conflict (repair_version) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.ops_repair_guarantee_registry
   where repair_version in ('20260927205755','20260927213758');
  if n <> 2 then
    raise exception 'expected both street-as-district repairs enrolled, found %', n;
  end if;
end $$;
