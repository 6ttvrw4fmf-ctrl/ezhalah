-- Companion to 20260911195109 (amaall native-location wiring), required by
-- verify-repair-migrations-are-guarded.ts: a data repair without a standing detector is a claim
-- that decays. Two ways this specific repair can silently regress, both worth catching:
--   (A) listing_native_location_v1 loses amaall's arm again — this happened ONCE already, live,
--       minutes after the original fix: a DROP MATERIALIZED VIEW ... CASCADE took the whole chain
--       down, caught and restored by hand in the same session. A standing detector means the next
--       time doesn't depend on someone watching.
--   (B) the scraper stops writing district_ar/city_id (e.g. amaall's `property_area` taxonomy term
--       goes missing from the site again, silently reverting to the exact pre-fix state).
--
-- Same shape as every companion in WAIVED's history (verify-repair-migrations-are-guarded.ts):
-- create the detector, needle-edit it into mon_run_all_detectors()'s roster, run it once here so
-- the migration itself proves the detector is reachable and currently green.
create or replace function public.mon_detect_amaall_native_location_regressed()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  v_wired boolean;
  v_total int;
  v_with_district int;
begin
  -- (A) still wired into the native resolver at all — the same check the repair migration
  -- self-asserted at apply time, now standing.
  select position('amaall_residential_listings.city_ar' in
    pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) > 0
    into v_wired;

  if not v_wired then
    n := n + public.mon_raise('P1', 'amaall_native_location_regressed', 'amaall',
      'amaall_native_location_regressed:wiring',
      jsonb_build_object(
        'why', 'amaall was removed from listing_native_location_v1 — every amaall row has fallen '
            || 'back through v2''s catch-all union, which hardcodes district_ar to NULL. An exact '
            || 'district search for amaall will find nothing; only a broad city scan still works. '
            || 'See migration 20260911195109_amaall_native_location_wiring_and_exact_district_search.sql '
            || 'for the fix to re-apply.'));
  else
    perform public.mon_resolve_key('amaall_native_location_regressed', 'amaall_native_location_regressed:wiring');
  end if;

  -- (B) the scraper is still populating district_ar for a healthy share of amaall's active listings.
  -- Threshold and minimum sample deliberately loose (this is not a coverage-quality detector, only a
  -- "did the field go back to all-NULL" one) — 50% / 10 rows is far below the ~85% measured live the
  -- day this shipped, so it fires on a genuine regression, not on ordinary listing-mix variance.
  select count(*), count(*) filter (where district_ar is not null)
    into v_total, v_with_district
    from public.amaall_residential_listings where active;

  if v_total >= 10 and v_with_district::numeric / v_total < 0.5 then
    n := n + public.mon_raise('P2', 'amaall_native_location_regressed', 'amaall',
      'amaall_native_location_regressed:district_coverage',
      jsonb_build_object(
        'total', v_total, 'with_district', v_with_district,
        'why', 'amaall district_ar coverage dropped below 50% of active residential listings. The '
            || 'scraper likely stopped writing it — check that the `property_area` WP taxonomy term '
            || 'still resolves (scrapers/amaall/run.py, PR #2277) rather than assuming the source '
            || 'stopped publishing a district; that was the original, wrong diagnosis this session '
            || 'made before checking the taxonomy directly.'));
  else
    perform public.mon_resolve_key('amaall_native_location_regressed', 'amaall_native_location_regressed:district_coverage');
  end if;

  return n;
end $function$;

comment on function public.mon_detect_amaall_native_location_regressed() is
  'Watches the 20260911195109 amaall native-location repair: (A) amaall stays wired into '
  'listing_native_location_v1, (B) district_ar coverage on active amaall residential listings '
  'does not collapse back toward all-NULL. P1/P2, on the mon_run_all_detectors() roster.';

-- ROSTER — needle-edited, never rebuilt from a remembered body (same pattern as every prior
-- companion; see 20260906021124 for the worked example this follows).
do $mig$
declare def text;
  anchor constant text := '''mon_detect_area_contradicts_capture''';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'mon_run_all_detectors';
  if def is null then
    raise exception 'mon_run_all_detectors() is missing — refusing to invent a roster';
  end if;
  if position('mon_detect_amaall_native_location_regressed' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor is not unique — refusing to needle-edit blindly';
  end if;
  def := replace(def, anchor, anchor || ',' || chr(10) || '    ''mon_detect_amaall_native_location_regressed''');
  execute def;
end $mig$;

-- Proves the detector is reachable and currently green, in the same migration that creates it.
do $verify$
declare v_raised int;
begin
  select public.mon_detect_amaall_native_location_regressed() into v_raised;
  if v_raised <> 0 then
    raise exception 'mon_detect_amaall_native_location_regressed() raised % immediately after the '
      'repair it is meant to confirm — the repair is not actually holding', v_raised;
  end if;
end
$verify$;
