-- TWO MORE LAYERS on top of migration 20260911201716 (public.district_ar_looks_bogus +
-- refresh_loc_canonical_district's WHERE-clause exclusion). Owner, 2026-09-11: "we never want it
-- happening [again], add as many barriers." The original fix stops the pollution; these two make it
-- structurally hard for the fix ITSELF to regress unnoticed.
--
-- LAYER — SELF-CHECK. refresh_loc_canonical_district() now asserts, immediately after its own
-- INSERT, that zero 'live'-source rows satisfy district_ar_looks_bogus(). This is a pure internal
-- consistency check, not a new data-quality gate: every row it inserts already passed through the
-- SAME WHERE-clause exclusion, so this assertion can only ever fire if a FUTURE edit to this
-- function's WHERE clause drops or weakens that exclusion while district_ar_looks_bogus() itself
-- stays intact — exactly the regression class this exists to catch. It cannot be tripped by new or
-- unusual scraped data, because that data is filtered before this check ever runs. On violation the
-- refresh ABORTS (raise exception rolls back the whole batch): the catalog stays at its last-good
-- state and the nightly job fails loudly, rather than quietly shipping the exact bug back into the
-- dropdown for someone to notice days later.
--
-- LAYER — STANDING DETECTOR. mon_detect_district_catalog_pollution() is the continuous, first-class
-- half: wired into mon_run_all_detectors()'s roster (runs on the existing twice-hourly sweep, no new
-- schedule to maintain), it independently re-counts bogus-shaped 'live' rows and raises P2 through
-- the SAME alert_event -> alert-dispatch.yml -> GitHub-issue pipeline every other production defect
-- in this repo already reaches a human through — not a bespoke, easy-to-forget side channel.
CREATE OR REPLACE FUNCTION public.refresh_loc_canonical_district()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare n bigint; v_bogus_live int;
begin
  truncate public.loc_canonical_district;
  insert into public.loc_canonical_district (city_id, district_norm, canonical_district_ar, source, refreshed_at)
  with cat as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 0 as pref, 1::bigint cnt
    from public.loc_catalog_district
    where district_ar is not null and btrim(district_ar) <> ''
  ),
  liv as (
    select city_id, norm_district_tok(district_ar) k, district_ar sp, 1 as pref, count(*)::bigint cnt
    from public.search_listings_ar
    where production_ready and district_ar is not null and btrim(district_ar) <> ''
      and district_ar not in ('غير محدد','اخرى','أخرى')
      and not public.district_ar_looks_bogus(district_ar)
    group by 1,2,3
  ),
  allrows as (select * from cat union all select * from liv),
  ranked as (
    select city_id, k, sp, pref,
      row_number() over (partition by city_id, k order by pref asc, cnt desc, length(sp) asc, sp asc) rn
    from allrows
    where k is not null and k <> ''
  )
  select city_id, k, sp, case when pref = 0 then 'catalog' else 'live' end, now()
  from ranked where rn = 1;
  get diagnostics n = row_count;

  -- SELF-CHECK (see header): can only fire if a future edit weakens the WHERE clause above while
  -- district_ar_looks_bogus() itself stays intact. Fails the WHOLE refresh loudly rather than
  -- silently reintroducing internal codes into the dropdown.
  select count(*) into v_bogus_live
    from public.loc_canonical_district
   where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar);
  if v_bogus_live > 0 then
    raise exception 'refresh_loc_canonical_district: % bogus-shaped ''live'' row(s) survived the '
      'district_ar_looks_bogus() exclusion — the WHERE clause was weakened. Refusing to publish a '
      'catalog that re-leaks internal plan/parcel codes (see migration 20260911201716).', v_bogus_live;
  end if;

  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mon_detect_district_catalog_pollution()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_bogus int;
  v_sample text;
begin
  select count(*), string_agg(canonical_district_ar, ', ' order by canonical_district_ar)
    into v_bogus, v_sample
    from (
      select canonical_district_ar
        from public.loc_canonical_district
       where source = 'live' and public.district_ar_looks_bogus(canonical_district_ar)
       order by canonical_district_ar limit 10
    ) s;

  if v_bogus > 0 then
    n := n + public.mon_raise('P2', 'district_catalog_pollution', 'location',
      'district_catalog_pollution:internal_codes',
      jsonb_build_object(
        'bogus_row_count', v_bogus, 'sample', v_sample,
        'why', 'loc_canonical_district holds a ''live''-source district name shaped like an '
            || 'internal plan/parcel code or leaked listing text, not a real place — the exact class '
            || 'of Advanced Filter district-dropdown pollution the owner reported 2026-09-11 '
            || '(الخبر الحمراء 3537). refresh_loc_canonical_district() already excludes these via '
            || 'district_ar_looks_bogus(); this firing means either that function was bypassed for a '
            || 'direct write, or the exclusion itself was weakened without going through the '
            || 'self-check inside refresh_loc_canonical_district() (migration 20260911211255). Re-run '
            || 'select public.refresh_loc_canonical_district(); — if THAT also fails loudly, the '
            || 'WHERE clause is the thing to fix, not the data.'));
  else
    perform public.mon_resolve_key('district_catalog_pollution', 'district_catalog_pollution:internal_codes');
  end if;

  return n;
end $function$;

COMMENT ON FUNCTION public.mon_detect_district_catalog_pollution() IS
  'Watches loc_canonical_district for internal plan/parcel codes leaking in as districts (owner '
  'report 2026-09-11, migration 20260911201716). P2, on the mon_run_all_detectors() roster.';

-- ROSTER — needle-edited, never rebuilt from a remembered body.
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
  if position('mon_detect_district_catalog_pollution' in def) > 0 then
    return; -- idempotent
  end if;
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor is not unique — refusing to needle-edit blindly';
  end if;
  def := replace(def, anchor, anchor || ',' || chr(10) || '    ''mon_detect_district_catalog_pollution''');
  execute def;
end $mig$;

-- Proves BOTH new layers are reachable and currently green, in the same migration that creates them.
do $verify$
declare v_raised int; v_refresh_ok boolean := true;
begin
  begin
    perform public.refresh_loc_canonical_district();
  exception when others then
    v_refresh_ok := false;
    raise exception 'refresh_loc_canonical_district() self-check FAILED immediately after this '
      'migration — the catalog currently holds a bogus-shaped live row. Investigate before this '
      'migration is considered applied: %', sqlerrm;
  end;

  select public.mon_detect_district_catalog_pollution() into v_raised;
  if v_raised <> 0 then
    raise exception 'mon_detect_district_catalog_pollution() raised % immediately after the fix it '
      'is meant to confirm — the fix is not actually holding', v_raised;
  end if;
end
$verify$;