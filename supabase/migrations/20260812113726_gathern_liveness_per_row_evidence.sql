-- Every gathern liveness decision must be independently re-checkable from our own data.
--
-- WHY (2026-08-12, owner-directed audit of the 1,107-row backlog). The owner asked: separate the
-- cohort into evidence-backed groups and prove each one from source. For wasalt that took a single
-- query — `wasalt_liveness_pilot_detail` stores one row per decision (HEAD status, GET status,
-- verdict, has_property_details), so all 1,216 inactivations resolved instantly as
-- head=404 AND get=404. wasalt's own module comment records exactly why it was added:
--
--     "enum-strike inactivates ~1.2-1.5k rows per run but used to persist only AGGREGATE counts in
--      wasalt_liveness_runs, so 'was that kill correct?' could not be answered from our own data —
--      it needed an outside oracle re-fetched by hand."
--
-- gathern is still in that pre-fix state: it persists only the aggregate line
-- (`scanned=1500 dead=1131 alive=369 …`) in scrape_runs.notes. So for the 1,107 rows now waiting on
-- an owner decision, our database cannot say WHICH row returned WHICH status on WHICH day — the
-- per-row 404 evidence exists only in expiring GitHub Actions logs. That is the same gap the
-- Senior's 2026-08-12 dealapp work closed for fetch-failure buckets, and it is why three separate
-- audits have had to re-derive gathern liveness state by hand.
--
-- This table is the gathern half of that. It is written by scrapers/gathern/liveness.py on EVERY
-- run including dry-runs (a dry-run's evidence is the whole point of a dry-run), and the write is
-- best-effort: an audit-log failure must never break or roll back a liveness sweep.
--
-- It records evidence only. It never drives inactivation, and nothing here changes the kill cap,
-- the 3-strike grace, or any other safety gate.

create table if not exists public.gathern_liveness_detail (
  id                   bigserial primary key,
  run_at               timestamptz not null default now(),
  listing_id           bigint      not null,
  http_status          int,
  verdict              text        not null,
  missing_count_before int,
  missing_count_after  int,
  applied              boolean     not null default false
);

create index if not exists idx_gathern_liveness_detail_run_at
  on public.gathern_liveness_detail (run_at desc);
create index if not exists idx_gathern_liveness_detail_listing
  on public.gathern_liveness_detail (listing_id, run_at desc);

comment on table public.gathern_liveness_detail is
  'One row per gathern liveness decision: the raw HTTP status the detail page returned and the '
  'verdict derived from it (kill / strike / alive / transient), plus the missing_count before and '
  'after. Mirrors wasalt_liveness_pilot_detail. Written on every run INCLUDING dry-runs, with '
  'applied=false when nothing was flipped, so "was that kill correct?" is answerable from our own '
  'data instead of from an expiring Actions log. Evidence only — never drives inactivation.';

comment on column public.gathern_liveness_detail.verdict is
  'kill = 404/410 and the 3-strike grace is now reached · strike = 404/410, grace not yet reached · '
  'alive = HTTP 200 (row is rescued: missing_count reset, last_seen_at refreshed) · transient = '
  'anything else (429/5xx/timeout/no response) which NEVER counts as evidence of removal.';

comment on column public.gathern_liveness_detail.applied is
  'false for a dry-run, and also false for a run whose kill batch was quarantined by the anomaly '
  'cap — in both cases the evidence is real but no row was flipped.';