-- aqar 8982174 — price_total (200000 SAR) exactly equals area_m2 (200000 m²), which is the
-- area/ppm-as-price parser-artifact signature from the 55-row incident of 2026-08-10.
--
-- Adjudicated against the LIVE source on 2026-08-22 (HTTP 200, 232778 bytes):
--   sa.aqar.fm/…-6533740 publishes  "price":200000  with  "priceCurrency":"SAR"
--   and displays the area as 200,000م² («المساحة حسب الصك»), matching deed_area_m2 = 200000.
-- Both figures really are 200000. The equality is a coincidence, not a parser copying one field
-- into the other, so the price is SOURCE-REAL and must NOT be nulled. Weird is not wrong.
--
-- Registering the evidence is what stops the barrier re-reporting a non-defect; it does not
-- weaken the barrier, which still fires on any NEW unverified row.
insert into public.ops_price_eq_area_verified
  (source_table, listing_id, evidence, verified_price_total, verified_area_m2)
values (
  'aqar_residential_listings', 8982174,
  'Live source probe 2026-08-22: HTTP 200 from sa.aqar.fm listing 6533740; page JSON carries '
  || '"price":200000 with "priceCurrency":"SAR"; area displayed as 200,000م² (المساحة حسب الصك) '
  || 'and deed_area_m2=200000 agrees. price==area is a genuine coincidence; price is source-real.',
  200000, 200000)
on conflict (source_table, listing_id) do nothing;

do $$
declare v_left int;
begin
  select count(*) into v_left
  from public.search_listings_ar s
  where s.production_ready and s.deal_ar = 'بيع' and s.price_total is not null
    and (s.price_total = s.area_m2 or s.price_total = s.price_per_meter)
    and not exists (select 1 from public.ops_price_eq_area_verified v
                    where v.source_table = s.source_table and v.listing_id = s.listing_id);
  if v_left <> 0 then
    raise exception 'expected 0 unverified price_eq_area rows after this insert, found %', v_left;
  end if;
end $$;
