-- 🔬 2026-11-02: the chip-vs-DB-truth oracle states the owner's 2026-10-26 price-on-request rule.
-- docs/ARCHITECTURE.md §20: a rent row with no price from any site other than Gathern / Aqar Monthly is admitted
-- under «سنوي» and «كلاهما» only, never under «إقامات قصيرة» (شهري). The oracle still let every no-price rent row
-- into شهري, so mon_detect_af_chip_vs_db_truth raised three P1 slices (alerts 12060, 12203, 12331) on chips that
-- were right. Measured on شقة|إيجار|شهري: chip bathrooms 1+ 14,089 = the Gathern + Aqar Monthly pool; old truth
-- 16,189 = 14,089 + 2,100 no-price rentals from other sites. Corrected truth: 14,089 / kitchen 6,115 / unfurnished 4,
-- equal to the chips. The oracle stays independent: it restates the documented rule, it does not call the RPC clause.
create or replace function public.ops_af_cohort_predicate_sql(p_deal text, p_period text, p_type text)
 returns text
 language sql
 immutable
as $function$
  select format(
    $p$ s.deal_ar = %L and (s.type_ar = %L or (%L = 'أرض خام' and s.unit_subtype_ar = 'أرض خام'))
        and (s.production_ready or s.city_id is null or s.region_id is null)
        and (not s.production_ready or (s.city_id is not null and s.region_id is not null))
        and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0
        and (%L::text is null or s.deal_ar <> 'إيجار'
             or (s.price_annual is null and (%L::text = 'سنوي'
                                             or (%L::text = 'شهري' and s.platform in ('gathern','aqarmonthly'))))
             or (%L::text = 'شهري' and s.rent_period_ar = 'شهري' and not coalesce(s.rent_now_pay_later, false))
             or (%L::text = 'سنوي' and (s.rent_period_ar = 'سنوي'
                                        or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))) $p$,
    p_deal, p_type, p_type, p_period, p_period, p_period, p_period, p_period);
$function$;
