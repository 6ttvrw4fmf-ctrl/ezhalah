-- The ministry's per-deal price spread (owner 2026-10-10, update 23): the split card's fourth row prints
-- «8 من كل 10 بين {p10} و{p90} مليون» on BOTH halves, so the ministry side needs the 10th and 90th
-- percentiles of its per-deal prices for the row's window. The weekly job fills them from the deal-level
-- rows; the seeded الرمال row carries the ministry's figures (0.43M – 1.65M).
alter table public.moj_district_sales
  add column p10_deal numeric,
  add column p90_deal numeric;
comment on column public.moj_district_sales.p10_deal is '10th percentile of the per-deal prices in the ministry''s rows for this window (nullable until the job fills it).';
comment on column public.moj_district_sales.p90_deal is '90th percentile of the per-deal prices in the ministry''s rows for this window (nullable until the job fills it).';
update public.moj_district_sales
   set p10_deal = 430000, p90_deal = 1650000
 where city_ar = 'الرياض' and district_ar = 'حي الرمال' and property_class = 'سكني';