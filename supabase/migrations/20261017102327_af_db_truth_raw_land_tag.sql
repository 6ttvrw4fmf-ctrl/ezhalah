-- 🔬 AF engineer 2026-10-17: the independent DB truth of mon af_chip_vs_db_truth learns the raw-land TAG.
-- «أرض خام» is not a type_ar: raw lands are tagged unit_subtype_ar = 'أرض خام' and the p_types token
-- 'أرض خام' matches that tag in af_eligibility_clause (migration 20261009235607). This predicate still read
-- s.type_ar = 'أرض خام', so every Raw Land Buy cell read db_truth 0 against correct chips (alert 9687:
-- street width 20+ chip 92, tag count 92; north chip 19, tag count 19). Only the type clause changes.
CREATE OR REPLACE FUNCTION public.ops_af_cohort_predicate_sql(p_deal text, p_period text, p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select format(
    $p$ s.deal_ar = %L and (s.type_ar = %L or (%L = 'أرض خام' and s.unit_subtype_ar = 'أرض خام'))
        and (s.production_ready or s.city_id is null or s.region_id is null)
        and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
        and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
        and (%L::text is null or s.deal_ar <> 'إيجار'
             or (s.price_annual is null and %L::text in ('شهري','سنوي'))
             or (%L::text = 'شهري' and s.rent_period_ar = 'شهري' and not coalesce(s.rent_now_pay_later, false))
             or (%L::text = 'سنوي' and (s.rent_period_ar = 'سنوي'
                                        or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))) $p$,
    p_deal, p_type, p_type, p_period, p_period, p_period, p_period);
$function$;