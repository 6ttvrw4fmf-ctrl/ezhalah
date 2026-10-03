-- Two ops tables for the 🆕 New Listings Engineer's computed score and its between-run backlog
-- (kit/new-listings-tools, 2026-10-03; same style as 20261003004247_dead_visible_score.sql).
-- Until these tables exist, new_listings_score.py and new_listings_report.py only print.

-- ops_new_listings_score: new listings vs their original ads, one row per website per night.
--
-- WHY. The 🆕 New Listings Engineer's rating must be a computed number, not self-graded
-- (docs/ops/NEW_LISTINGS_ENGINEER.md, "Your score"). Every night
-- scrapers/common/new_listings_score.py samples production-served listings first seen in the last
-- 24 h per website, re-reads each original ad through the independent reader
-- (scrapers/common/source_reread.py — none of our parsers) and compares field by field. UNKNOWN /
-- page-silent / unreadable is never counted as wrong (silent means unknown).
--
-- Ops-only, no PII: mismatch_ids are our own "<source_table>:<id>" keys, never a URL, a name or a
-- phone.

create table if not exists public.ops_new_listings_score (
  night            date    not null,
  platform         text    not null,
  sampled          integer not null default 0 check (sampled >= 0),
  fields           jsonb   not null default '{}'::jsonb,  -- per field: match/mismatch/we_miss/page_silent/unreadable
  normal_match     integer not null default 0 check (normal_match >= 0),
  normal_mismatch  integer not null default 0 check (normal_mismatch >= 0),
  af_claimed       integer not null default 0 check (af_claimed >= 0),      -- yes/no claims the page could judge
  af_agree         integer not null default 0 check (af_agree >= 0),        -- of those, the page agreed
  af_page_states   integer not null default 0 check (af_page_states >= 0),  -- fields the page itself states
  af_captured      integer not null default 0 check (af_captured >= 0),     -- of those, we captured (not NULL)
  mismatch_ids     text[]  not null default '{}',          -- evidence: source_table:id of every mismatching ad
  note             text,                                   -- 'error: …', 'N page(s) unreadable', …
  created_at       timestamptz not null default now(),
  primary key (night, platform),
  check (af_agree <= af_claimed),
  check (af_captured <= af_page_states)
);

alter table public.ops_new_listings_score enable row level security;
revoke all on table public.ops_new_listings_score from anon, authenticated;

comment on table public.ops_new_listings_score is
  'New listings vs their original ads: one row per website per night from '
  'scrapers/common/new_listings_score.py. normal_match/(normal_match+normal_mismatch) is the '
  'normal-filter accuracy; af_agree/af_claimed is AF precision; af_captured/af_page_states is AF '
  'recall. page-silent and unreadable are in neither half. The New Listings Engineer rating is '
  'READ from these rows (NEW_LISTINGS_ENGINEER.md, "Your score"): 10 only when normal accuracy '
  '>= 99%, AF precision >= 99% and AF recall >= 90% on websites with >= 5 decided ads and every '
  'website measured; any website under 95% normal accuracy caps the rating at 5.';

-- ops_engineer_backlog: unfinished work that must survive between nightly runs.
-- The engineer inserts an item when found, reads its open ones FIRST each night, and closes each
-- with evidence (a query result, a PR, a job URL). status moves open -> done / wontfix, never
-- deleted: the trail is the point.

create table if not exists public.ops_engineer_backlog (
  id         bigint generated always as identity primary key,
  engineer   text not null,                 -- 'new_listings', 'lifecycle', …
  item       text not null,                 -- what is unfinished, self-contained
  status     text not null default 'open' check (status in ('open', 'done', 'wontfix')),
  evidence   text,                          -- how it was closed (query, PR, job URL) — required to close
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  check (status = 'open' or evidence is not null),
  check ((status = 'open') = (closed_at is null))
);

create index if not exists ops_engineer_backlog_open_idx
  on public.ops_engineer_backlog (engineer) where status = 'open';

alter table public.ops_engineer_backlog enable row level security;
revoke all on table public.ops_engineer_backlog from anon, authenticated;

comment on table public.ops_engineer_backlog is
  'Unfinished engineer work that survives between nightly runs. Insert when found, read open rows '
  'first each night, close with evidence (status done/wontfix + closed_at). Never deleted.';
