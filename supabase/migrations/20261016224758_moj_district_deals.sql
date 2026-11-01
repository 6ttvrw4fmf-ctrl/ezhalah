-- THE MINISTRY'S OWN DEALS, ONE ROW EACH (owner 2026-10-16: «when a user clicks, he sees the exact same transactions»).
-- The ad page's «البيع الفعلي» half prints the ministry's district aggregates (public.moj_district_sales). The public
-- Power BI report those come from cannot be opened pre-filtered (Microsoft: query-string filters do not work with
-- Publish to web — verified live 2026-10-16), so the page shows the deals themselves: the same per-deal rows the
-- weekly job already reads for the p10/p90 spread, now kept here for every MATCHED district · class in the anchored
-- 12-month window, every value the ministry's own and unaltered (date, m², price, and ITS per-deal «سعر المتر المربع»,
-- never price ÷ area recomputed by us). Deals that fall out of the window are pruned by the job on its next run.
-- Filled by scrapers/moj/sales.py (deal_table_rows / write_deals, this PR); read by the ad page's deals sheet
-- (src/data/adPageData.ts → fetchMojDeals, the follow-up UI PR). Public read like moj_district_sales: open data, cited.
create table public.moj_district_deals (
  moj_region text not null,
  moj_area text not null,
  property_class text not null,
  deal_ref text not null,
  deal_date date not null,
  area_m2 numeric not null,
  price numeric not null,
  ppm numeric not null,
  city_ar text not null,
  district_ar text not null,
  fetched_at timestamptz not null default now(),
  primary key (moj_region, moj_area, property_class, deal_ref),
  constraint moj_district_deals_values check (area_m2 > 0 and price >= 0 and ppm >= 0)
);
create index moj_district_deals_lookup on public.moj_district_deals (city_ar, district_ar, property_class, deal_date desc);
comment on table public.moj_district_deals is
  'Ministry of Justice sold deals, one row per deal reference, for the matched districts in the weekly job''s anchored window; every value is the ministry''s and is shown unaltered on the in-app ad page.';
comment on column public.moj_district_deals.deal_ref is 'The ministry''s «الرقم المرجعي للصفقة».';
comment on column public.moj_district_deals.ppm is 'The ministry''s own per-deal «سعر المتر المربع». Never recompute as price / area_m2.';
comment on column public.moj_district_deals.city_ar is 'Our city label the deal''s ministry area was matched to (search_listings_ar.city_ar).';
comment on column public.moj_district_deals.district_ar is 'Our district label the deal''s ministry area was matched to (search_listings_ar.district_ar).';
alter table public.moj_district_deals enable row level security;
create policy "moj district deals are public read" on public.moj_district_deals
  for select to anon, authenticated using (true);
grant select on public.moj_district_deals to anon, authenticated;
