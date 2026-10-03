-- One row per engineer: did the last run happen, did it finish, how long did it take, what did it rate itself.
-- Read every day by the 🔧 Quality & Repair Engineer (docs/ops/QUALITY_REPAIR_ENGINEER.md) so its review is
-- a read of the database, not a reading of long reports. Ops-only, no PII, no listing data.
-- Phases follow the run log's own convention: '<engineer>:start' / ':progress' / ':end'.
create or replace view public.ops_engineer_review as
with team(eng, cap_min) as (
  values ('scraping-engineer', 180), ('new_listings_engineer', 180), ('lifecycle', 240)
),
last_run as (
  select t.eng, t.cap_min,
         (select max(r.run_at) from public.ops_daily_engineer_run r where r.phase = t.eng || ':start') as last_start
  from team t
),
x as (
  select l.*,
         (select min(r.run_at) from public.ops_daily_engineer_run r
           where r.phase = l.eng || ':end' and r.run_at >= l.last_start) as last_end
  from last_run l
)
select
  x.eng                                                        as engineer,
  x.cap_min,
  x.last_start,
  x.last_end,
  (x.last_start > now() - interval '26 hours')                 as ran_last_26h,
  (x.last_end is not null)                                     as finished,
  case when x.last_end is not null
       then round(extract(epoch from (x.last_end - x.last_start)) / 60)::int end   as minutes_used,
  coalesce(extract(epoch from (x.last_end - x.last_start)) / 60 > x.cap_min + 10, false) as over_cap,
  (select count(*) from public.ops_daily_engineer_run r
     where r.phase = x.eng || ':progress' and r.run_at >= x.last_start)::int       as progress_rows,
  (select r.issues_found from public.ops_daily_engineer_run r
     where r.phase = x.eng || ':end' and r.run_at >= x.last_start order by r.run_at desc limit 1) as issues_found,
  (select r.issues_fixed from public.ops_daily_engineer_run r
     where r.phase = x.eng || ':end' and r.run_at >= x.last_start order by r.run_at desc limit 1) as issues_fixed,
  (select substring(r.report from '(\d{1,2})\s*/\s*10') from public.ops_daily_engineer_run r
     where r.phase = x.eng || ':end' and r.run_at >= x.last_start order by r.run_at desc limit 1)::int as rating_in_report,
  -- heuristic: the report hands the owner a decision instead of making it
  (select coalesce(r.report ~* '(owner questions|asking you|needs your|needs from you)'
                   and r.report !~* 'needs from you:?\s*nothing', false)
     from public.ops_daily_engineer_run r
     where r.phase = x.eng || ':end' and r.run_at >= x.last_start order by r.run_at desc limit 1) as asks_owner_heuristic
from x;

revoke all on public.ops_engineer_review from anon, authenticated;

comment on view public.ops_engineer_review is
  'One row per engineer (scraping-engineer, new_listings_engineer, lifecycle): last start/end, minutes used against its cap, '
  'progress rows, issues found/fixed, the rating it wrote, and a heuristic flag for asking the owner. Read by the Quality & Repair Engineer.';
