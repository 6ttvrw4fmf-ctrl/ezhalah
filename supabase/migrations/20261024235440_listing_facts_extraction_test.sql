-- listing_facts — the 10,000-ad FACTS-EXTRACTION TEST (owner, 2026-10-24).
--
-- An LLM reads each ad's own title + description and lists the facts the ad NAMES (pool, parking,
-- majlis, street width …), each with the ad's exact words as proof. The rows land HERE, in a table
-- nothing serves, so the owner can judge accuracy before the same reader runs over all ~404k ads.
--
-- SOURCE IS TRUTH, three outcomes per fact (docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md §2):
--   value_bool = true   the ad names it            («مسبح خارجي»)
--   value_bool = false  the ad explicitly negates it («بدون مسبح», «لا يوجد مصعد»)
--   no row              the ad is silent, says "prepared only" («تأسيس مسبح»), or talks about the
--                       NEIGHBOURHOOD («قريب من …») — nearby is never stored.
-- PROOF OR DROP: `quote` is the ad's own words; scrapers/facts/extract.py refuses a row whose quote is
-- not a literal substring of the (normalised, PII-stripped) text it sent, and counts the refusal.
-- `source_value` is the source's OWN structured field for the same fact at extraction time (NULL when
-- the table has no such column) — the free ground truth the accuracy report compares against.
--
-- NOT a product surface: RLS on, no policies, anon/authenticated revoked — service-role only
-- (public-key lockdown, 2026-10-18). Touches no *_listings table, no RPC, no scraper, no edge function.
create table if not exists public.listing_facts (
  id            bigint generated always as identity primary key,
  run_id        text        not null,
  platform      text        not null,
  table_name    text        not null,
  listing_key   text        not null,   -- the source table's ad_number
  listing_url   text,
  fact          text        not null,   -- catalogue key, or other:<short arabic label>
  value_bool    boolean,
  value_num     numeric,
  value_text    text,
  quote         text        not null,
  source_value  text,                   -- the source's own structured value for this fact, if any
  model         text,
  extracted_at  timestamptz not null default now(),
  constraint listing_facts_one_value check (
    (value_bool is not null)::int + (value_num is not null)::int + (value_text is not null)::int = 1),
  constraint listing_facts_unique unique (platform, listing_key, fact, run_id)
);
create index if not exists listing_facts_run_fact_idx on public.listing_facts (run_id, fact);
alter table public.listing_facts enable row level security;
revoke all on table public.listing_facts from public, anon, authenticated;
comment on table public.listing_facts is
  'Facts an LLM read from an ad''s own text, each with the ad''s words as proof (quote). Test table for the 10,000-ad facts-extraction trial, 2026-10-24. Service-role only; nothing serves it.';

-- One row per paid model call. Deliberately NOT public.ai_usage: ai_spend_gate() sums EVERY ai_usage row
-- in the last hour/24h with no per-source split, so logging this batch there would trip the live
-- product's $0.50/h breaker. The job's own hard caps live in the script (calls and USD per run).
create table if not exists public.listing_facts_runs (
  id                 bigint generated always as identity primary key,
  run_id             text        not null,
  at                 timestamptz not null default now(),
  purpose            text        not null default 'facts_extract',
  requested_model    text,
  model              text,
  ads                smallint,
  prompt_tokens      integer,
  cache_hit_tokens   integer,
  cache_miss_tokens  integer,
  completion_tokens  integer,
  usd                numeric(12, 8),
  http_status        integer,
  latency_ms         integer,
  json_ok            boolean,
  facts_returned     integer,
  facts_stored       integer,
  dropped_unverified integer,
  dropped_pii        integer,
  dropped_invalid    integer,
  ads_by_platform    jsonb,     -- {platform: ads in this call} — the coverage denominator
  note               text
);
create index if not exists listing_facts_runs_run_idx on public.listing_facts_runs (run_id, at);
alter table public.listing_facts_runs enable row level security;
revoke all on table public.listing_facts_runs from public, anon, authenticated;
comment on table public.listing_facts_runs is
  'Per-call cost log of the facts-extraction job (tokens, USD, drops). Kept apart from ai_usage on purpose: the live spend breaker must not see this batch.';
