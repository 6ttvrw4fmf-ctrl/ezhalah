-- Companion detector for 20260913035126_amlakalahsa_backfill_direction_and_price_per_meter.sql
-- (the direction/price-per-meter backfill applied moments earlier). Same shape as
-- mon_detect_remal_native_location_regressed / mon_detect_amaall_native_location_regressed: the
-- backfill proved the invariant held for one instant; only a standing detector proves it still
-- holds if scrapers/amlakalahsa/run.py is ever rewritten and silently stops reading pw-front /
-- pw-prc-mtr again (the exact bug this backfill just corrected).
CREATE OR REPLACE FUNCTION public.mon_detect_amlakalahsa_direction_ppm_regressed()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_front_missed int;
  v_ppm_missed int;
begin
  -- direction: any active row whose source_capture still carries a clean single-element pw-front
  -- array but whose direction column is NULL means the scraper stopped reading that key.
  select count(*) into v_front_missed
  from public.amlakalahsa_residential_listings
  where active
    and jsonb_typeof(source_capture->'pw-front') = 'array'
    and jsonb_array_length(source_capture->'pw-front') = 1
    and direction is null;

  if v_front_missed > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_direction_ppm_regressed', 'amlakalahsa',
      'amlakalahsa_direction_ppm_regressed:direction',
      jsonb_build_object('missed', v_front_missed,
        'why', 'source_capture->pw-front carries a real single-element direction but the '
            || 'direction column is NULL on ' || v_front_missed || ' active row(s) — '
            || 'scrapers/amlakalahsa/run.py has stopped reading pw-front. See migration '
            || '20260913035126_amlakalahsa_backfill_direction_and_price_per_meter.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_direction_ppm_regressed', 'amlakalahsa_direction_ppm_regressed:direction');
  end if;

  -- price_per_meter: same shape, for pw-prc-mtr. Only a clean POSITIVE integer counts as a real
  -- value — a raw negative ACF "not set" sentinel (e.g. "-2") is a genuine absence, never a
  -- regression signal.
  select count(*) into v_ppm_missed
  from public.amlakalahsa_residential_listings
  where active
    and (source_capture->>'pw-prc-mtr') ~ '^[0-9]+$'
    and (source_capture->>'pw-prc-mtr')::int > 0
    and price_per_meter is null;

  if v_ppm_missed > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_direction_ppm_regressed', 'amlakalahsa',
      'amlakalahsa_direction_ppm_regressed:price_per_meter',
      jsonb_build_object('missed', v_ppm_missed,
        'why', 'source_capture->pw-prc-mtr carries a real positive per-meter price but the '
            || 'price_per_meter column is NULL on ' || v_ppm_missed || ' active row(s) — the '
            || 'scraper has stopped reading pw-prc-mtr, or started trusting its negative '
            || '"not set" sentinel. See migration '
            || '20260913035126_amlakalahsa_backfill_direction_and_price_per_meter.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_direction_ppm_regressed', 'amlakalahsa_direction_ppm_regressed:price_per_meter');
  end if;

  return n;
end $function$;

-- Needle-edit into the mon_run_all_detectors() roster: anchor on the exact live tail text so a
-- concurrent session's own roster addition (this repo runs 4+ concurrent sessions) fails LOUDLY
-- via the exception below instead of being silently clobbered by a hand-retyped full function body.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_district_identity_split'
  ];$q$,
    $q$'mon_detect_district_identity_split',
    'mon_detect_amlakalahsa_direction_ppm_regressed'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it green in-migration: the backfill just ran, so both counts must be zero right now.
do $verify$
declare
  raised int;
begin
  select public.mon_detect_amlakalahsa_direction_ppm_regressed() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_amlakalahsa_direction_ppm_regressed raised % alert(s) immediately after its own backfill — the backfill or the detector logic disagrees with itself', raised;
  end if;
end $verify$;