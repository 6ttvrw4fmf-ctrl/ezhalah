-- Daily Dealapp coverage/freshness/liveness snapshot so we stop guessing. Read-only aggregation.
create table if not exists public.ops_dealapp_coverage_history(
  snapshot_at                 timestamptz not null default now(),
  snapshot_date               date not null,
  live_source_ids             integer,   -- source live inventory estimate (sitemap)
  discovered                  integer,   -- discovered IDs (res+com)
  active                      integer,   -- active listings
  searchable                  integer,   -- searchable in Ezhalah
  coverage_pct                numeric,   -- true coverage %
  new_ids_today               integer,   -- new IDs first-seen today (UTC)
  last_crawl_dur_min          numeric,   -- crawl duration (latest dealapp run today)
  crawls_today                integer,
  failed_or_blocked_today     integer,   -- ok=false OR 0-row runs today
  stale_active_14d            integer,   -- active but unseen 14d+
  inactive_total              integer,   -- inactivated listings
  inactive_sold_pinned        integer,   -- confirmed sold/removed (missing_count=3)
  inactive_age_sweep_residue  integer,   -- mc=0 = legacy age-sweep residue (recheck target)
  raw_inactive_still_searchable integer, -- removal → Ezhalah-inactive propagation lag (want 0)
  primary key (snapshot_date)
);

create or replace function public.ops_snapshot_dealapp_coverage()
returns void language sql security definer set search_path to 'public' as $fn$
  insert into public.ops_dealapp_coverage_history as h (
    snapshot_date, live_source_ids, discovered, active, searchable, coverage_pct,
    new_ids_today, last_crawl_dur_min, crawls_today, failed_or_blocked_today,
    stale_active_14d, inactive_total, inactive_sold_pinned, inactive_age_sweep_residue,
    raw_inactive_still_searchable)
  select
    (now() at time zone 'utc')::date,
    (select live_ids from ops_platform_live_inventory where platform='dealapp'),
    (select count(*) from dealapp_residential_listings) + (select count(*) from dealapp_commercial_listings),
    (select count(*) from dealapp_residential_listings where active) + (select count(*) from dealapp_commercial_listings where active),
    (select count(*) from search_listings_ar where platform='dealapp' and production_ready),
    round(100.0 * ((select count(*) from dealapp_residential_listings) + (select count(*) from dealapp_commercial_listings))
          / nullif((select live_ids from ops_platform_live_inventory where platform='dealapp'),0), 2),
    (select count(*) from dealapp_residential_listings where (scraped_at at time zone 'utc')::date = (now() at time zone 'utc')::date),
    (select round(extract(epoch from (finished_at-started_at))/60.0,1) from scrape_runs
       where platform='dealapp' and (started_at at time zone 'utc')::date = (now() at time zone 'utc')::date
       order by id desc limit 1),
    (select count(*) from scrape_runs where platform='dealapp' and (started_at at time zone 'utc')::date = (now() at time zone 'utc')::date),
    (select count(*) from scrape_runs where platform='dealapp' and (started_at at time zone 'utc')::date = (now() at time zone 'utc')::date
       and (ok is not true or coalesce(rows_seen,0)=0)),
    (select count(*) from dealapp_residential_listings where active and last_seen_at < now()-interval '14 days'),
    (select count(*) from dealapp_residential_listings where active is false) + (select count(*) from dealapp_commercial_listings where active is false),
    (select count(*) from dealapp_residential_listings where active is false and missing_count=3),
    (select count(*) from dealapp_residential_listings where active is false and missing_count is distinct from 3),
    (select count(*) from search_listings_ar s where s.platform='dealapp' and s.production_ready
       and exists (select 1 from dealapp_residential_listings d where d.id=s.listing_id and d.active is false))
  on conflict (snapshot_date) do update set
    snapshot_at=now(), live_source_ids=excluded.live_source_ids, discovered=excluded.discovered,
    active=excluded.active, searchable=excluded.searchable, coverage_pct=excluded.coverage_pct,
    new_ids_today=excluded.new_ids_today, last_crawl_dur_min=excluded.last_crawl_dur_min,
    crawls_today=excluded.crawls_today, failed_or_blocked_today=excluded.failed_or_blocked_today,
    stale_active_14d=excluded.stale_active_14d, inactive_total=excluded.inactive_total,
    inactive_sold_pinned=excluded.inactive_sold_pinned, inactive_age_sweep_residue=excluded.inactive_age_sweep_residue,
    raw_inactive_still_searchable=excluded.raw_inactive_still_searchable;
$fn$;

comment on function public.ops_snapshot_dealapp_coverage() is
  'Daily Dealapp coverage/liveness snapshot into ops_dealapp_coverage_history. Read-only aggregation; idempotent per UTC day.';
