-- Companion detector for 20260914181618_rakez_off_plan_units_are_not_listings.sql.
--
-- That migration deactivated 99 «البيع على الخارطة» (off-plan) units and scrapers/rakez/run.py
-- gained a veto so they are never upserted again. The migration proved the invariant for one
-- instant; only a standing detector proves it still holds if that veto is ever refactored away —
-- and an upsert is exactly the thing that flips `active` back to true, so a broken veto resurrects
-- these rows silently, with no other symptom.
--
-- SCOPE, stated rather than implied: this watches the 13 project ids known to carry the off-plan
-- tag on 2026-09-14. That is the right scope for a REGRESSION detector — if the veto breaks, these
-- are the projects that come back. It deliberately does NOT try to catch a project rakez tags
-- off-plan in the future: the veto means such units are never stored at all, so there would be no
-- row here to find. Detecting THAT would need a source probe, not a table query.
CREATE OR REPLACE FUNCTION public.mon_detect_rakez_off_plan_resurrection()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_back int;
  off_plan constant int[] := array[67008, 63096, 66852, 38262, 45815, 35131, 32260,
                                   29683, 29937, 29328, 24426, 17160, 16055];
begin
  select (select count(*) from public.rakez_residential_listings
           where active and (additional_info->>'project_id')::int = any(off_plan))
       + (select count(*) from public.rakez_commercial_listings
           where active and (additional_info->>'project_id')::int = any(off_plan))
    into v_back;

  if v_back > 0 then
    n := n + public.mon_raise('P2', 'rakez_off_plan_resurrection', 'rakez',
      'rakez_off_plan_resurrection:active',
      jsonb_build_object('active_off_plan', v_back,
        'why', v_back || ' active rakez listing(s) belong to a project tagged «البيع على الخارطة» '
            || '(off-plan — sold before it is built). The only thing that sets active back to true '
            || 'is an upsert, so the OFFER_GROUP_EXCLUDED veto in scrapers/rakez/run.py has stopped '
            || 'firing. Owner decision 2026-09-14: these are not listings we show. See migration '
            || '20260914181618_rakez_off_plan_units_are_not_listings.sql.'));
  else
    perform public.mon_resolve_key('rakez_off_plan_resurrection', 'rakez_off_plan_resurrection:active');
  end if;

  return n;
end $function$;

-- Needle-edit into the mon_run_all_detectors() roster: anchor on the exact live tail so a
-- concurrent session's own roster addition fails LOUDLY rather than being silently clobbered.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_amlakalahsa_district_consolidation_regressed'
  ];$q$,
    $q$'mon_detect_amlakalahsa_district_consolidation_regressed',
    'mon_detect_rakez_off_plan_resurrection'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it green in-migration, and prove it can actually FIRE — a detector nobody has watched go
-- red is decoration. The negative case is exercised against a project id that IS off-plan, by
-- counting with the row's own predicate over the deactivated rows the repair produced.
do $verify$
declare
  raised int;
  would_fire int;
begin
  select public.mon_detect_rakez_off_plan_resurrection() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_rakez_off_plan_resurrection raised % alert(s) immediately after its own repair', raised;
  end if;

  -- MUTATION-IN-MIGRATION: flip `active` off the predicate and the same query must find the 99.
  select count(*) into would_fire
    from public.rakez_residential_listings
   where (additional_info->>'project_id')::int = any(array[67008, 63096, 66852, 38262, 45815,
          35131, 32260, 29683, 29937, 29328, 24426, 17160, 16055]);
  if would_fire = 0 then
    raise exception 'the detector predicate matches NOTHING at all — it would be green forever';
  end if;
end $verify$;