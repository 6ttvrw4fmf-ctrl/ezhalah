-- Companion detector for 20260913041500-ish_amlakalahsa_backfill_description.sql (the description
-- backfill applied moments earlier). Every one of 262 active residential rows has real content —
-- a WordPress post cannot exist without SOME block content, and empirically every sampled/backfilled
-- row confirms it (100% coverage, unlike direction/price_per_meter which the source genuinely omits
-- on most rows) — so unlike mon_detect_amlakalahsa_direction_ppm_regressed(), no source_capture
-- cross-check is needed: an active row with a NULL description is ALWAYS a regression.
CREATE OR REPLACE FUNCTION public.mon_detect_amlakalahsa_description_regressed()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_missed int;
begin
  select count(*) into v_missed
  from public.amlakalahsa_residential_listings
  where active and description is null;

  if v_missed > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_description_regressed', 'amlakalahsa',
      'amlakalahsa_description_regressed',
      jsonb_build_object('missed', v_missed,
        'why', 'every amlakalahsa post has real content.rendered (100% coverage measured '
            || '2026-09-13) — description is NULL on ' || v_missed || ' active row(s), meaning '
            || 'scrapers/amlakalahsa/run.py has stopped reading content.rendered. See migration '
            || 'amlakalahsa_backfill_description.'));
  else
    perform public.mon_resolve_key('amlakalahsa_description_regressed', 'amlakalahsa_description_regressed');
  end if;

  return n;
end $function$;

do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_amlakalahsa_direction_ppm_regressed'
  ];$q$,
    $q$'mon_detect_amlakalahsa_direction_ppm_regressed',
    'mon_detect_amlakalahsa_description_regressed'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

do $verify$
declare
  raised int;
begin
  select public.mon_detect_amlakalahsa_description_regressed() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_amlakalahsa_description_regressed raised % alert(s) immediately after its own backfill', raised;
  end if;
end $verify$;