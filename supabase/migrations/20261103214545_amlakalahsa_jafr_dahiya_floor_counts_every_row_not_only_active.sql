-- amlakalahsa_jafr_dahiya_merge_regressed:population_floor (open since 2026-09-15) was a false alarm. The floor counted only
-- ACTIVE الجفر rows with district «الضاحية», so a listing that left the source and was deactivated by the normal strike path
-- read as a lost merge. Measured 2026-11-03: 28 active + 5 inactive (deactivated 2026-10-29, missing_count 3) = 33 rows, every
-- one still «الضاحية» — no row lost its merge. The question the limb asks («was district_ar blanked or changed instead of
-- staying merged?») is about the district, not about liveness, so it now counts every row that carries the merged value,
-- active or not. Limbs A (no active «الضاحية <suffix>» in the base table) and B (none in the index) are unchanged.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.mon_detect_amlakalahsa_jafr_dahiya_merge_regressed'::regproc);
  if (length(d) - length(replace(d, E'where active and city_ar = ''الجفر'' and district_ar = ''الضاحية'';', ''))) / length(E'where active and city_ar = ''الجفر'' and district_ar = ''الضاحية'';') <> 1 then
    raise exception 'floor needle not found exactly once';
  end if;
  n := replace(d, E'where active and city_ar = ''الجفر'' and district_ar = ''الضاحية'';',
                  E'where city_ar = ''الجفر'' and district_ar = ''الضاحية'';  -- active or not: a deactivation is not a lost merge');
  n := replace(n, E'''only '' || v_base_merged || '' active الجفر row(s) carry', E'''only '' || v_base_merged || '' الجفر row(s) (active or not) carry');
  execute n;
end $$;

select public.mon_detect_amlakalahsa_jafr_dahiya_merge_regressed();
