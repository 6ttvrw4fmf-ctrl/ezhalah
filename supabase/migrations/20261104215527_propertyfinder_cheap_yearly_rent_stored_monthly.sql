-- OWNER 2026-11-04: a Property Finder RESIDENTIAL rent labelled «yearly» at a per-month-sized figure is a MONTHLY price.
-- Stored the fleet's monthly way: rent_period = 'monthly', price_annual = the source figure × 12 (the app shows
-- «السعر المعلن N شهرياً»). Band = the fleet's cheap-yearly / silent-period rule: 300 <= figure < 8,000 (below 300 is a
-- placeholder, left as published). scrapers/propertyfinder/run.py applies the same rule on every crawl, so the daily
-- crawl keeps it. Evidence: PF's own figure stays in price_evidence.raw, its own word in source_period, and the
-- judgment is flagged (judged_monthly + judged_by). Commercial rows (the Riyadh offices, 500–1,000 «yearly» on
-- 9,000–10,829 m²) are NOT touched: the owner has not decided them.
do $fix$
declare v_n int;
begin
  update public.propertyfinder_residential_listings x
     set rent_period = 'monthly',
         price_annual = (x.source_capture->'price_evidence'->>'raw')::numeric * 12,
         source_capture = jsonb_set(x.source_capture, '{price_evidence}',
           (x.source_capture->'price_evidence') || jsonb_build_object(
             'kind', 'monthly',
             'stored', (x.source_capture->'price_evidence'->>'raw')::numeric * 12,
             'source_period', 'yearly',
             'judged_monthly', true,
             'judged_by', 'owner 2026-11-04: PF «yearly» residential rent 300–7,999 = monthly ×12'))
   where x.transaction_type = 'Rent'
     and x.rent_period = 'annual'
     and x.source_capture->'item'->'price'->>'period' = 'yearly'
     and (x.source_capture->'price_evidence'->>'raw') ~ '^[0-9]+(\.[0-9]+)?$'
     and (x.source_capture->'price_evidence'->>'raw')::numeric >= 300
     and (x.source_capture->'price_evidence'->>'raw')::numeric < 8000
     and x.price_annual = (x.source_capture->'price_evidence'->>'raw')::numeric;
  get diagnostics v_n = row_count;
  if v_n > 20 then
    raise exception 'would re-store % rows, expected the 12 measured 2026-11-04 - re-measure before applying', v_n;
  end if;
  raise notice 'Property Finder: % residential «yearly» rents under 8,000 stored monthly ×12', v_n;
end
$fix$;

do $verify$
begin
  if exists (select 1 from public.propertyfinder_residential_listings
              where transaction_type = 'Rent' and rent_period = 'annual' and price_annual >= 300 and price_annual < 8000) then
    raise exception 'a residential «yearly» rent under 8,000 is still stored as annual';
  end if;
  if exists (select 1 from public.propertyfinder_commercial_listings
              where (source_capture->'price_evidence'->>'judged_monthly') is not null) then
    raise exception 'a commercial row was touched - the owner has not decided those';
  end if;
end $verify$;