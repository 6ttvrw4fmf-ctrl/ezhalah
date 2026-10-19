-- THE MINISTRY OF JUSTICE'S OWN DISTRICT SALES FIGURES (owner 2026-10-10), read by the in-app ad page's
-- «أسعار البيع الفعلية» card (src/data/adPageData.ts → fetchMojSales). One row per city · district · class,
-- filled by a weekly job (specified separately); this migration creates the table, opens it to the anon
-- read the app uses, and seeds the first district.
-- Every number is the ministry's and is shown unaltered. In particular avg_ppm is THEIR measure «متوسط سعر
-- المتر المربع» — the mean of the per-deal m² prices — and must never be recomputed as total price ÷ total
-- area (for الرمال that gives 3,724, a different quantity). window_from / window_to are the min and max
-- deal dates in the ministry's data: the card prints the period from these two columns, never «آخر 12 شهر».
create table public.moj_district_sales (
  city_ar text not null,
  district_ar text not null,
  property_class text not null default 'سكني',
  deals integer not null,
  avg_deal numeric not null,
  avg_ppm numeric not null,
  window_from date not null,
  window_to date not null,
  source_refreshed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (city_ar, district_ar, property_class),
  constraint moj_district_sales_window check (window_to >= window_from),
  constraint moj_district_sales_deals check (deals >= 0)
);
comment on table public.moj_district_sales is
  'Ministry of Justice district sales aggregates (one row per city · district · class), filled weekly; shown unaltered on the in-app ad page. district_ar matches search_listings_ar.district_ar exactly (e.g. «حي الرمال»).';
comment on column public.moj_district_sales.avg_ppm is
  'The ministry''s «متوسط سعر المتر المربع»: mean of per-deal m² prices. Never recompute as sum(price)/sum(area).';
comment on column public.moj_district_sales.window_from is 'Earliest deal date in the ministry''s data for this row.';
comment on column public.moj_district_sales.window_to is 'Latest deal date in the ministry''s data for this row — the card''s period ends here, never at today.';
alter table public.moj_district_sales enable row level security;
create policy "moj district sales are public read" on public.moj_district_sales
  for select to anon, authenticated using (true);
grant select on public.moj_district_sales to anon, authenticated;
insert into public.moj_district_sales
  (city_ar, district_ar, property_class, deals, avg_deal, avg_ppm, window_from, window_to, source_refreshed_at)
values
  ('الرياض', 'حي الرمال', 'سكني', 285, 1390633.21, 4449.37, '2025-10-10', '2026-05-18', '2026-10-10T03:09:39Z');