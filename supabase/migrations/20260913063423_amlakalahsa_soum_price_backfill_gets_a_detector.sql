-- Companion detector for the pw-prc=0 -> NULL backfill applied moments earlier (repaired twice:
-- once, then a concurrent scrape run — from the newly-scheduled small-sources-sync workflow,
-- PR #2489 — re-wrote all 18 rows back to 0 using the STILL-UNFIXED main branch before this PR's
-- scraper fix could land, proving the regression live). Same shape as the direction/price-per-
-- meter and description detectors: the backfill proved the invariant held for one instant; only a
-- standing detector proves it still holds once the fixed scraper code is the one actually running.
CREATE OR REPLACE FUNCTION public.mon_detect_amlakalahsa_soum_price_regressed()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_bad int;
begin
  -- Any active row whose source_capture still carries the literal "على السوم" sentinel
  -- (source_capture->>'pw-prc' = '0') but whose price_total is NOT null means the scraper started
  -- storing that sentinel as a real price again — the exact regression this backfill corrected.
  select count(*) into v_bad
  from public.amlakalahsa_residential_listings
  where active
    and source_capture->>'pw-prc' = '0'
    and price_total is not null;

  if v_bad > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_soum_price_regressed', 'amlakalahsa',
      'amlakalahsa_soum_price_regressed',
      jsonb_build_object('bad', v_bad,
        'why', 'source_capture->pw-prc is the literal "على السوم" (price-on-request) sentinel '
            || '"0" on ' || v_bad || ' active row(s), but price_total is not NULL — '
            || 'scrapers/amlakalahsa/run.py has started storing that sentinel as a real price '
            || 'again. See migration 20260913_amlakalahsa_backfill_soum_price_sentinel.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_soum_price_regressed', 'amlakalahsa_soum_price_regressed');
  end if;

  return n;
end $function$;

-- Needle-edit into the mon_run_all_detectors() roster: anchor on the exact live tail text so a
-- concurrent session's own roster addition fails LOUDLY instead of being silently clobbered.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_aqar_ppm_prefilter_lossless'
  ];$q$,
    $q$'mon_detect_aqar_ppm_prefilter_lossless',
    'mon_detect_amlakalahsa_soum_price_regressed'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it green in-migration: the backfill just ran, so the count must be zero right now.
do $verify$
declare
  raised int;
begin
  select public.mon_detect_amlakalahsa_soum_price_regressed() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_amlakalahsa_soum_price_regressed raised % alert(s) immediately after its own backfill', raised;
  end if;
end $verify$;