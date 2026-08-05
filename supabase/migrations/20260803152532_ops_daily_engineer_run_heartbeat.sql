-- Senior audit run #3 (2026-08-03): the daily engineer cloud routine fired 4 times (07-31→08-03)
-- with ZERO observable output — no branch, no PR, no issue, no GitHub events — and missed a live
-- P1-class signal on 08-03. Its SELECT-only guardrail meant even a healthy no-findings run left no
-- trace, so "functioning invisibly" and "silently failing" were indistinguishable from outside.
-- This heartbeat table is the fix (dashboard-first rule: state lives in Postgres): the routine
-- INSERTs a row as its FIRST action and updates it with the final report as its LAST, and the
-- senior routine reads it as the daily handoff instead of the (never-created) git branch.
-- Same class as ops_senior_audit_run (2026-07-30, owner-authorized); zero anon grants by design.
CREATE TABLE IF NOT EXISTS ops_daily_engineer_run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  phase text NOT NULL DEFAULT 'started',   -- 'started' | 'completed' | 'failed'
  push_ok boolean,                          -- result of the git-push capability probe
  issues_found int,
  issues_fixed int,
  report text,                              -- the full END-OF-DAY REPORT text
  metrics jsonb,                            -- per-platform counts snapshot
  notes text
);
