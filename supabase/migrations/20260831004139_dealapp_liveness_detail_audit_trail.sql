-- The same gap aqar had, on the platform least able to afford it.
--
-- 20260831003901 gave aqar a per-row audit trail after 13,139 deactivations could not be explained
-- below an aggregate. dealapp has the identical gap and a worse starting position: measured over
-- 600 probes on two egress paths (2026-08-30), it produced ZERO dead verdicts and 76-88% UNKNOWN.
-- Its whole liveness question is "what did the source actually return", and nothing recorded it.
--
-- Two differences from aqar's log, both deliberate:
--
--   reason      dealapp deactivates through liveness_contract.decide(), which already produces an
--               auditable reason string ('source_confirmed_dead:direct:strikes=3/3',
--               'unknown_response_never_counts_as_death', ...). Storing it means the record carries
--               the contract's own account of the decision rather than a re-derivation.
--   'unknown'   aqar logs 'transient' for an unusable read. On dealapp the unusable read IS the
--               dominant outcome and the thing under investigation, so it is a first-class verdict
--               here. ~500 rows/day at the current 600-probe limit.
--
-- ALIVE stays unlogged, as for aqar: last_verified_alive_at records it per row.
create table if not exists public.dealapp_liveness_detail (
  id                   bigint generated always as identity primary key,
  run_at               timestamptz not null default now(),
  source_table         text        not null,
  listing_id           bigint      not null,
  http_status          int,                    -- NULL = the fetch itself failed
  verdict              text        not null check (verdict in ('strike','kill','unknown')),
  reason               text,                   -- the contract's own reason string
  missing_count_before int,
  missing_count_after  int,
  applied              boolean     not null default true   -- false on a dry run
);

create index if not exists dealapp_liveness_detail_run_at_idx  on public.dealapp_liveness_detail (run_at desc);
create index if not exists dealapp_liveness_detail_listing_idx on public.dealapp_liveness_detail (source_table, listing_id);
create index if not exists dealapp_liveness_detail_verdict_idx on public.dealapp_liveness_detail (verdict, run_at desc);

comment on table public.dealapp_liveness_detail is
  'Per-row audit trail for dealapp liveness readings that did not confirm life (strike / kill / '
  'unknown), carrying the liveness_contract reason string. On this platform UNKNOWN is the '
  'dominant outcome and the thing under investigation, so it is recorded rather than skipped. '
  'ALIVE is recorded by last_verified_alive_at. applied=false marks a dry run.';

-- Why dealapp cannot yet retire anything, answerable without re-running the experiment.
create or replace view public.ops_dealapp_liveness_outcomes as
  select date_trunc('day', run_at) as day,
         verdict,
         applied,
         count(*)                                        as readings,
         count(*) filter (where http_status = 200)       as http_200,
         count(*) filter (where http_status in (404,410)) as http_gone,
         count(*) filter (where http_status is null)      as fetch_failed
    from public.dealapp_liveness_detail
   group by 1, 2, 3
   order by 1 desc, 2;

comment on view public.ops_dealapp_liveness_outcomes is
  'Daily shape of dealapp liveness readings. The standing finding (2026-08-30) is that http_200 '
  'dominates while http_gone stays at zero -- dealapp answers 200-with-a-shell for listings that '
  'are gone, which is why absence cannot be converted into a death verdict on this platform.';