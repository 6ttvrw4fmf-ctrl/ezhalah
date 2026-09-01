-- aqar could deactivate 13,139 listings in a day and leave no way to ask why about any one of them.
--
-- 2026-08-30 01:00-03:00: aqar deactivated 12,353 residential rows (13,139 across res+com) against
-- a 20-day baseline of 250-650/day. Every one was at full grace (missing_count >= 3, i.e. three
-- consecutive DIRECT dead readings) and the sweeps were healthy (transient 0-18 per shard), so the
-- MECHANISM behaved correctly and the destructive cleanup gate did its job separately -- it ABORTED
-- at 4,921 and 4,416 candidates rather than deleting.
--
-- But when the owner asked "why did 13,000 listings disappear", the honest answer was: we cannot
-- show you. gathern has gathern_liveness_detail (run_at, http_status, verdict, missing_count
-- before/after, applied) and wasalt has wasalt_liveness_pilot_detail. aqar -- 90,178 active rows,
-- our largest platform, ~97k probes/day -- had no per-row record at all. The aggregate run notes
-- say "killed=1251"; nothing says WHICH rows, or what the source actually returned for each.
--
-- An audit trail you only wish you had during an incident is not an audit trail.
--
-- WHY NOT LOG EVERY PROBE. aqar probes ~97k rows/day; logging alive verdicts too would be ~2.9M
-- rows/month to record the uninteresting case. "This row is alive" is already recorded, precisely
-- and per-row, by last_verified_alive_at (20260830183939). What was missing is the other side: the
-- readings that moved a row TOWARDS removal. So this logs strike / kill / transient and leaves
-- alive to the column built for it -- roughly 2k rows/day normally, ~13k on a day like 2026-08-30.
create table if not exists public.aqar_liveness_detail (
  id                   bigint generated always as identity primary key,
  run_at               timestamptz not null default now(),
  source_table         text        not null,   -- aqar has res AND com; gathern's log predates that
  listing_id           bigint      not null,
  http_status          int,                    -- NULL = the fetch itself failed (transient)
  verdict              text        not null check (verdict in ('strike','kill','transient')),
  missing_count_before int,
  missing_count_after  int,
  applied              boolean     not null default true
);

create index if not exists aqar_liveness_detail_run_at_idx  on public.aqar_liveness_detail (run_at desc);
create index if not exists aqar_liveness_detail_listing_idx on public.aqar_liveness_detail (source_table, listing_id);
create index if not exists aqar_liveness_detail_verdict_idx on public.aqar_liveness_detail (verdict, run_at desc);

comment on table public.aqar_liveness_detail is
  'Per-row audit trail for every aqar liveness reading that moved a listing toward removal '
  '(strike / kill / transient). ALIVE is deliberately not logged here -- last_verified_alive_at '
  'records it per row, and logging ~97k alive probes a day would bury the readings that matter. '
  'Answers "why was THIS row deactivated" after the fact, which on 2026-08-30 (13,139 rows in one '
  'day) could not be answered at all.';

-- The question this table exists to answer, ready to run.
create or replace view public.ops_aqar_recent_kills as
  select d.run_at, d.source_table, d.listing_id, d.http_status,
         d.missing_count_before, d.missing_count_after
    from public.aqar_liveness_detail d
   where d.verdict = 'kill'
   order by d.run_at desc;

comment on view public.ops_aqar_recent_kills is
  'Every aqar deactivation with the HTTP status that produced it and the strike count it reached. '
  'This is what should have existed on 2026-08-30.';
