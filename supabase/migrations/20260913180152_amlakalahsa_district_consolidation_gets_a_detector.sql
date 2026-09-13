-- Companion detector for 20260913174942_amlakalahsa_confirmed_city_fixes_and_number_strip.sql and
-- 20260913175242_amlakalahsa_ayoun_safa2_number_strip_missed_row.sql. The scraper itself was not
-- changed (it still writes whatever raw text the office publishes), so if any of these listings get
-- RE-SCRAPED, the ordinary upsert path would silently overwrite district_ar back to the raw
-- numbered/no-city form the office actually typed — reverting today's fix without anyone noticing.
-- Watches for the OLD (pre-fix) shapes reappearing: a null city_ar on one of the 10 now-resolved
-- district names, or any of the 5 known numbered forms we folded into their bare name.
CREATE OR REPLACE FUNCTION public.mon_detect_amlakalahsa_district_consolidation_regressed()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_reverted_no_city int;
  v_reverted_numbered int;
begin
  select count(*) into v_reverted_no_city
  from public.amlakalahsa_residential_listings
  where active and city_ar is null
    and district_ar in ('شرق شرق الحديقة', 'اليمامة', 'الطرف', 'بستان المطيرفي', 'الجابرية',
                         'البستنان', 'الرابية بالعيون', 'الصفا', 'الصفا 2', 'الغسانية');

  if v_reverted_no_city > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_district_consolidation_regressed', 'amlakalahsa',
      'amlakalahsa_district_consolidation_regressed:no_city',
      jsonb_build_object('reverted', v_reverted_no_city,
        'why', v_reverted_no_city || ' active row(s) are back to a NULL city on a district name '
            || 'that was explicitly resolved 2026-09-13 — a re-scrape likely overwrote the fix. '
            || 'See migration 20260913174942_amlakalahsa_confirmed_city_fixes_and_number_strip.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_district_consolidation_regressed', 'amlakalahsa_district_consolidation_regressed:no_city');
  end if;

  select count(*) into v_reverted_numbered
  from public.amlakalahsa_residential_listings
  where active and district_ar in ('النسيم 2', 'النسيم 3', 'المزروع 2', 'المباركية 3', 'الغسانية 2');

  if v_reverted_numbered > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_district_consolidation_regressed', 'amlakalahsa',
      'amlakalahsa_district_consolidation_regressed:numbered',
      jsonb_build_object('reverted', v_reverted_numbered,
        'why', v_reverted_numbered || ' active row(s) reverted to a numbered district variant '
            || '(e.g. "النسيم 2") that was folded into its bare name 2026-09-13 — a re-scrape '
            || 'likely overwrote the fix. See the same migration.'));
  else
    perform public.mon_resolve_key('amlakalahsa_district_consolidation_regressed', 'amlakalahsa_district_consolidation_regressed:numbered');
  end if;

  return n;
end $function$;

-- Needle-edit into the mon_run_all_detectors() roster, anchored on the live tail.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_cron_timeout_headroom'
  ];$q$,
    $q$'mon_detect_cron_timeout_headroom',
    'mon_detect_amlakalahsa_district_consolidation_regressed'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it green in-migration.
do $verify$
declare
  raised int;
begin
  select public.mon_detect_amlakalahsa_district_consolidation_regressed() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_amlakalahsa_district_consolidation_regressed raised % alert(s) immediately after its own fix', raised;
  end if;
end $verify$;