-- Senior Production Engineer routine (owner-mandated 2026-07-30, runs every 2 days): persistent
-- run state so consecutive audits diff against a trusted baseline instead of starting blind.
-- One row per run; evidence lives in the jsonb columns. Read+write by the audit routines only.
CREATE TABLE IF NOT EXISTS ops_senior_audit_run (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL,                -- 'scheduled-2day' | 'change-triggered' | 'manual'
  score_pct numeric,
  checks jsonb,                         -- {passed, failed, blocked, na}
  platform_status jsonb,                -- {active_healthy, active_unhealthy, paused, retired}
  issues jsonb,                         -- [{sev, title, status, evidence}]
  fixes jsonb,                          -- [{title, pr, migration, verified}]
  baselines jsonb,                      -- layer counts + per-platform snapshot for the next diff
  notes text
);
