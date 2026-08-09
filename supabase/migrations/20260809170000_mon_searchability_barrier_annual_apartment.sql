-- Searchability Safety Barrier / Monitor — Annual Rent → Apartment, per platform.
-- Owner rule 2026-08-09: "make it very difficult for a platform to silently go from 100% searchable
-- to 2% searchable without us immediately knowing why and getting alerted."
--
-- Each platform is compared against ITS OWN trailing baseline, never one global threshold: a
-- platform that is legitimately 0% annual (gathern is monthly-only) must not alarm, while a platform
-- that was 100% and drops to 60% must.
--
-- SOURCE IS TRUTH still governs. A listing withheld because the source published no price and no
-- rent period is CORRECTLY withheld, and is counted separately from a blocked one. The monitor
-- exists to catch OUR failures — never to pressure anyone into inventing a value to lift a number.
--
-- Investigated 2026-08-09 and encoded here: eaqartabuk showed 2.4% annual searchability. It is NOT a
-- bug — 78 of its 82 apartment-rent listings publish NEITHER a price NOR a rent period (verified by
-- fetching live pages: zero occurrences of السعر/ريال/سنوي/شهري in the listing body). Withholding
-- them from an ANNUAL filter is the barrier working. Hence the two separate counters below.
create table if not exists mon_searchability_history (
  captured_at          timestamptz not null default now(),
  platform             text        not null,
  held                 integer     not null,
  searchable_annual    integer     not null,
  period_unknown       integer     not null,
  no_price_no_period   integer     not null,
  price_but_no_period  integer     not null,
  not_production_ready integer     not null,
  primary key (captured_at, platform)
);

comment on table mon_searchability_history is
  'Daily per-platform searchability snapshot for Annual Rent -> Apartment. Feeds '
  'mon_searchability_alerts, which compares each platform to its OWN baseline.';

create or replace view mon_searchability_now as
select platform,
       count(*)                                                             as held,
       count(*) filter (where rent_period_ar = 'سنوي' and production_ready) as searchable_annual,
       round(100.0 * count(*) filter (where rent_period_ar = 'سنوي' and production_ready)
             / nullif(count(*), 0), 1)                                      as pct_annual_searchable,
       count(*) filter (where rent_period_ar = 'شهري')                      as monthly_by_source,
       count(*) filter (where rent_period_ar is null)                       as period_unknown,
       count(*) filter (where rent_period_ar is null
                          and price_annual is null and price_total is null) as correctly_withheld_no_source_data,
       count(*) filter (where rent_period_ar is null
                          and (price_annual is not null or price_total is not null)) as suspect_price_without_period,
       count(*) filter (where not production_ready)                         as blocked_not_production_ready,
       count(*) filter (where last_updated > now() - interval '48 hours')   as new_last_48h
from search_listings_ar
where deal_ar = 'إيجار' and type_ar = 'شقة'
group by platform;

comment on view mon_searchability_now is
  'Annual Rent -> Apartment searchability per platform, split by CAUSE. '
  'correctly_withheld_no_source_data = the source published neither price nor period (honest). '
  'suspect_price_without_period = we have a price but no period, which usually means WE dropped it.';

create or replace view mon_searchability_alerts as
with now_ as (select * from mon_searchability_now),
base as (
  select platform,
         (percentile_cont(0.5) within group (
            order by 100.0 * searchable_annual / nullif(held, 0)))::numeric as baseline_pct,
         (percentile_cont(0.5) within group (order by held))::numeric       as baseline_held,
         count(*)                                                           as samples
  from mon_searchability_history
  where captured_at > now() - interval '14 days'
    and captured_at < date_trunc('day', now())
  group by platform
)
select n.platform, n.held, n.searchable_annual, n.pct_annual_searchable,
       round(b.baseline_pct, 1)  as baseline_pct,
       round(b.baseline_held, 0) as baseline_held,
       coalesce(b.samples, 0)    as baseline_samples,
       n.suspect_price_without_period,
       n.correctly_withheld_no_source_data,
       n.blocked_not_production_ready,
       case
         when coalesce(b.samples, 0) < 3 then
           case when n.held >= 20 and n.suspect_price_without_period >= greatest(5, n.held * 0.10)
                then 'SUSPECT_PRICE_WITHOUT_PERIOD' else 'OK' end
         when b.baseline_pct >= 50 and n.pct_annual_searchable < b.baseline_pct * 0.5
              then 'SEARCHABILITY_COLLAPSE'
         when b.baseline_pct >= 50 and n.pct_annual_searchable < b.baseline_pct - 15
              then 'SEARCHABILITY_DROP'
         when n.held > b.baseline_held * 1.20 and n.searchable_annual <= b.baseline_held
              then 'NEW_ROWS_STUCK_BEFORE_SEARCH'
         when n.held >= 20 and n.suspect_price_without_period >= greatest(5, n.held * 0.10)
              then 'SUSPECT_PRICE_WITHOUT_PERIOD'
         when n.held >= 20 and n.blocked_not_production_ready >= n.held * 0.20
              then 'PRODUCTION_READY_FELL'
         else 'OK'
       end as verdict
from now_ n
left join base b on b.platform = n.platform;

comment on view mon_searchability_alerts is
  'MUST report OK for every platform. Each is judged against its OWN 14-day median, never a global '
  'threshold. SEARCHABILITY_COLLAPSE/DROP = a platform fell against its own normal. '
  'NEW_ROWS_STUCK_BEFORE_SEARCH = held grew but searchable did not. SUSPECT_PRICE_WITHOUT_PERIOD = '
  'we hold a price but no rent period, which is usually OUR extraction gap, not a silent source.';

create or replace function mon_snapshot_searchability() returns bigint
language sql as $$
  with ins as (
    insert into mon_searchability_history
      (platform, held, searchable_annual, period_unknown, no_price_no_period,
       price_but_no_period, not_production_ready)
    select platform, held, searchable_annual, period_unknown,
           correctly_withheld_no_source_data, suspect_price_without_period,
           blocked_not_production_ready
    from mon_searchability_now
    on conflict do nothing
    returning 1
  ) select count(*) from ins;
$$;

-- Daily snapshot so each platform accumulates its own baseline (pg_cron jobid 62).
-- select cron.schedule('mon-searchability-snapshot', '15 3 * * *',
--                      $c$select mon_snapshot_searchability();$c$);
