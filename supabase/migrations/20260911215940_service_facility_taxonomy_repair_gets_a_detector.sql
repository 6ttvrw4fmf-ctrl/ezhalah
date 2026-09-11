-- Companion to 20260911215017 (service-facility taxonomy + district-filter Arabic digits), required
-- by verify-repair-migrations-are-guarded.ts: a data repair without a standing detector is a claim
-- that decays. Two ways that repair can silently regress, one limb each:
--   (A) the four service-facility types drop back out of known_type_ar (a seed regenerated from a
--       stale taxonomy.source.json) — the enforce_price_size_sanity trigger then re-sentinels every
--       matching row to «غير معروف» on its next write, and the rows silently leave every نوع cohort
--       again. Checked against RAW truth: a production_ready dealapp row whose raw property_type is
--       one of the four must never carry the sentinel in the index.
--   (B) district_ar_looks_bogus weakens (or the picklist refresh stops consulting it) — junk
--       (Arabic-Indic plot codes, description fragments) re-enters loc_canonical_district as
--       selectable "districts". Checked as: zero source='live' canonicals may fail the live filter.
create or replace function public.mon_detect_service_facility_types_regressed()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  v_missing int;
  v_sentineled int;
  v_bogus int;
begin
  -- (A1) allowlist integrity
  select 4 - count(*) into v_missing from public.known_type_ar
   where type_ar in ('مستشفى','مركز أعمال','منتجع','موقع صراف') and macro = 'Commercial';
  -- (A2) the repair's exact regression signature, judged against raw source truth
  select count(*) into v_sentineled
    from public.search_listings_ar s
    join public.dealapp_residential_listings d on d.id = s.listing_id
   where s.source_table = 'dealapp_residential_listings'
     and s.production_ready
     and d.property_type in ('مستشفى','مركز أعمال','منتجع','موقع صراف')
     and s.type_ar = 'غير معروف';
  if v_missing > 0 or v_sentineled > 0 then
    n := n + public.mon_raise('P2', 'service_facility_types_regressed', 'dealapp',
      'service_facility_types_regressed:taxonomy',
      jsonb_build_object(
        'missing_from_known_type_ar', v_missing,
        'sentineled_rows', v_sentineled,
        'why', 'The 2026-09-11 owner decision (ops_incident #172) mapped مستشفى/مركز أعمال/منتجع/'
            || 'موقع صراف under مرافق خدمية. Either the types dropped out of known_type_ar (stale '
            || 'seed regen) or the sentinel returned on rows whose RAW property_type is one of the '
            || 'four — the enforce_price_size_sanity trigger re-sentinels anything off-allowlist, '
            || 'so fix the allowlist first, then let the hourly sync re-heal the rows. See '
            || 'migration 20260911215017.'));
  else
    perform public.mon_resolve_key('service_facility_types_regressed', 'service_facility_types_regressed:taxonomy');
  end if;

  -- (B) the district picklist must never hold a live-promoted row its own hygiene filter rejects
  select count(*) into v_bogus from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_bogus > 0 then
    n := n + public.mon_raise('P2', 'service_facility_types_regressed', 'all',
      'service_facility_types_regressed:district_picklist_hygiene',
      jsonb_build_object(
        'bogus_live_canonicals', v_bogus,
        'why', 'loc_canonical_district holds live-promoted rows that district_ar_looks_bogus itself '
            || 'rejects — either the filter weakened or refresh_loc_canonical_district stopped '
            || 'consulting it. Users are being offered plan codes / description fragments as '
            || 'districts again. See migration 20260911215017 (v2 rules: Arabic-Indic digit runs, '
            || 'description-leak vocabulary).'));
  else
    perform public.mon_resolve_key('service_facility_types_regressed', 'service_facility_types_regressed:district_picklist_hygiene');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_service_facility_types_regressed() is
  'Watches the 20260911215017 repair: (A) the four مرافق خدمية types stay in known_type_ar and no '
  'production_ready dealapp row whose raw property_type is one of them carries the «غير معروف» '
  'sentinel; (B) loc_canonical_district holds zero live-promoted rows failing district_ar_looks_bogus. '
  'P2, on the mon_run_all_detectors() roster.';

-- ROSTER — needle-edited, never rebuilt from a remembered body (the amaall companion pattern,
-- 20260911201453; anchor chosen for uniqueness in the live roster).
do $mig$
declare def text;
  anchor constant text := '''mon_detect_amaall_native_location_regressed''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() is missing — refusing to invent a roster';
  end if;
  if position('mon_detect_service_facility_types_regressed' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor is not unique — refusing to needle-edit blindly';
  end if;
  def := replace(def, anchor, anchor || ',' || chr(10) || '    ''mon_detect_service_facility_types_regressed''');
  execute def;
end $mig$;

-- Proves the detector is reachable and currently green, in the same migration that creates it.
do $verify$
declare v_raised int;
begin
  select public.mon_detect_service_facility_types_regressed() into v_raised;
  if v_raised <> 0 then
    raise exception 'mon_detect_service_facility_types_regressed() raised % immediately after the '
      'repair it is meant to confirm — the repair is not actually holding', v_raised;
  end if;
end
$verify$;