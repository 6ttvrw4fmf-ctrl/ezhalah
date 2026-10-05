-- Owner 2026-10-05: every engineer is rated first by fix rate = fixed-and-proven / found, and must
-- improve night over night. One row per engineer per night (UTC date; every shift runs 05:00-15:00 UTC).
-- proven_fixed = the end row's claim capped by its PASS proof rows that night.
-- ponytail: one proof row is assumed to prove one fix; per-claim linking if that ever over-counts.
create or replace view public.ops_engineer_fix_rate as
with e as (
  select distinct on (split_part(phase, ':', 1), run_at::date)
         split_part(phase, ':', 1) as engineer, run_at::date as night,
         coalesce(issues_found, 0) as found, coalesce(issues_fixed, 0) as claimed_fixed
  from public.ops_daily_engineer_run
  where phase like '%:end'
  order by split_part(phase, ':', 1), run_at::date, run_at desc
), p as (
  select split_part(phase, ':', 1) as engineer, run_at::date as night,
         count(*) filter (where push_ok) as pass_proofs
  from public.ops_daily_engineer_run
  where phase like '%:proof'
  group by 1, 2
), r as (
  select e.engineer, e.night, e.found, e.claimed_fixed, coalesce(p.pass_proofs, 0) as pass_proofs,
         least(e.claimed_fixed, coalesce(p.pass_proofs, 0)) as proven_fixed
  from e left join p using (engineer, night)
)
select r.*,
       round(100.0 * r.proven_fixed / nullif(r.found, 0)) as fix_rate_pct,
       round(100.0 * r.proven_fixed / nullif(r.found, 0))
         - lag(round(100.0 * r.proven_fixed / nullif(r.found, 0))) over (partition by r.engineer order by r.night)
         as change_vs_last_night,
       r.claimed_fixed > r.pass_proofs as over_claimed
from r;

revoke all on public.ops_engineer_fix_rate from public, anon, authenticated;
