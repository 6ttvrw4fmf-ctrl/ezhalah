-- P1 rent_period_source_mismatch (alert 489, 2026-08-13 00:59) — ONE wasalt row, repaired to source.
-- Senior Production Engineer run #15.
--
-- wasalt 4334897 was stored rent_period='monthly', price_annual=66,000 while wasalt publishes,
-- in three mutually corroborating fields on the SAME captured payload:
--
--   ar_data.propertyInfo.rentFreq   = {"yearly": {"freq":"yearly","amount":60000,
--                                                 "default_freq":true,"enCurrencyType":"SAR"}}
--                                     -- «yearly» is the ONLY key present; there is no monthly entry
--                                     -- at all, so this is not a choose-your-plan ad.
--   ar_data.propertyInfo.expectedRent     = 60000
--   ar_data.propertyInfo.expectedRentType = «/سنة»  (per year)
--
-- The stored 66,000 corresponds to 5,500 x 12, and 5,500 appears NOWHERE in the payload — so the
-- served figure was neither published nor derivable from what wasalt publishes, and it was being
-- served under the MONTHLY chip at 10% above the real annual rent. Both the period and the amount
-- are wrong; the source is unambiguous on both.
--
-- NOTE on the oracle: the period is keyed on rentFreq's default_freq entry, NOT on
-- expectedRentType. That field reads «/سنة» on 391 rows whose rentFreq default is monthly and
-- carries no per-row meaning (mon_detect_rent_period_source_mismatch's own payload says so). Here
-- it merely corroborates a rentFreq that has a single yearly key.
--
-- WHY THIS REPAIR IS STABLE (run #6's one-crawl-half-life lesson). The CURRENT scraper already
-- computes exactly these values for this payload: scrapers/wasalt/run.py:248-256 takes the monthly
-- branch only when rentFreq.monthly carries BOTH default_freq and amount, and otherwise falls to
-- `elif rf_yearly.get("amount")` -> rent_price = 60000, rent_is_monthly = False -> 'annual'. So the
-- row is a pre-fix straggler, not a live defect: it is the LAST disagreeing row of 10,806
-- corroborated (mon_rent_period_source_corroboration), and the next full parse writes the same
-- values this migration writes. Repair and write path agree; no scraper change is needed or made.
--
-- Blast radius: 1 listing. No other row is touched -- the predicate pins the id AND re-derives the
-- period from that row's own rentFreq, so it is inert if the source ever changes underneath it.
do $$
declare v_n int; v_src_period text; v_src_amount numeric;
begin
  select case (select e.k from jsonb_each((ar_data->'propertyInfo')->'rentFreq') e(k,v)
                where (e.v->>'default_freq')::boolean limit 1)
           when 'yearly' then 'annual' when 'monthly' then 'monthly' else null end,
         (ar_data->'propertyInfo'->>'expectedRent')::numeric
    into v_src_period, v_src_amount
    from public.wasalt_residential_listings where id = 4334897;

  -- Refuse to write unless the source still says exactly what the audit found.
  if v_src_period is distinct from 'annual' or v_src_amount is distinct from 60000 then
    raise exception 'source no longer states annual/60000 (got %/%) -- refusing to repair',
      v_src_period, v_src_amount;
  end if;

  update public.wasalt_residential_listings
     set rent_period = 'annual', price_annual = 60000
   where id = 4334897 and transaction_type = 'Rent';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'expected exactly 1 raw row, updated %', v_n; end if;

  -- Index leg: sync_search_listings_ar() is watermark-gated on scrape recency, so a raw repair on a
  -- row the crawl has not re-parsed does not propagate on its own (cf. 20260811133417).
  update public.search_listings_ar
     set rent_period_ar = 'سنوي', price_annual = 60000, payment_monthly = false
   where platform = 'wasalt' and listing_id = 4334897 and deal_ar = 'إيجار';
  get diagnostics v_n = row_count;
  raise notice 'wasalt 4334897 repaired; index rows synced: %', v_n;
end $$;