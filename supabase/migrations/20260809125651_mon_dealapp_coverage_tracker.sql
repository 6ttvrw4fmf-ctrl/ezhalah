-- Coverage-vs-liveness tracker (read-only). Denominator lives in a per-platform table so it can be
-- refreshed as the source grows, and reused for the fleet-wide audit that follows Dealapp.
create table if not exists public.ops_platform_live_inventory(
  platform text primary key,
  live_ids integer not null,
  source   text not null,          -- how live_ids was measured
  as_of    timestamptz not null default now()
);

insert into public.ops_platform_live_inventory(platform, live_ids, source, as_of)
values ('dealapp', 58320, 'dealapp.sa/sitemap.xml unique /ad-details ids (7 ad sub-sitemaps)', now())
on conflict (platform) do update
  set live_ids = excluded.live_ids, source = excluded.source, as_of = excluded.as_of;

-- One-row funnel: live inventory → discovered → active → searchable, plus liveness safety split.
create or replace view public.mon_dealapp_coverage as
with inv as (select live_ids from public.ops_platform_live_inventory where platform='dealapp'),
res as (select active, missing_count, last_seen_at from public.dealapp_residential_listings),
com as (select active from public.dealapp_commercial_listings)
select
  (select live_ids from inv)                                                        as live_source_ids,
  (select count(*) from res) + (select count(*) from com)                           as discovered,
  (select count(*) from res where active) + (select count(*) from com where active) as active,
  (select count(*) from public.search_listings_ar
     where platform='dealapp' and production_ready)                                 as searchable,
  (select count(*) from res where active is false)
    + (select count(*) from com where active is false)                              as inactive,
  (select count(*) from res where active is false and missing_count = 3)            as inactive_sold_pinned,
  (select count(*) from res where active is false and missing_count is distinct from 3)
                                                                                     as inactive_provenance_unknown,
  (select count(*) from res where active and last_seen_at < now() - interval '14 days')
                                                                                     as stale_active_14d,
  (select count(*) from res where last_seen_at >= now() - interval '3 days')         as seen_last_3d,
  round(100.0 * ((select count(*) from res) + (select count(*) from com))
        / nullif((select live_ids from inv),0), 1)                                   as coverage_pct,
  round(100.0 * (select count(*) from public.search_listings_ar
                 where platform='dealapp' and production_ready)
        / nullif((select live_ids from inv),0), 1)                                   as searchable_pct,
  now() as as_of;

comment on view public.mon_dealapp_coverage is
  'Dealapp coverage-vs-liveness funnel. Denominator from ops_platform_live_inventory (refresh as sitemap grows). Read-only. inactive_provenance_unknown>0 = inactivations NOT from the sold-pin — reconfirm before trusting.';
