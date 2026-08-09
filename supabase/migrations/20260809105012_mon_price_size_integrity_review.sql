-- READ-ONLY review queue for price/size integrity. Changes no data, hides no listing.
-- Per owner rule "no hiding source-published prices": this NEVER gates display; it only
-- surfaces cards whose price/size should be re-checked against the live source by the
-- scraper's verification job. Extremes may be source-real (see 08-03 outlier census) —
-- a row here is a REVIEW candidate, not a confirmed bug.
create or replace view public.mon_price_size_integrity_review as
select
  source_table,
  listing_id,
  platform,
  deal_ar,
  type_ar,
  price_total,
  area_m2,
  case when area_m2 > 0 and price_total is not null
       then round(price_total / area_m2) end as implied_ppm,
  license_number,
  last_updated,
  case
    when area_m2 is not null and area_m2 <= 0                              then 'SIZE_NONPOSITIVE'      -- defect
    when price_total is not null and price_total >= 1000000000             then 'PRICE_GE_1B'           -- review vs source
    when area_m2 >= 1000000                                                then 'SIZE_GE_1M_M2'         -- review (farm/raw land?)
    when price_total is not null and area_m2 is null                       then 'PRICE_WITHOUT_SIZE'    -- unverifiable pairing
    when deal_ar like '%بيع%' and area_m2 > 0 and price_total is not null
         and (price_total / area_m2) > 150000                             then 'PPM_GT_150K'           -- review vs source
    when deal_ar like '%بيع%' and area_m2 > 0 and price_total is not null
         and (price_total / area_m2) < 50                                 then 'PPM_LT_50'             -- review vs source
  end as flag
from public.search_listings_ar
where production_ready is true;

comment on view public.mon_price_size_integrity_review is
  'READ-ONLY price/size review queue (added 2026-08). Never hides/edits listings. Rows are candidates to re-verify against the live source via the scraper verification job. Extremes may be source-real per the 2026-08-03 outlier census. Query: select flag, count(*) from mon_price_size_integrity_review where flag is not null group by 1.';
