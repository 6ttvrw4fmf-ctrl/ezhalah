-- THE FULL MINISTRY OF JUSTICE ARCHIVE (owner 2026-10-21: «make sure we're capturing everything»).
--
-- moj_district_sales / moj_district_deals feed the ad page's «أسعار البيع الفعلية» card and keep only the latest
-- 12 months, only سكني/تجاري, and only deals whose district matches ours: 80,289 of the 715,322 deals the ministry
-- published (Jan 2023 → Sep 2026, measured 2026-10-21). This table keeps EVERY published deal — every year, every
-- class (سكني, تجاري, زراعي, سكني تجاري), matched or not — exactly as the ministry wrote it, for the price estimate.
-- Filled by scrapers/moj/sales.py (run_archive) in the same weekly job: a one-off backfill from the ministry's
-- first date, then each run re-reads a 45-day overlap. Upsert only, never pruned.
--
-- Private: RLS on and NO policy, so anon and authenticated read nothing; the service role writes it. The ad page
-- keeps reading the card tables, unchanged.
--
-- One row per (region, area, class, deal ref, m²): the ministry repeats a deal across its m² values. area_m2 can be
-- NULL, so the key is a UNIQUE NULLS NOT DISTINCT constraint (the upsert's on_conflict target), not a primary key.
create table if not exists public.moj_sales_archive (
  moj_region     text not null default '',
  moj_city       text not null default '',
  moj_area       text not null default '',
  property_class text not null default '',
  deal_ref       text not null,
  deal_date      date not null,
  area_m2        numeric,
  price          numeric,
  ppm            numeric,
  fetched_at     timestamptz not null default now(),
  constraint moj_sales_archive_key unique nulls not distinct (moj_region, moj_area, property_class, deal_ref, area_m2)
);

create index if not exists moj_sales_archive_date on public.moj_sales_archive (deal_date desc);
create index if not exists moj_sales_archive_area on public.moj_sales_archive (moj_area, property_class, deal_date desc);

alter table public.moj_sales_archive enable row level security;
revoke all on public.moj_sales_archive from anon, authenticated;

comment on table public.moj_sales_archive is
  'Every Ministry of Justice sale the public open-data report publishes, every year and class, matched or not. Private (no RLS policy). Filled weekly by scrapers/moj/sales.py run_archive.';
