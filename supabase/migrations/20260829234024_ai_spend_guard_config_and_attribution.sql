-- ═══ AI SPEND SAFETY: CONFIG, STATE, ATTRIBUTION, GATE, RESET ════════════════════════════════
-- MIRROR of the migrations applied to production on 2026-08-29 (migration-mirror rule).
--
-- Owner ruling: "A bug may degrade the AI temporarily, but no bug should ever be allowed to silently
-- bankrupt us. Quality can fail soft; spending must fail closed."
--
-- THRESHOLDS LIVE HERE AND NOWHERE ELSE. Single documented source of truth, tunable with an UPDATE,
-- never a redeploy of the 93KB agent function. Every default is derived from MEASURED production
-- baselines (2026-08-29), not guessed:
--   observed peak hour ...... 50 turns/hour
--   observed typical hour ... 9-21 turns/hour
--   observed cost/call ...... $0.000482 peak rate, $0.000241 off-peak
--   observed cache hit ...... 99.0-99.6%
--   observed calls/turn ..... 1.00
-- Ceilings sit ~40x above the observed peak, so ordinary growth (even a very good launch day) never
-- trips them while a genuine runaway is stopped inside one rolling window. They ARE meant to be
-- tuned: if the owner learns the DeepSeek account's own limits, update this row.
create table if not exists public.ai_spend_config (
  id                        boolean primary key default true check (id),  -- single-row table
  max_calls_per_hour        integer not null default 2000,   -- 40x the observed 50/h peak
  max_usd_per_hour          numeric not null default 2.00,   -- ~4100 calls at the measured rate
  max_calls_per_day         integer not null default 20000,
  max_usd_per_day           numeric not null default 10.00,
  -- A breaker must never trip on a tiny sample: below this many calls in the window the ceilings are
  -- not evaluated at all, so one odd burst on a quiet day cannot take the AI down.
  min_calls_before_trip     integer not null default 200,
  -- Models we are willing to PAY for. Mirrors ALLOWED_MODELS in the agent edge function.
  allowed_models            text[]  not null default array['deepseek-chat','deepseek-v4-flash'],
  enabled                   boolean not null default true,
  notes                     text,
  updated_at                timestamptz not null default now()
);

insert into public.ai_spend_config (id, notes)
values (true, 'Defaults derived from measured 2026-08-29 baselines: 50 turns/h peak, $0.000482/call, 1.00 calls/turn, 99% cache. Ceilings ~40x peak.')
on conflict (id) do nothing;

alter table public.ai_spend_config enable row level security;

comment on table public.ai_spend_config is
  'THE source of truth for AI spend ceilings. Tune with UPDATE; never hardcode a limit in the edge function.';

-- Separate from config on purpose: config is intent, state is what is happening now. A trip must
-- record exactly WHY, and resuming paid calls must be a deliberate act, never a silent recovery.
create table if not exists public.ai_spend_state (
  id            boolean primary key default true check (id),
  state         text not null default 'closed' check (state in ('closed','open')),
  reason        text,
  detail        jsonb,
  tripped_at    timestamptz,
  reset_at      timestamptz,
  reset_by      text,
  updated_at    timestamptz not null default now()
);
insert into public.ai_spend_state (id) values (true) on conflict (id) do nothing;
alter table public.ai_spend_state enable row level security;

comment on table public.ai_spend_state is
  'AI spend circuit breaker. state=open means NO new paid DeepSeek calls. Reset only via ai_spend_reset() after the condition is healthy.';

-- ATTRIBUTION: without this a CI job and a real customer are indistinguishable in the cost data, so
-- "is our spend real usage or a runaway test loop?" cannot be answered — and that was a live
-- question. Defaults to 'user' so an unlabelled call is counted as the more important kind.
alter table public.ai_usage add column if not exists source text not null default 'user';
create index if not exists ai_usage_source_at_idx on public.ai_usage (source, at desc);

comment on column public.ai_usage.source is
  'Caller class: user | ci | selftest. Set from the x-ezhalah-client request header; defaults to user.';

