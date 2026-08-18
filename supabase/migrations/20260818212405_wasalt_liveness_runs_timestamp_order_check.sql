-- Data Integrity run #29 follow-up (owner: "New liveness runs must always satisfy
-- started_at <= finished_at. Make sure ... all future insert paths share the same invariant").
--
-- The code fix (three insert sites) and the AST regression test pin the CALLERS; the detector
-- mon_detect_run_log_timestamps_inverted catches a violation after the fact. This makes the
-- invariant structural: the database itself refuses a backwards row.
--
-- Safe to enforce at insert time, and checked before adding: in all three paths
-- (run_pilot, run_enforce, run_enum_strike) the wasalt_liveness_runs insert is the LAST write of
-- the run - _flush_alive() and the active=false updates have already been applied and committed by
-- then. So a constraint violation fails the run loudly at the end without losing or rolling back a
-- single listing write, which is the correct failure direction. The opposite arrangement - a logger
-- that can discard listing work - is what scrapers/common/tests/test_wasalt_enum_strike_kill_
-- evidence.py exists to prevent.
--
-- NULL finished_at is allowed: a row written by a future path that records the start first must not
-- be blocked. Only an ORDERED PAIR that disagrees is rejected.

do $$
declare bad int;
begin
  select count(*) into bad from public.wasalt_liveness_runs
   where finished_at is not null and finished_at < started_at;
  if bad <> 0 then
    raise exception 'refusing to add the constraint while % rows still violate it', bad;
  end if;
end $$;

alter table public.wasalt_liveness_runs
  add constraint wasalt_liveness_runs_time_order_chk
  check (finished_at is null or finished_at >= started_at);

comment on constraint wasalt_liveness_runs_time_order_chk on public.wasalt_liveness_runs is
  'A run cannot finish before it starts. Added by data-integrity run #29 after all 52 rows were '
  'found backwards: the inserts sent finished_at = the stamp captured at the TOP of the run and left '
  'started_at to its now() default, evaluated at INSERT time. Code fixed at three sites, data '
  'repaired by a per-row-proven swap, and this constraint makes a repeat impossible rather than '
  'merely detectable. Safe because the log insert is the last write of every liveness path.';
