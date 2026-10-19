-- ⚡ Scraping Engineer, 2026-10-06 — WEEKLY SITE HEALTH (owner backlog 66, no AI).
-- A layout change rarely breaks a crawl outright; it first empties a field. Once a week, for every
-- platform, compare how often its NEW rows (first seen in the last 7 days) carry price, area,
-- district and a photo against its rows from the 28 days before. A loss of 30+ points on any field
-- (>= 10 new rows, >= 20 older rows) lands in ops_engineer_backlog with the numbers, before the site
-- fully breaks. First measured run (2026-10-06): compoundin district -47 / area -31 (English
-- spellings not mapped since its 10-02 address move — fixed the same night) and sakan price -30.
-- p_dry => true only returns the findings. One open row per platform per ISO week.

create or replace function public.scraper_field_fill_losses(p_dry boolean default false)
returns table(platform text, new_rows bigint, old_rows bigint, price_loss numeric, area_loss numeric,
              district_loss numeric, photo_loss numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  found jsonb;
begin
  with w as (
    select s.platform, (s.first_seen_at > now() - interval '7 days') as recent, count(*) as n,
           avg((s.price_total is not null)::int) as p, avg((s.area_m2 is not null)::int) as a,
           avg((s.district_ar is not null)::int) as d, avg(coalesce(s.has_photo, false)::int) as ph
    from search_listings_ar s
    where s.production_ready and s.first_seen_at > now() - interval '35 days'
    group by 1, 2
  ), x as (
    select r.platform, r.n as new_rows, b.n as old_rows,
           round(100 * (b.p - r.p)) as price_loss, round(100 * (b.a - r.a)) as area_loss,
           round(100 * (b.d - r.d)) as district_loss, round(100 * (b.ph - r.ph)) as photo_loss
    from w r join w b on b.platform = r.platform and r.recent and not b.recent
    where r.n >= 10 and b.n >= 20
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.platform), '[]'::jsonb) into found
  from x
  where greatest(x.price_loss, x.area_loss, x.district_loss, x.photo_loss) >= 30
    and not exists (select 1 from ops_engineer_backlog b
                    where b.engineer = 'scraping-engineer'
                      and b.item like 'field-fill loss ' || x.platform || ' ' || to_char(now() at time zone 'utc', 'IYYY-"W"IW') || '%');

  if not p_dry then
    insert into ops_engineer_backlog (engineer, item, status, evidence)
    select 'scraping-engineer',
           'field-fill loss ' || e.platform || ' ' || to_char(now() at time zone 'utc', 'IYYY-"W"IW')
             || ': new rows lost a field (layout change?) — open the source page and fix the parser',
           'open',
           'points lost vs the 28 days before: price ' || e.price_loss || ', area ' || e.area_loss
             || ', district ' || e.district_loss || ', photo ' || e.photo_loss
             || ' | new rows ' || e.new_rows || ', older ' || e.old_rows || ' | scraper_field_fill_losses()'
    from jsonb_to_recordset(found) as e(platform text, new_rows bigint, old_rows bigint, price_loss numeric,
                                        area_loss numeric, district_loss numeric, photo_loss numeric);
  end if;

  return query select e.platform, e.new_rows, e.old_rows, e.price_loss, e.area_loss, e.district_loss, e.photo_loss
               from jsonb_to_recordset(found) as e(platform text, new_rows bigint, old_rows bigint, price_loss numeric,
                                                   area_loss numeric, district_loss numeric, photo_loss numeric)
               order by e.platform;
end;
$function$;

revoke all on function public.scraper_field_fill_losses(boolean) from public, anon, authenticated;

-- Mondays 04:50 UTC, before the engineers' night window. ~0.5 s (measured).
select cron.schedule('scraper-field-fill-losses', '50 4 * * 1', $$select public.scraper_field_fill_losses()$$);

do $check$
declare n int;
begin
  select count(*) into n from public.scraper_field_fill_losses(true) where platform = 'compoundin';
  if n <> 1 then raise exception 'dry run must flag compoundin (the measured loss), got %', n; end if;
  select count(*) into n from cron.job where jobname = 'scraper-field-fill-losses' and schedule = '50 4 * * 1';
  if n <> 1 then raise exception 'scraper-field-fill-losses cron not scheduled exactly once (%)', n; end if;
end
$check$;