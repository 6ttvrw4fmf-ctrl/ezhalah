-- AI Agent foundation: token/latency observability (owner brief 2026-08-16, item 6).
-- Dashboard-first convention (ARCHITECTURE.md §19.0): this table IS the read interface for AI
-- request cost/latency; no notification-only side channel. One row per Gemini call from
-- supabase/functions/agent/index.ts. NEVER holds the raw user message or raw model reply text —
-- only counts, timings, model id, and the structured `kind` field (categorical output, not
-- content). Written by the edge function's service-role key; no anon/authenticated policy is
-- granted, matching every other mon_/ops_ table in this project.
create table if not exists public.mon_agent_request_log (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  model text not null,
  fallback_used boolean not null default false,
  -- 'listings' | 'message' | 'interview' | 'error' | 'unknown' — categorical only, never raw text.
  request_kind text,
  history_turns integer,
  -- Cheap drift proxy for the system-instruction size. Pairs with the byte-exact assertion in
  -- scripts/verify-agent-token-budget-barriers.ts — this is the ongoing PRODUCTION signal, that
  -- script is the DEPLOY-TIME guarantee. Neither replaces the other.
  system_chars integer,
  prompt_tokens integer,
  output_tokens integer,
  thinking_tokens integer,
  total_tokens integer,
  latency_ms integer,
  http_status integer
);

comment on table public.mon_agent_request_log is
  'AI Agent (Gemini) per-request token/latency telemetry (foundation brief 2026-08-16, item 6). NEVER logs raw user message or raw model reply text — only counts, timings, model id, and the structured "kind" field. Dashboard-first convention (ARCHITECTURE.md §19.0): read this directly. Use it to detect the average request growing (e.g. 500 -> 5,000 tokens) — see mon_agent_request_log_daily.';

alter table public.mon_agent_request_log enable row level security;
-- No policies: default-deny for anon/authenticated. The edge function writes via the service-role
-- key, which bypasses RLS; dashboard/admin reads go through the same privileged path.

create index if not exists mon_agent_request_log_requested_at_idx
  on public.mon_agent_request_log (requested_at desc);

-- One-call daily rollup for the dashboard (avg/max tokens + latency, per day) — so "did our average
-- request suddenly grow" is a single query, not an ad-hoc one someone has to remember to write.
create or replace view public.mon_agent_request_log_daily as
select
  date_trunc('day', requested_at) as day,
  model,
  count(*) as requests,
  avg(prompt_tokens)::numeric(10,1) as avg_prompt_tokens,
  max(prompt_tokens) as max_prompt_tokens,
  avg(output_tokens)::numeric(10,1) as avg_output_tokens,
  max(output_tokens) as max_output_tokens,
  avg(thinking_tokens)::numeric(10,1) as avg_thinking_tokens,
  avg(total_tokens)::numeric(10,1) as avg_total_tokens,
  avg(latency_ms)::numeric(10,1) as avg_latency_ms,
  count(*) filter (where http_status is distinct from 200) as error_count
from public.mon_agent_request_log
group by 1, 2;

comment on view public.mon_agent_request_log_daily is
  'Daily rollup of mon_agent_request_log for the dashboard-first monitoring contract (ARCHITECTURE.md §19.0). Answers "did the average AI request suddenly grow" in one query.';
