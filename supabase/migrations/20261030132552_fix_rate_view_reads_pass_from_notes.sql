-- ops_engineer_fix_rate: a proof row counts as PASS when push_ok is true, or when push_ok was left
-- NULL and the row's own notes (the rulebook's proof shape) say "result":"PASS". An explicit
-- push_ok = false (a FAIL row) never counts.
--
-- Why (🔧 2026-10-30): ♻️ wrote three PASS proofs tonight (rows 2257, 2259, 2261: 4 dead ads out of
-- search, ~90 Gathern units re-stamped alive, 1 amlakalahsa ad hidden) with push_ok NULL. The view
-- counted only push_ok, read ♻️ as 0 proven of 4 found (0%, over_claimed = true) and every coach
-- line built on it would have graded a real 75% night as a 0. The measuring stick must read the
-- same fact both ways the rulebook lets an engineer write it.
create or replace view public.ops_engineer_fix_rate as
 WITH e AS (
         SELECT DISTINCT ON ((split_part(ops_daily_engineer_run.phase, ':'::text, 1)), (ops_daily_engineer_run.run_at::date)) split_part(ops_daily_engineer_run.phase, ':'::text, 1) AS engineer,
            ops_daily_engineer_run.run_at::date AS night,
            COALESCE(ops_daily_engineer_run.issues_found, 0) AS found,
            COALESCE(ops_daily_engineer_run.issues_fixed, 0) AS claimed_fixed
           FROM ops_daily_engineer_run
          WHERE ops_daily_engineer_run.phase ~~ '%:end'::text
          ORDER BY (split_part(ops_daily_engineer_run.phase, ':'::text, 1)), (ops_daily_engineer_run.run_at::date), ops_daily_engineer_run.run_at DESC
        ), p AS (
         SELECT split_part(ops_daily_engineer_run.phase, ':'::text, 1) AS engineer,
            ops_daily_engineer_run.run_at::date AS night,
            count(*) FILTER (WHERE COALESCE(ops_daily_engineer_run.push_ok,
                                            ops_daily_engineer_run.notes ~ '"result"\s*:\s*"PASS"')) AS pass_proofs
           FROM ops_daily_engineer_run
          WHERE ops_daily_engineer_run.phase ~~ '%:proof'::text
          GROUP BY (split_part(ops_daily_engineer_run.phase, ':'::text, 1)), (ops_daily_engineer_run.run_at::date)
        ), r AS (
         SELECT e.engineer,
            e.night,
            e.found,
            e.claimed_fixed,
            COALESCE(p.pass_proofs, 0::bigint) AS pass_proofs,
            LEAST(e.claimed_fixed::bigint, COALESCE(p.pass_proofs, 0::bigint)) AS proven_fixed
           FROM e
             LEFT JOIN p USING (engineer, night)
        )
 SELECT engineer,
    night,
    found,
    claimed_fixed,
    pass_proofs,
    proven_fixed,
    round(100.0 * proven_fixed::numeric / NULLIF(found, 0)::numeric) AS fix_rate_pct,
    round(100.0 * proven_fixed::numeric / NULLIF(found, 0)::numeric) - lag(round(100.0 * proven_fixed::numeric / NULLIF(found, 0)::numeric)) OVER (PARTITION BY engineer ORDER BY night) AS change_vs_last_night,
    claimed_fixed > pass_proofs AS over_claimed
   FROM r;