-- AI cost telemetry. Owner 2026-08-29: DeepSeek balance dropping faster than the earlier
-- ~$1/1,000-message estimate, and NOTHING in this system recorded token usage — the edge function
-- read data.usage only on the ERROR path and never persisted it. Without this table any cost
-- statement is an estimate, which is exactly what produced the wrong estimate in the first place.
--
-- PRIVACY: counts only. No prompt text, no user message, no reply, no user id, no IP. Nothing here
-- can identify a person or reconstruct a conversation (PDPL + the owner's "no unnecessary raw chat
-- transcripts" standing rule).
create table if not exists public.ai_usage (
  id                bigserial primary key,
  at                timestamptz not null default now(),
  -- what we ASKED for (the alias, e.g. "deepseek-chat") vs what DeepSeek says it BILLED as.
  -- The gap between these two is the single most expensive unknown: an alias silently resolving
  -- to v4-pro costs 3x v4-flash on every token.
  requested_model   text,
  model             text,
  kind              text,      -- listings | message | interview
  locale            text,      -- ar | en
  call_seq          smallint,  -- 1 = primary call, 2 = language-guard retry
  prompt_tokens     integer,
  completion_tokens integer,
  reasoning_tokens  integer,
  cache_hit_tokens  integer,
  cache_miss_tokens integer,
  total_tokens      integer,
  finish_reason     text,
  history_turns     smallint,
  latency_ms        integer
);

create index if not exists ai_usage_at_idx on public.ai_usage (at desc);
create index if not exists ai_usage_model_idx on public.ai_usage (model, at desc);

-- Service-role writes only; no anon/authenticated policy exists, so RLS denies everyone else.
alter table public.ai_usage enable row level security;

comment on table public.ai_usage is
  'DeepSeek token usage per AI call (counts only, no PII). Written fire-and-forget by the agent edge function. Cost via public.ai_usage_costed.';

-- Pricing lives in a VIEW, not in the edge function: DeepSeek prices and peak windows change, and a
-- price correction must never require redeploying the agent (93KB, bidi chars, no rollback).
-- Rates per 1M tokens, from api-docs.deepseek.com/quick_start/pricing (read 2026-08-29):
--   v4-flash  hit 0.014 peak / 0.007 off | miss 0.44 / 0.22 | out 1.32 / 0.66
--   v4-pro    hit 0.044 peak / 0.022 off | miss 1.32 / 0.66 | out 3.96 / 1.98
-- Peak = 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri; off-peak is half.
create or replace view public.ai_usage_costed as
with p as (
  select
    u.*,
    (extract(isodow from u.at at time zone 'UTC') <= 5
      and (
        (u.at at time zone 'UTC')::time >= time '01:00' and (u.at at time zone 'UTC')::time < time '04:00'
        or (u.at at time zone 'UTC')::time >= time '06:00' and (u.at at time zone 'UTC')::time < time '10:00'
      )) as is_peak,
    case when coalesce(u.model, u.requested_model) ilike '%pro%' then 'pro' else 'flash' end as tier
  from public.ai_usage u
)
select
  p.*,
  round(
    ( coalesce(p.cache_hit_tokens, 0)::numeric / 1000000
        * case when p.tier = 'pro' then case when p.is_peak then 0.044 else 0.022 end
                                    else case when p.is_peak then 0.014 else 0.007 end end
    + coalesce(p.cache_miss_tokens, greatest(coalesce(p.prompt_tokens, 0) - coalesce(p.cache_hit_tokens, 0), 0))::numeric / 1000000
        * case when p.tier = 'pro' then case when p.is_peak then 1.32 else 0.66 end
                                    else case when p.is_peak then 0.44 else 0.22 end end
    + coalesce(p.completion_tokens, 0)::numeric / 1000000
        * case when p.tier = 'pro' then case when p.is_peak then 3.96 else 1.98 end
                                    else case when p.is_peak then 1.32 else 0.66 end end
    ), 8) as usd
from p;

comment on view public.ai_usage_costed is
  'ai_usage + estimated USD per call. Pricing/peak windows live here so a rate change never needs an edge-function redeploy.';
