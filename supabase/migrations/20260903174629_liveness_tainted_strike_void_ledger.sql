-- Durable, per-row evidence for VOIDING strikes that an untrustworthy run wrote.
--
-- WHY THIS IS NEEDED AT ALL. gathern's oracle answered ~99% of probes with a blocked-egress 404 on
-- 2026-09-01..03. Every strike written in that window is an artifact of the bug, not evidence:
-- measured 2026-09-03, ALL 1,493 active gathern rows carrying strikes had their last applied strike
-- inside that window (pre-incident: 0). Left in place they are not inert — grace is 3, so the next
-- TRUSTWORTHY 404 would kill on one trustworthy reading plus two tainted ones, silently converting
-- the outage's damage into real deaths. Voiding them is what makes grace=3 mean "three trustworthy
-- readings" again, which is the rule the liveness contract already states.
--
-- The write is strictly PROTECTIVE — it lowers missing_count, so a row becomes harder to kill and
-- never easier — and it is deliberately CONSERVATIVE: a row that also earned a legitimate strike
-- before the window loses that too, because over-crediting life is the safe direction and
-- under-crediting it is not.
--
-- This ledger is what makes the write reversible and auditable. It lives OUTSIDE
-- gathern_liveness_detail on purpose: that table is the PROBE ledger, and
-- mon_detect_liveness_oracle_untrustworthy() computes its alive-rate as
-- count(http_status=200)/count(*) over it. Writing 1,493 non-probe rows there would drag the
-- denominator down and manufacture exactly the collapse the detector exists to report.
create table if not exists public.ops_liveness_tainted_strike_void (
  id                   bigserial primary key,
  voided_at            timestamptz not null default now(),
  source_table         text        not null,
  listing_id           bigint      not null,
  missing_count_before integer     not null,
  missing_count_after  integer     not null,
  last_tainted_strike_at timestamptz,
  untrusted_window     text        not null,
  reason               text        not null
);

comment on table public.ops_liveness_tainted_strike_void is
  'Per-row record of liveness strikes voided because the run that wrote them was later shown '
  'untrustworthy (source blocking our egress). Protective and reversible: missing_count_before '
  'restores the prior state exactly. Born from the gathern 2026-09-01..03 false-death window.';

create index if not exists ops_liveness_tainted_strike_void_listing_idx
  on public.ops_liveness_tainted_strike_void (source_table, listing_id);

alter table public.ops_liveness_tainted_strike_void enable row level security;
