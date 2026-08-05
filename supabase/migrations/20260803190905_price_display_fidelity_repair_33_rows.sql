-- 2026-08-03 price/size display-fidelity repair (owner-approved "fix those then deploy").
-- Every value below is the LIVE source-displayed figure recorded during the verification sweep
-- (agent evidence in the session scratchpad; aqarcity figures fetched from the live pages,
-- aqargate from the live page badges + payload display fields). Every UPDATE is guarded by the
-- current wrong value, so it is idempotent and cannot clobber a concurrent fix or a re-crawl.

-- 1) aqarcity ×18: rent rows stored the JSON-LD per-metre rate; the page displays the annual
--    total («الإيجار السنوي : …»). Keep the per-metre rate in its own column.
with fixes(id, old_ppm, new_annual) as (values
  (594376,20,50115),(594708,303,250278),(594049,241,200392),(2292925,32,61558),
  (593857,156,100029),(594226,244,220000),(593185,100,102750),(594225,288,250025),
  (593500,72,36000),(593526,234,150000),(593140,185,151127),(593922,140,511875),
  (593863,50,143115),(594905,66,90222),(594906,205,230551),(595063,62,50592),
  (593991,39,315000),(594609,35,31500))
update aqarcity_residential_listings t
   set price_annual = f.new_annual, price_per_meter = f.old_ppm
  from fixes f where t.id = f.id and t.price_annual = f.old_ppm;

with fixes(id, old_ppm, new_annual) as (values
  (594376,20,50115),(594708,303,250278),(594049,241,200392),(2292925,32,61558),
  (593857,156,100029),(594226,244,220000),(593185,100,102750),(594225,288,250025),
  (593500,72,36000),(593526,234,150000),(593140,185,151127),(593922,140,511875),
  (593863,50,143115),(594905,66,90222),(594906,205,230551),(595063,62,50592),
  (593991,39,315000),(594609,35,31500))
update search_listings_ar s
   set price_annual = f.new_annual
  from fixes f
 where s.source_table = 'aqarcity_residential_listings' and s.listing_id = f.id
   and s.price_annual = f.old_ppm;

-- 2) aqargate ×2: rent-land rows stored the backend's price×area derivation (landTotalAnnualRent
--    = 90,000,000); the page displays 150,000.
update aqargate_residential_listings
   set price_annual = 150000
 where id in (583516, 583517) and price_annual = 90000000;
update search_listings_ar
   set price_annual = 150000
 where source_table = 'aqargate_residential_listings' and listing_id in (583516, 583517)
   and price_annual = 90000000;

-- 3) aqargate ×4: page badge rounds half-up; int() floored these 1 SAR under the display.
with fixes(id, old_v, new_v) as (values (583463,2388,2389),(583432,388,389),(583496,14,15),(1120876,703,704))
update aqargate_residential_listings t
   set price_total = f.new_v
  from fixes f where t.id = f.id and t.price_total = f.old_v;
with fixes(id, old_v, new_v) as (values (583463,2388,2389),(583432,388,389),(583496,14,15),(1120876,703,704))
update search_listings_ar s
   set price_total = f.new_v
  from fixes f
 where s.source_table = 'aqargate_residential_listings' and s.listing_id = f.id and s.price_total = f.old_v;

-- 4) sadin ×1: description displays BOTH «المطلوب للمتر 5555» and «الإجمالي 5,000,000»; the
--    per-metre figure was stored as the total.
update sadin_residential_listings
   set price_total = 5000000, price_per_meter = 5555
 where id = 598978 and price_total = 5555;
update search_listings_ar
   set price_total = 5000000
 where source_table = 'sadin_residential_listings' and listing_id = 598978 and price_total = 5555;

-- 5) eaqartabuk ×1: two unit rents (2,500 + 1,800) concatenated into 18,002,500; the page shows
--    no single price — null it (deal/type stay).
update eaqartabuk_residential_listings
   set price_annual = null
 where id = 598669 and price_annual = 18002500;
update search_listings_ar
   set price_annual = null
 where source_table = 'eaqartabuk_residential_listings' and listing_id = 598669 and price_annual = 18002500;

-- 6) eastabha ×1: a rent ad («شقق مؤثثة للإيجار – سنة دراسية أو شهري», 3,500/mo) stored as Buy —
--    the source page carried no action/category tag. Monthly rent → standard ×12 annualization.
update eastabha_residential_listings
   set transaction_type = 'Rent', rent_period = 'monthly', price_annual = 42000, price_total = null
 where id = 595411 and transaction_type = 'Buy' and price_total = 3500;
update search_listings_ar
   set deal_ar = 'إيجار', payment_monthly = true, rent_period_ar = 'شهري',
       price_annual = 42000, price_total = null
 where source_table = 'eastabha_residential_listings' and listing_id = 595411
   and deal_ar = 'بيع' and price_total = 3500;

-- 7) hajer ×6 (ADDITIVE only): the price field quotes a per-metre rate («1000 للمتر») — the
--    displayed number stays in price_total per the copy-paste-display rule; record the per-metre
--    semantic in its own column.
with fixes(id, v) as (values (584528,1000),(584492,1050),(584521,1070),(584535,1200),(584588,1000),(584587,1000))
update hajer_residential_listings t
   set price_per_meter = f.v
  from fixes f where t.id = f.id and t.price_total = f.v and t.price_per_meter is null;