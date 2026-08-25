-- Per-detector runtime attribution for the twice-hourly sweep (jobid 38).
--
-- WHY THIS EXISTS. mon_detect_detector_sweep_budget() has been raising
-- 'detector_sweep_aborted' P1s since 2026-08-20 and its own stated action is
-- "attribute the runtime per detector and gate or slim the expensive ones."
-- That was impossible: mon_run_all_detectors() runs 111 detectors in ONE
-- statement inside ONE pg_cron transaction with NO timing instrumentation, and
-- pg_stat_statements.track='top' does not record nested calls. So every abort
-- said "the sweep is too slow" and nothing in the system could say WHICH
-- detector. This table is the missing denominator.
--
-- It is written by mon_run_all_detectors() on every sweep that COMMITS. A sweep
-- killed by statement_timeout rolls its rows back along with everything else --
-- which is precisely why the same change gives the roster a soft deadline, so
-- it stops short and commits the evidence instead of dying with it.
create table if not exists public.ops_detector_timing (
  id          bigserial primary key,
  swept_at    timestamptz not null default now(),
  detector    text        not null,
  elapsed_ms  numeric     not null,
  raised      integer,
  crashed     boolean     not null default false,
  skipped     boolean     not null default false
);

create index if not exists idx_odt_detector_time
  on public.ops_detector_timing (detector, swept_at desc);
create index if not exists idx_odt_swept_at
  on public.ops_detector_timing (swept_at desc);

comment on table public.ops_detector_timing is
  'Per-detector runtime of the mon_run_all_detectors() sweep (jobid 38). One row '
  'per detector per COMMITTED sweep. Read it to attribute a detector_sweep_budget '
  'alert: select detector, round(avg(elapsed_ms)) from ops_detector_timing where '
  'swept_at > now() - interval ''24 hours'' group by 1 order by 2 desc limit 10. '
  'skipped=true means the sweep hit its soft deadline before reaching that detector '
  '-- those detectors did NOT run and protected nothing that half-hour.';
