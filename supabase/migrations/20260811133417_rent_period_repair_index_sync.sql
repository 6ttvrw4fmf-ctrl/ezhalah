-- Index-sync leg of the 2026-08-11 rent-period repair: sync_search_listings_ar() is watermark-gated
-- on scrape recency, so the raw-layer retractions (migration rent_period_source_truth_retractions)
-- did not propagate. This pushes the SAME values into search_listings_ar for exactly the rows where
-- raw and index now disagree on period/annual-price, platform-scoped to the repaired platforms.
do $$
declare
  p text; v_tbl text; v_n int; v_total int := 0;
begin
  foreach p in array array['raghdan','alkhaas','sadin','hajer','ramzalqasim','jurash','mizlaj',
                           'abeea','aldarim','alhoshan','souq24','eastabha','dealapp','aqarcity'] loop
    foreach v_tbl in array array[p||'_residential_listings', p||'_commercial_listings'] loop
      if to_regclass('public.'||v_tbl) is not null then
        execute format($q$
          update public.search_listings_ar s
             set rent_period_ar = case r.rent_period when 'annual' then 'سنوي'
                                                     when 'monthly' then 'شهري' else null end,
                 price_annual   = r.price_annual,
                 payment_monthly = coalesce(r.rent_period = 'monthly', false)
            from public.%I r
           where s.platform = %L and s.listing_id = r.id and s.deal_ar = 'إيجار'
             and (s.rent_period_ar is distinct from case r.rent_period when 'annual' then 'سنوي'
                                                    when 'monthly' then 'شهري' else null end
                  or s.price_annual is distinct from r.price_annual)$q$, v_tbl, p);
        get diagnostics v_n = row_count; v_total := v_total + v_n;
      end if;
    end loop;
  end loop;
  raise notice 'index rows re-synced: %', v_total;
  if v_total < 150 then
    raise exception 'expected ~200 index re-syncs, got % — investigate before trusting the repair', v_total;
  end if;
end $$;
