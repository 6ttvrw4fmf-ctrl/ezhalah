-- The weekly job behind the ad page's «أسعار البيع الفعلية» card (scrapers/moj/run.py, run by
-- .github/workflows/moj-district-sales.yml). It writes EVERY district the Ministry of Justice reports,
-- so a row's identity becomes the ministry's own district (region · «المدينة/الحي» · class), and
-- city_ar / district_ar become OUR key — filled only when exactly one of our districts matches it
-- (match_status 'matched'); NULL for 'unmatched' and 'ambiguous', which the app can never read.
-- Anon reads only matched rows whose window_to advanced within the last 120 days: a ministry series
-- that stops moving disappears from the card instead of being shown as current. The card still prints
-- the row's own window, so the period is always on screen.
alter table public.moj_district_sales drop constraint moj_district_sales_pkey;
alter table public.moj_district_sales
  alter column city_ar drop not null,
  alter column district_ar drop not null,
  add column moj_region text,
  add column moj_area text,
  add column match_status text,
  add column fetched_at timestamptz,
  add column window_to_advanced_at timestamptz not null default now();
update public.moj_district_sales
   set moj_region = 'منطقة الرياض', moj_area = 'الرياض/الرمال', match_status = 'matched', fetched_at = updated_at
 where city_ar = 'الرياض' and district_ar = 'حي الرمال' and property_class = 'سكني';
alter table public.moj_district_sales
  alter column moj_region set not null,
  alter column moj_area set not null,
  alter column match_status set not null,
  alter column fetched_at set not null,
  add primary key (moj_region, moj_area, property_class),
  add constraint moj_district_sales_class check (property_class in ('سكني', 'تجاري')),
  add constraint moj_district_sales_match check (
    (match_status = 'matched' and city_ar is not null and district_ar is not null)
    or (match_status in ('unmatched', 'ambiguous') and city_ar is null and district_ar is null));
-- One ministry row per ad-page key: the app reads .eq(city_ar).eq(district_ar).eq(property_class).limit(1).
create unique index moj_district_sales_ours on public.moj_district_sales (city_ar, district_ar, property_class)
  where match_status = 'matched';
comment on column public.moj_district_sales.moj_area is 'The ministry''s own district label «المدينة/الحي», verbatim.';
comment on column public.moj_district_sales.match_status is
  'matched = exactly one of our (city_ar, district_ar) and no other MoJ district on it; unmatched / ambiguous rows are stored for the record and never shown.';
comment on column public.moj_district_sales.window_to_advanced_at is
  'When window_to last moved forward (set by trigger). Anon RLS hides the row 120 days after that.';

create or replace function public.moj_district_sales_track_window() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.window_to <= old.window_to then
    new.window_to_advanced_at := old.window_to_advanced_at;
  else
    new.window_to_advanced_at := now();
  end if;
  return new;
end $$;
create trigger moj_district_sales_track_window before insert or update on public.moj_district_sales
  for each row execute function public.moj_district_sales_track_window();

drop policy "moj district sales are public read" on public.moj_district_sales;
create policy "moj district sales: matched and moving rows are public read" on public.moj_district_sales
  for select to anon, authenticated
  using (match_status = 'matched' and window_to_advanced_at > now() - interval '120 days');

-- Our districts for the job's matcher: every (region, city, district) the ad page can be opened on.
create or replace function public.moj_our_districts() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('region_ar', region_ar, 'city_ar', city_ar, 'district_ar', district_ar)), '[]'::jsonb)
    from (select distinct region_ar, city_ar, district_ar from public.search_listings_ar
           where city_ar is not null and district_ar is not null) d
$$;
revoke all on function public.moj_our_districts() from public, anon, authenticated;
grant execute on function public.moj_our_districts() to service_role;

select cron.schedule('gh-moj-district-sales', '41 17 * * 6', $$select public.trigger_gh_workflow('moj-district-sales.yml')$$);
