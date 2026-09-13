-- Extends mon_detect_amlakalahsa_district_consolidation_regressed() (2026-09-13, no new function
-- needed) to also watch the 2 resolutions from
-- 20260913190703_amlakalahsa_jasha_and_marouj_janoubi_resolved.sql: "الجشة" added to the existing
-- no_city district list (generalizable — bare "الجشة" always means its own city), plus a new,
-- separate id-scoped check for listing 11606266 (the "المروج" -> "حي المروج الجنوبي" fact is
-- proven only for THAT listing's own text, so it gets its own check, not a district-text entry that
-- would wrongly watch every other unrelated "المروج" row).
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
  v_reverted_marouj_janoubi int;
begin
  select count(*) into v_reverted_no_city
  from public.amlakalahsa_residential_listings
  where active and city_ar is null
    and district_ar in ('شرق شرق الحديقة', 'اليمامة', 'الطرف', 'بستان المطيرفي', 'الجابرية',
                         'البستنان', 'الرابية بالعيون', 'الصفا', 'الصفا 2', 'الغسانية',
                         'النور', 'العقير', 'الجرن', 'الرياض', 'الجشة');

  if v_reverted_no_city > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_district_consolidation_regressed', 'amlakalahsa',
      'amlakalahsa_district_consolidation_regressed:no_city',
      jsonb_build_object('reverted', v_reverted_no_city,
        'why', v_reverted_no_city || ' active row(s) are back to a NULL city on a district name '
            || 'that was explicitly resolved 2026-09-13 — a re-scrape likely overwrote the fix. '
            || 'See migrations 20260913174942_amlakalahsa_confirmed_city_fixes_and_number_strip.sql '
            || 'and 20260913182357_amlakalahsa_final_three_districts_get_broad_city.sql.'));
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

  select count(*) into v_reverted_marouj_janoubi
  from public.amlakalahsa_residential_listings
  where active and id = 11606266 and city_ar is null;

  if v_reverted_marouj_janoubi > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_district_consolidation_regressed', 'amlakalahsa',
      'amlakalahsa_district_consolidation_regressed:marouj_janoubi',
      jsonb_build_object('reverted', v_reverted_marouj_janoubi,
        'why', 'listing 11606266 is back to a NULL city — it was explicitly resolved to الهفوف '
            || '2026-09-13 from its own description (\"حي المروج الجنوبي\") after its district field '
            || 'truncated to bare \"المروج\". See 20260913190703_amlakalahsa_jasha_and_marouj_janoubi_resolved.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_district_consolidation_regressed', 'amlakalahsa_district_consolidation_regressed:marouj_janoubi');
  end if;

  return n;
end $function$;

do $verify$
declare
  raised int;
begin
  select public.mon_detect_amlakalahsa_district_consolidation_regressed() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_amlakalahsa_district_consolidation_regressed raised % alert(s) immediately after its own fix', raised;
  end if;
end $verify$;